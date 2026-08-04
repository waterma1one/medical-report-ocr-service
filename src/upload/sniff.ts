// Client-supplied Content-Type is attacker-controlled — a .jpg extension proves
// nothing about the bytes behind it. Sniff the magic bytes instead of trusting the
// declared MIME type; multer's fileFilter only sees the declared type, so this runs
// separately, after the buffer is fully available.

export type SniffedFileType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

export function sniffFileType(buffer: Buffer): SniffedFileType | null {
  if (isPdf(buffer)) return "application/pdf";
  if (isJpeg(buffer)) return "image/jpeg";
  if (isPng(buffer)) return "image/png";
  if (isWebp(buffer)) return "image/webp";
  return null;
}

function isPdf(buffer: Buffer): boolean {
  // The PDF spec allows the header within the first 1024 bytes, not only at offset 0 —
  // some generators prepend junk before the signature.
  const window = buffer.subarray(0, 1024);
  return window.includes(Buffer.from("%PDF-"));
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer: Buffer): boolean {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

function isWebp(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  return (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  );
}
