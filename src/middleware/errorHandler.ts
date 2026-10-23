import type { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import { isAppError, UnsupportedFileTypeError, NoFileUploadedError } from "../errors.js";
import { logger } from "../logger.js";
import { config } from "../config.js";

interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

function send(res: Response, status: number, code: string, message: string): void {
  const body: ErrorBody = { error: { code, message } };
  res.status(status).json(body);
}

function multerErrorToAppError(err: MulterError): { status: number; code: string; message: string } {
  switch (err.code) {
    case "LIMIT_FILE_SIZE": {
      const maxMb = (config.maxFileSizeBytes / (1024 * 1024)).toFixed(1);
      return {
        status: 400,
        code: "FILE_TOO_LARGE",
        message: `File exceeds the ${maxMb}MB upload limit`,
      };
    }
    case "LIMIT_UNEXPECTED_FILE":
      return {
        status: 400,
        code: "UNEXPECTED_FIELD",
        message: `Expected the file in a field named "file", got "${err.field}"`,
      };
    case "LIMIT_FILE_COUNT":
      return {
        status: 400,
        code: "TOO_MANY_FILES",
        message: "Only one file may be uploaded per request",
      };
    default:
      return {
        status: 400,
        code: "MALFORMED_UPLOAD",
        message: "The uploaded file could not be processed",
      };
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- express requires 4-arg signature to identify error middleware
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof MulterError) {
    const { status, code, message } = multerErrorToAppError(err);
    logger.warn({ requestId: req.id, code }, "upload rejected");
    send(res, status, code, message);
    return;
  }

  if (err instanceof UnsupportedFileTypeError || err instanceof NoFileUploadedError) {
    logger.warn({ requestId: req.id, code: err.code }, err.message);
    send(res, err.status, err.code, err.message);
    return;
  }

  if (isAppError(err)) {
    // Upstream/validation errors may wrap document content in their cause chain.
    // Never log message bodies above debug — see README "Privacy" note.
    logger.error({ requestId: req.id, code: err.code, err }, "request failed");
    send(res, err.status, err.code, err.message);
    return;
  }

  logger.error({ requestId: req.id, err }, "unhandled error");
  send(res, 500, "INTERNAL_ERROR", "An unexpected error occurred");
}
