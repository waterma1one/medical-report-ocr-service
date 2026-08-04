import { afterEach, describe, expect, it, vi } from "vitest";

// config.ts validates process.env at import time, so each case needs a fresh module
// graph with a specific env shape in place before the import runs.
async function loadConfigWith(env: Record<string, string | undefined>) {
  const original = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("DATALAB_") || key.startsWith("OCR_") || key === "API_BEARER_TOKEN") {
      delete process.env[key];
    }
  }
  Object.assign(process.env, env);

  vi.resetModules();
  try {
    return await import("../src/config.js");
  } finally {
    process.env = original;
  }
}

describe("config — DATALAB_API_KEY requirement", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("does not require DATALAB_API_KEY when OCR_PROVIDER=fixture and the var is unset", async () => {
    // This is the whole point of fixture mode: the service must be runnable with no
    // Datalab account at all. A previous version of this schema required the key
    // unconditionally, which silently broke the documented zero-account quick start.
    const { config } = await loadConfigWith({
      API_BEARER_TOKEN: "t",
      OCR_PROVIDER: "fixture",
    });
    expect(config.ocrProvider).toBe("fixture");
  });

  it("does not require DATALAB_API_KEY when it's present but blank (the .env.example shape)", async () => {
    // .env.example ships "DATALAB_API_KEY=" — loadEnvFile turns that into an empty
    // string, not an absent key. This is the actual shape a fresh clone following the
    // README's fixture-mode quick start ends up with; testing only the fully-unset
    // case (as the test above does) would have missed this.
    const { config } = await loadConfigWith({
      API_BEARER_TOKEN: "t",
      OCR_PROVIDER: "fixture",
      DATALAB_API_KEY: "",
    });
    expect(config.ocrProvider).toBe("fixture");
    expect(config.datalab.apiKey).toBe("");
  });

  it("requires DATALAB_API_KEY when OCR_PROVIDER=datalab (the default)", async () => {
    await expect(
      loadConfigWith({ API_BEARER_TOKEN: "t", OCR_PROVIDER: "datalab" }),
    ).rejects.toThrow(/DATALAB_API_KEY/);
  });

  it("requires DATALAB_API_KEY when OCR_PROVIDER is omitted", async () => {
    await expect(loadConfigWith({ API_BEARER_TOKEN: "t" })).rejects.toThrow(
      /DATALAB_API_KEY/,
    );
  });

  it("succeeds with both OCR_PROVIDER=datalab and a key set", async () => {
    const { config } = await loadConfigWith({
      API_BEARER_TOKEN: "t",
      OCR_PROVIDER: "datalab",
      DATALAB_API_KEY: "k",
    });
    expect(config.datalab.apiKey).toBe("k");
  });
});
