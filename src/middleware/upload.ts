import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { config } from "../config.js";
import { NoFileUploadedError, UnsupportedFileTypeError } from "../errors.js";
import { sniffFileType, type SniffedFileType } from "../upload/sniff.js";

export interface SniffedUpload {
  buffer: Buffer;
  mimeType: SniffedFileType;
  originalName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sniffedFile?: SniffedUpload;
    }
  }
}

const DECLARED_MIME_ALLOWLIST = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// Cheap first pass on the client-declared type, purely to reject obvious junk before
// spending bandwidth buffering it. This is not the security boundary — sniffMiddleware
// below, which checks actual bytes, is.
const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: config.maxFileSizeBytes,
  },
  fileFilter: (_req, file, cb) => {
    if (!DECLARED_MIME_ALLOWLIST.has(file.mimetype)) {
      cb(new UnsupportedFileTypeError());
      return;
    }
    cb(null, true);
  },
});

export const uploadSingleFile = multerUpload.single("file");

export function sniffMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!req.file) {
    next(new NoFileUploadedError());
    return;
  }

  const mimeType = sniffFileType(req.file.buffer);
  if (!mimeType) {
    next(new UnsupportedFileTypeError());
    return;
  }

  req.sniffedFile = {
    buffer: req.file.buffer,
    mimeType,
    originalName: req.file.originalname,
  };
  next();
}
