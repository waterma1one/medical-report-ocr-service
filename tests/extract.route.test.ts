import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const PDF_BYTES = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(32)]);

describe("POST /extract", () => {
  it("401s with no Authorization header", async () => {
    const res = await request(createApp())
      .post("/extract")
      .attach("file", PDF_BYTES, { filename: "report.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("400s when no file is attached", async () => {
    const res = await request(createApp())
      .post("/extract")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NO_FILE_UPLOADED");
  });

  it("400s on an unsupported file type", async () => {
    const res = await request(createApp())
      .post("/extract")
      .set("Authorization", "Bearer test-token")
      .attach("file", Buffer.from("plain text"), { filename: "notes.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });
});

describe("POST /extract — against the OCR provider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  async function freshApp() {
    const { createApp: freshCreateApp } = await import("../src/app.js");
    return freshCreateApp();
  }

  it("422s when the OCR result contains no observations", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          error: null,
          request_id: "r1",
          request_check_url: "https://www.datalab.to/api/v1/marker/r1",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: "complete", success: true, markdown: "# Nothing extractable here\n" }),
      );

    const res = await request(await freshApp())
      .post("/extract")
      .set("Authorization", "Bearer test-token")
      .attach("file", PDF_BYTES, { filename: "report.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("NO_OBSERVATIONS_FOUND");
  });

  it("500s with a clean message (not a stack trace) on upstream OCR failure", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, error: "Invalid file", request_id: "", request_check_url: "" }),
    );

    const res = await request(await freshApp())
      .post("/extract")
      .set("Authorization", "Bearer test-token")
      .attach("file", PDF_BYTES, { filename: "report.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("OCR_UPSTREAM_ERROR");
    expect(res.body.error.message).not.toMatch(/at .*\(.*:\d+:\d+\)/); // no stack frame leaked
  });

  it("returns a valid FHIR Bundle for a real lab report", async () => {
    const markdown = readFileSync("tests/fixtures/lalpath-cbc-panel.md", "utf-8");
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          error: null,
          request_id: "r2",
          request_check_url: "https://www.datalab.to/api/v1/marker/r2",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "complete", success: true, markdown }));

    const res = await request(await freshApp())
      .post("/extract")
      .set("Authorization", "Bearer test-token")
      .attach("file", PDF_BYTES, { filename: "report.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe("Bundle");
    expect(res.body.type).toBe("collection");
    expect(res.body.entry.length).toBeGreaterThan(40);

    const hemoglobin = res.body.entry.find((e: { resource: { code: { text: string } } }) =>
      e.resource.code.text.includes("Hemoglobin ("),
    );
    expect(hemoglobin.resource.code.coding[0]).toEqual({
      system: "http://loinc.org",
      code: "718-7",
      display: "Hemoglobin",
    });
    expect(hemoglobin.fullUrl).toMatch(/^urn:uuid:/);
  });
});
