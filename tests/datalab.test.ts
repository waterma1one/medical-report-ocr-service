import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SniffedUpload } from "../src/middleware/upload.js";

const testFile: SniffedUpload = {
  buffer: Buffer.from("fake-pdf-bytes"),
  mimeType: "application/pdf",
  originalName: "report.pdf",
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("datalabProvider.extractMarkdown", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns markdown inline when the poll response completes immediately", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          error: null,
          request_id: "req_1",
          request_check_url: "https://www.datalab.to/api/v1/marker/req_1",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: "complete", success: true, markdown: "# Report\n", page_count: 1 }),
      );

    const { datalabProvider } = await import("../src/ocr/datalab.js");
    const result = await datalabProvider.extractMarkdown(testFile, new AbortController().signal);

    expect(result.markdown).toBe("# Report\n");
    expect(result.pageCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to result_url when markdown is not inlined", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          error: null,
          request_id: "req_2",
          request_check_url: "https://www.datalab.to/api/v1/marker/req_2",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "complete",
          success: true,
          result_url: "https://www.datalab.to/signed/result.json",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ markdown: "# From result_url\n" }));

    const { datalabProvider } = await import("../src/ocr/datalab.js");
    const result = await datalabProvider.extractMarkdown(testFile, new AbortController().signal);

    expect(result.markdown).toBe("# From result_url\n");
  });

  it("refuses to fetch a result_url outside the trusted Datalab host", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          error: null,
          request_id: "req_3",
          request_check_url: "https://www.datalab.to/api/v1/marker/req_3",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "complete",
          success: true,
          result_url: "https://evil.example.com/steal-the-key",
        }),
      );

    const { datalabProvider } = await import("../src/ocr/datalab.js");
    await expect(
      datalabProvider.extractMarkdown(testFile, new AbortController().signal),
    ).rejects.toThrow(/trusted host/);

    // The malicious URL was never actually requested.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats success:false as failure even when status looks non-terminal", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          error: null,
          request_id: "req_4",
          request_check_url: "https://www.datalab.to/api/v1/marker/req_4",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "processing",
          success: false,
          error: "Page rate limit exceeded",
        }),
      );

    const { datalabProvider } = await import("../src/ocr/datalab.js");
    await expect(
      datalabProvider.extractMarkdown(testFile, new AbortController().signal),
    ).rejects.toThrow(/Page rate limit exceeded/);
  });

  it("treats empty markdown as an upstream failure, not an empty document", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          error: null,
          request_id: "req_5",
          request_check_url: "https://www.datalab.to/api/v1/marker/req_5",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "complete", success: true, markdown: "" }));

    const { datalabProvider } = await import("../src/ocr/datalab.js");
    const { OcrUpstreamError } = await import("../src/errors.js");

    // Returning "" as success would surface to the caller as a 422 ("no observations
    // could be extracted"), blaming a perfectly good document for an upstream
    // conversion failure. It has to be a 500-class upstream error instead.
    await expect(
      datalabProvider.extractMarkdown(testFile, new AbortController().signal),
    ).rejects.toThrow(OcrUpstreamError);
  });

  it("rejects the submission when the upstream body has success:false", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, error: "Invalid file", request_id: "", request_check_url: "" }),
    );

    const { datalabProvider } = await import("../src/ocr/datalab.js");
    await expect(
      datalabProvider.extractMarkdown(testFile, new AbortController().signal),
    ).rejects.toThrow(/Invalid file/);
  });

  it("aborts cleanly when the caller's signal fires mid-poll", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        error: null,
        request_id: "req_6",
        request_check_url: "https://www.datalab.to/api/v1/marker/req_6",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "processing", success: true }),
    );

    const { datalabProvider } = await import("../src/ocr/datalab.js");
    const { OcrUpstreamError } = await import("../src/errors.js");
    const promise = datalabProvider.extractMarkdown(testFile, controller.signal);
    // Give the submit + first poll a tick to resolve before aborting mid-sleep.
    await new Promise((r) => setTimeout(r, 10));
    controller.abort(new Error("client disconnected"));

    // Must surface as a typed OcrUpstreamError (-> clean 500), not the raw abort
    // Error the AbortController rejected with (-> generic, unclassified 500).
    await expect(promise).rejects.toThrow(OcrUpstreamError);
    await expect(promise).rejects.toThrow(/client disconnected/);
  });
});
