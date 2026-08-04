import type { SniffedUpload } from "../middleware/upload.js";
import type { OcrResult } from "./types.js";

export interface OcrProvider {
  extractMarkdown(file: SniffedUpload, signal: AbortSignal): Promise<OcrResult>;
}
