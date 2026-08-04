import { describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { uploadSingleFile, sniffMiddleware } from "../src/middleware/upload.js";
import { errorHandler } from "../src/middleware/errorHandler.js";

function buildUploadApp() {
  const app = express();
  app.post("/extract", uploadSingleFile, sniffMiddleware, (req, res) => {
    res.json({ mimeType: req.sniffedFile?.mimeType });
  });
  app.use(errorHandler);
  return app;
}

describe("upload pipeline", () => {
  it("400s when no file is uploaded", async () => {
    const res = await request(buildUploadApp()).post("/extract");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NO_FILE_UPLOADED");
  });

  it("400s when the declared content-type isn't in the allowlist", async () => {
    const res = await request(buildUploadApp())
      .post("/extract")
      .attach("file", Buffer.from("not a real document"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("400s when the declared type is allowed but the bytes don't match (spoofed upload)", async () => {
    const res = await request(buildUploadApp())
      .post("/extract")
      .attach("file", Buffer.from("this is not actually a jpeg"), {
        filename: "report.jpg",
        contentType: "image/jpeg",
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("400s when the field name doesn't match 'file'", async () => {
    const res = await request(buildUploadApp())
      .post("/extract")
      .attach("document", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        filename: "report.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNEXPECTED_FIELD");
  });

  it("accepts a genuine PNG upload", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(16),
    ]);
    const res = await request(buildUploadApp())
      .post("/extract")
      .attach("file", png, { filename: "report.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.mimeType).toBe("image/png");
  });

  it("accepts a genuine PDF upload", async () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(32)]);
    const res = await request(buildUploadApp())
      .post("/extract")
      .attach("file", pdf, { filename: "report.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(200);
    expect(res.body.mimeType).toBe("application/pdf");
  });
});
