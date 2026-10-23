import { describe, expect, it } from "vitest";
import { NEEDS_REVIEW_EXTENSION_URL, buildBundle } from "../src/fhir/bundle.js";

describe("buildBundle", () => {
  it("carries needs-review names as de-duplicated Meta.extension entries", () => {
    const bundle = buildBundle([], ["Uric Acid", "Uric Acid", "A : G Ratio"]);

    expect(bundle.meta?.source).toBe("ocr-extraction");
    expect(bundle.meta?.extension).toEqual([
      { url: NEEDS_REVIEW_EXTENSION_URL, valueString: "Uric Acid" },
      { url: NEEDS_REVIEW_EXTENSION_URL, valueString: "A : G Ratio" },
    ]);
    expect(bundle.meta).not.toHaveProperty("needsReview");
  });

  it("omits Meta.extension when nothing needs review", () => {
    const bundle = buildBundle([], []);

    expect(bundle.meta).toEqual({ source: "ocr-extraction" });
  });
});
