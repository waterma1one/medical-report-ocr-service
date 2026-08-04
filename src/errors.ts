export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends AppError {
  readonly status = 401;
  readonly code = "UNAUTHORIZED";

  constructor(message = "Missing or invalid bearer token") {
    super(message);
  }
}

export class NoFileUploadedError extends AppError {
  readonly status = 400;
  readonly code = "NO_FILE_UPLOADED";

  constructor(message = "No file was uploaded") {
    super(message);
  }
}

export class UnsupportedFileTypeError extends AppError {
  readonly status = 400;
  readonly code = "UNSUPPORTED_FILE_TYPE";

  constructor(message = "Unsupported file type. Accepted: JPEG, PNG, WebP, PDF") {
    super(message);
  }
}

export class NoObservationsFoundError extends AppError {
  readonly status = 422;
  readonly code = "NO_OBSERVATIONS_FOUND";

  constructor(message = "OCR completed but no observations could be extracted from the report") {
    super(message);
  }
}

export class OcrUpstreamError extends AppError {
  readonly status = 500;
  readonly code = "OCR_UPSTREAM_ERROR";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
