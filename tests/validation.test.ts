import { describe, expect, it } from "vitest";
import { collectNeedsReview, validateObservation } from "../src/validation/validator.js";
import { mapToObservation } from "../src/fhir/mapper.js";
import type { RawObservation } from "../src/parsing/parser.js";

type Overrides = { [K in keyof RawObservation]?: RawObservation[K] | undefined };

function mapped(overrides: Overrides) {
  const merged: Record<string, unknown> = {
    name: "Hemoglobin",
    rawValue: "15.00",
    value: 15,
    unit: "g/dL",
    range: { low: 13, high: 17 },
    ...overrides,
  };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  return mapToObservation(merged as unknown as RawObservation);
}

describe("validateObservation", () => {
  it("passes a clean, complete observation with no issues", () => {
    expect(validateObservation(mapped({}))).toEqual([]);
  });

  it("flags a value with a trailing marker: '11.2*'", () => {
    const issues = validateObservation(mapped({ rawValue: "11.2*", value: 11.2 }));
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "VALUE_NOT_A_CLEAN_NUMBER" }),
    );
  });

  it("flags a value carrying a trailing abnormality letter", () => {
    const issues = validateObservation(mapped({ rawValue: "18 H", value: 18 }));
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "VALUE_NOT_A_CLEAN_NUMBER" }),
    );
  });

  it("flags a purely qualitative result as not a clean number", () => {
    const issues = validateObservation(
      mapped({ name: "GFR Category", rawValue: "G1", value: undefined, unit: undefined, range: undefined }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "VALUE_NOT_A_CLEAN_NUMBER" }),
    );
  });

  it("does not flag a comparator-bounded value ('<0.5') as unclean", () => {
    // "<0.5" is a valid, common lab convention (below the assay's floor), not OCR
    // damage — it should carry no VALUE_NOT_A_CLEAN_NUMBER issue.
    const issues = validateObservation(
      mapped({ rawValue: "<0.5", value: undefined, range: { low: 1, high: 5 } }),
    );
    expect(issues.map((i) => i.code)).not.toContain("VALUE_NOT_A_CLEAN_NUMBER");
  });

  it("flags a missing unit", () => {
    const issues = validateObservation(mapped({ unit: undefined }));
    expect(issues).toContainEqual(expect.objectContaining({ code: "MISSING_UNIT" }));
  });

  it("does not flag a unit that is present", () => {
    const issues = validateObservation(mapped({}));
    expect(issues.map((i) => i.code)).not.toContain("MISSING_UNIT");
  });

  it("flags an inverted reference range (low greater than high)", () => {
    const issues = validateObservation(mapped({ range: { low: 20, high: 10 } }));
    expect(issues).toContainEqual(expect.objectContaining({ code: "INCOHERENT_RANGE" }));
  });

  it("does not flag a coherent range", () => {
    const issues = validateObservation(mapped({ range: { low: 10, high: 20 } }));
    expect(issues.map((i) => i.code)).not.toContain("INCOHERENT_RANGE");
  });

  it("does not flag a single-sided range as incoherent", () => {
    const issues = validateObservation(mapped({ range: { high: 200 } }));
    expect(issues.map((i) => i.code)).not.toContain("INCOHERENT_RANGE");
  });

  it("flags a value/range unit mismatch", () => {
    const issues = validateObservation(
      mapped({ unit: "mg/dL", range: { low: 3.5, high: 5.1, unit: "mEq/L" } }),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: "UNIT_MISMATCH" }));
  });

  it("does not flag matching units", () => {
    const issues = validateObservation(
      mapped({ unit: "mg/dL", range: { low: 10, high: 40, unit: "mg/dL" } }),
    );
    expect(issues.map((i) => i.code)).not.toContain("UNIT_MISMATCH");
  });

  it("flags an implausibly high value as a likely decimal-point OCR error", () => {
    // A potassium of 400 against a 3.5-5.1 range is almost certainly "4.00" with the
    // decimal point dropped by OCR — silently accepting it would be the worst failure
    // mode here: numerically valid, confidently labelled, and wrong.
    const issues = validateObservation(
      mapped({ rawValue: "400", value: 400, unit: "mEq/L", range: { low: 3.5, high: 5.1 } }),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: "IMPLAUSIBLE_VALUE" }));
  });

  it("flags an implausibly low value the same way", () => {
    const issues = validateObservation(
      mapped({ rawValue: "0.04", value: 0.04, unit: "mEq/L", range: { low: 3.5, high: 5.1 } }),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: "IMPLAUSIBLE_VALUE" }));
  });

  it("does not flag a value that is legitimately outside its range", () => {
    // A hemoglobin of 6.5 is a real, clinically significant low result, not a 10x OCR
    // error — the plausibility check must not fire on ordinary abnormal results.
    const issues = validateObservation(mapped({ rawValue: "6.5", value: 6.5 }));
    expect(issues.map((i) => i.code)).not.toContain("IMPLAUSIBLE_VALUE");
  });

  it("returns multiple issues when a row fails more than one check", () => {
    const issues = validateObservation(
      mapped({ rawValue: "11.2*", value: 11.2, unit: undefined, range: { low: 20, high: 10 } }),
    );
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("VALUE_NOT_A_CLEAN_NUMBER");
    expect(codes).toContain("MISSING_UNIT");
    expect(codes).toContain("INCOHERENT_RANGE");
  });
});

describe("collectNeedsReview", () => {
  it("lists only the names of observations with at least one issue, deduplicated", () => {
    const clean = mapped({ name: "Sodium", rawValue: "140", value: 140, range: { low: 136, high: 145 } });
    const dirty = mapped({ name: "Hemoglobin", rawValue: "11.2*", value: 11.2 });
    const alsoDirty = mapped({ name: "Hemoglobin", rawValue: "18 H", value: 18 });

    expect(collectNeedsReview([clean, dirty, alsoDirty])).toEqual(["Hemoglobin"]);
  });

  it("returns an empty array when every observation is clean", () => {
    expect(collectNeedsReview([mapped({})])).toEqual([]);
  });
});
