import { describe, expect, it } from "vitest";
import { parseReferenceRange, isEmittableRange } from "../src/parsing/referenceRange.js";

describe("parseReferenceRange", () => {
  describe("bounded ranges", () => {
    it.each([
      ["13.00 - 17.00", 13, 17],
      ["0.550 - 4.780", 0.55, 4.78],
      ["0 - 73", 0, 73],
      ["12.0-16.0", 12, 16],
      ["12.0 – 16.0", 12, 16],
      ["12.0 — 16.0", 12, 16],
      ["12.0 to 16.0", 12, 16],
    ])("parses %s", (input, low, high) => {
      expect(parseReferenceRange(input)).toEqual({ low, high });
    });

    it("parses Indian digit grouping", () => {
      expect(parseReferenceRange("1,50,000 - 4,50,000")).toEqual({ low: 150000, high: 450000 });
    });
  });

  describe("single-sided ranges", () => {
    it.each([
      ["<200.00", 200],
      ["< 200", 200],
      ["≤200", 200],
      ["<=200", 200],
      ["Up to 40", 40],
      ["Upto 40", 40],
    ])("parses %s as an upper bound", (input, high) => {
      expect(parseReferenceRange(input)).toEqual({ high });
    });

    it.each([
      [">40.00", 40],
      ["> 59", 59],
      ["≥40", 40],
      [">=40", 40],
    ])("parses %s as a lower bound", (input, low) => {
      expect(parseReferenceRange(input)).toEqual({ low });
    });
  });

  describe("units embedded in the range cell", () => {
    it("splits a trailing unit off a bounded range", () => {
      const result = parseReferenceRange("0.4 - 4.0 µIU/mL");
      expect(result?.low).toBe(0.4);
      expect(result?.high).toBe(4);
      // NFKC folds U+00B5 MICRO SIGN to U+03BC GREEK SMALL LETTER MU. Both render
      // identically; unit lookup folds either to ASCII "u" anyway.
      expect(result?.unit).toBe("μIU/mL");
    });
  });

  describe("LaTeX from Marker", () => {
    it("converts LaTeX comparison operators", () => {
      expect(parseReferenceRange("$\\geq 6.5$")).toEqual({ low: 6.5 });
      expect(parseReferenceRange("$<7.0$")).toEqual({ high: 7 });
    });
  });

  describe("non-numeric ranges are preserved as text", () => {
    it.each([
      "Male: 13-17 Female: 12-15",
      "Desirable: <200, Borderline: 200-239",
      "Non-Reactive",
    ])("keeps %s as text", (input) => {
      const result = parseReferenceRange(input);
      expect(result?.text).toBe(input);
      expect(result?.low).toBeUndefined();
      expect(result?.high).toBeUndefined();
    });
  });

  describe("empty markers yield no range at all (obs-3)", () => {
    it.each(["", "  ", "-", "--", "NA", "N/A", "Nil", "Not Established"])(
      "returns undefined for %s",
      (input) => {
        expect(parseReferenceRange(input)).toBeUndefined();
      },
    );
  });
});

describe("isEmittableRange", () => {
  it("rejects undefined and empty objects, accepts any populated bound", () => {
    expect(isEmittableRange(undefined)).toBe(false);
    expect(isEmittableRange({})).toBe(false);
    expect(isEmittableRange({ low: 1 })).toBe(true);
    expect(isEmittableRange({ high: 1 })).toBe(true);
    expect(isEmittableRange({ text: "Male: 13-17" })).toBe(true);
  });
});
