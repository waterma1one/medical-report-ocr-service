import { setTimeout as delay } from "node:timers/promises";
import { config } from "../config.js";
import { OcrUpstreamError } from "../errors.js";
import { logger } from "../logger.js";
import type { SniffedUpload } from "../middleware/upload.js";
import type { OcrProvider } from "./provider.js";
import type { DatalabInitialResponse, DatalabPollResponse, OcrResult } from "./types.js";

const MAX_SUBMIT_RETRIES = 3;
/** Upper bound on how long an upstream Retry-After header may hold a request. */
const MAX_RETRY_AFTER_MS = 30_000;
/** Per-request network timeout, so one hung connection can't pin a handler open. */
const REQUEST_TIMEOUT_MS = 60_000;

const trustedHostname = new URL(config.datalab.apiUrl).hostname;

// Both request_check_url and result_url are handed to us by the upstream response and
// are fetched with our API key attached. If DATALAB_API_URL were misconfigured, or a
// response spoofed, that would send the key to an arbitrary host. Pin both to the
// configured hostname and require https.
function assertTrustedDatalabUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OcrUpstreamError("OCR upstream returned a malformed URL");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== trustedHostname) {
    throw new OcrUpstreamError("OCR upstream returned a URL outside the trusted host");
  }
  return parsed;
}

function parseRetryAfterMs(res: Response): number {
  const header = res.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    if (header) logger.warn({ header }, "unparseable retry-after header, using default backoff");
    return 5000;
  }
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

/** Caller's abort signal combined with a per-request network timeout. */
function requestSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
}

async function readJson(res: Response, context: string): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    // A proxy error page or truncated body arrives as HTTP 200 with non-JSON content.
    // Without this it escapes as a raw SyntaxError and gets reported to the client as
    // an internal error, blaming us for an upstream fault.
    throw new OcrUpstreamError(`OCR upstream returned a non-JSON response while ${context}`);
  }
}

async function submit(file: SniffedUpload, signal: AbortSignal): Promise<DatalabInitialResponse> {
  const form = new FormData();
  form.set(
    "file",
    new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }),
    file.originalName,
  );
  form.set("output_format", "markdown");
  form.set("mode", config.datalab.mode);
  form.set("paginate", "true");

  for (let attempt = 0; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
    const res = await fetch(config.datalab.apiUrl, {
      method: "POST",
      headers: { "X-API-Key": config.datalab.apiKey },
      body: form,
      signal: requestSignal(signal),
    });

    if (res.status === 429) {
      if (attempt === MAX_SUBMIT_RETRIES) {
        throw new OcrUpstreamError("OCR upstream is rate limiting this service");
      }
      const waitMs = parseRetryAfterMs(res);
      logger.warn({ attempt, waitMs }, "datalab submit rate limited, backing off");
      await delay(waitMs, undefined, { signal });
      continue;
    }

    if (!res.ok) {
      throw new OcrUpstreamError(`OCR upstream returned HTTP ${res.status} on submit`);
    }

    const body = (await readJson(res, "submitting the document")) as DatalabInitialResponse;
    if (!body.success) {
      throw new OcrUpstreamError(body.error || "OCR upstream rejected the submission");
    }
    if (typeof body.request_check_url !== "string" || body.request_check_url === "") {
      throw new OcrUpstreamError("OCR upstream accepted the document but returned no status URL");
    }
    return body;
  }

  // Unreachable — the loop always returns or throws — but keeps the return type honest.
  throw new OcrUpstreamError("OCR upstream submission failed after retries");
}

async function fetchInlineOrRemoteMarkdown(
  poll: DatalabPollResponse,
  signal: AbortSignal,
): Promise<string> {
  // An empty string is a complete upstream conversion failure, not a document with no
  // content. Reporting it as success turns into a 422 that blames the user's file.
  if (typeof poll.markdown === "string" && poll.markdown.trim() !== "") {
    return poll.markdown;
  }

  if (poll.result_url) {
    const url = assertTrustedDatalabUrl(poll.result_url);
    const res = await fetch(url, {
      headers: { "X-API-Key": config.datalab.apiKey },
      signal: requestSignal(signal),
    });
    if (!res.ok) {
      throw new OcrUpstreamError(`Failed to fetch OCR result document (HTTP ${res.status})`);
    }
    const body = (await readJson(res, "downloading the result document")) as {
      markdown?: string | null;
    };
    if (typeof body.markdown === "string" && body.markdown.trim() !== "") {
      return body.markdown;
    }
  }

  throw new OcrUpstreamError("OCR completed without any output");
}

async function poll(checkUrl: string, signal: AbortSignal): Promise<OcrResult> {
  const url = assertTrustedDatalabUrl(checkUrl);
  const deadline = Date.now() + config.datalab.pollTimeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(url, {
      headers: { "X-API-Key": config.datalab.apiKey },
      signal: requestSignal(signal),
    });

    if (!res.ok) {
      throw new OcrUpstreamError(`OCR upstream returned HTTP ${res.status} while polling`);
    }

    const body = (await readJson(res, "polling for the result")) as DatalabPollResponse;

    if (body.success === false) {
      throw new OcrUpstreamError(body.error || "OCR conversion failed upstream");
    }

    // status comes off an unvalidated JSON body; the declared type can't guarantee it.
    if (typeof body.status !== "string") {
      throw new OcrUpstreamError("OCR upstream returned a result with no status");
    }

    if (body.status.startsWith("complete")) {
      const markdown = await fetchInlineOrRemoteMarkdown(body, signal);
      return { markdown, pageCount: body.page_count ?? null };
    }

    if (body.status === "failed") {
      throw new OcrUpstreamError(body.error || "OCR conversion failed upstream");
    }

    await delay(config.datalab.pollIntervalMs, undefined, { signal });
  }

  throw new OcrUpstreamError("Timed out waiting for OCR conversion to complete");
}

export const datalabProvider: OcrProvider = {
  async extractMarkdown(file, signal) {
    try {
      const initial = await submit(file, signal);
      return await poll(initial.request_check_url, signal);
    } catch (err) {
      if (err instanceof OcrUpstreamError) throw err;

      // A caller-triggered abort (client disconnect) rejects with a raw Error.
      if (signal.aborted) {
        throw new OcrUpstreamError("OCR request was aborted because the client disconnected", {
          cause: err,
        });
      }

      // Everything else reaching here is an upstream or transport fault — a socket
      // reset, a DNS failure, our own request timeout. Classify it rather than
      // letting it surface to the client as an unexplained internal error.
      throw new OcrUpstreamError("OCR upstream request failed", { cause: err });
    }
  },
};
