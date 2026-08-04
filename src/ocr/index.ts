import { config } from "../config.js";
import { datalabProvider } from "./datalab.js";
import { fixtureProvider } from "./fixture.js";
import type { OcrProvider } from "./provider.js";

export const ocrProvider: OcrProvider =
  config.ocrProvider === "fixture" ? fixtureProvider : datalabProvider;

export type { OcrResult } from "./types.js";
export type { OcrProvider } from "./provider.js";
