import { describe, expect, it } from "vitest";
import { sniffFileType } from "../src/upload/sniff.js";

describe("sniffFileType", () => {
  it("detects a PDF at offset 0", () => {
    const buf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(20)]);
    expect(sniffFileType(buf)).toBe("application/pdf");
  });

  it("detects a PDF with junk preceding the header, within the first 1KB", () => {
    const buf = Buffer.concat([Buffer.alloc(100, 0x20), Buffer.from("%PDF-1.4")]);
    expect(sniffFileType(buf)).toBe("application/pdf");
  });

  it("detects JPEG magic bytes", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(sniffFileType(buf)).toBe("image/jpeg");
  });

  it("detects PNG magic bytes", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(sniffFileType(buf)).toBe("image/png");
  });

  it("detects WebP (RIFF....WEBP)", () => {
    const buf = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from("WEBP"),
    ]);
    expect(sniffFileType(buf)).toBe("image/webp");
  });

  it("returns null for a RIFF file that isn't WebP", () => {
    const buf = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from("AVI "),
    ]);
    expect(sniffFileType(buf)).toBeNull();
  });

  it("returns null for a text file renamed to look like an upload", () => {
    const buf = Buffer.from("This is just plain text, not a real document.");
    expect(sniffFileType(buf)).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(sniffFileType(Buffer.alloc(0))).toBeNull();
  });
});
