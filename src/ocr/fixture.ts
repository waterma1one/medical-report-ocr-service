import { readFile } from "node:fs/promises";
import { config } from "../config.js";
import type { OcrProvider } from "./provider.js";

// Replays a saved Datalab response so the service is runnable and testable without a
// Datalab account. Lets README's quick start be "clone, npm i, npm run dev" instead of
// "clone, sign up for a third-party API, npm i, npm run dev".
export const fixtureProvider: OcrProvider = {
  async extractMarkdown() {
    const markdown = await readFile(config.ocrFixturePath, "utf-8");
    return { markdown, pageCount: null };
  },
};
