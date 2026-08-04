import { describe, expect, it } from "vitest";
import { lookupLoinc } from "../src/fhir/loinc.js";

describe("lookupLoinc", () => {
  it("matches an exact display name", () => {
    expect(lookupLoinc("Hemoglobin")).toEqual({ code: "718-7", display: "Hemoglobin" });
  });

  it("matches through a method annotation", () => {
    expect(lookupLoinc("Creatinine (Modified Jaffe,Kinetic)")?.code).toBe("2160-0");
  });

  it("matches a British spelling alias", () => {
    expect(lookupLoinc("Haemoglobin")?.code).toBe("718-7");
  });

  it("matches an Indian-lab abbreviation alias", () => {
    expect(lookupLoinc("TLC")?.code).toBe("6690-2");
  });

  it("matches despite a comma the report inserted", () => {
    expect(lookupLoinc("Cholesterol, Total (CHO-POD)")?.code).toBe("2093-3");
    expect(lookupLoinc("T3, Total")?.code).toBe("3053-6");
  });

  it("is case-insensitive", () => {
    expect(lookupLoinc("HAEMOGLOBIN")?.code).toBe("718-7");
  });

  it("returns undefined for a test not in the table, without throwing", () => {
    expect(lookupLoinc("Some Unlisted Test (Novel Method)")).toBeUndefined();
  });
});

describe("lookupLoinc — method suffixes without parentheses", () => {
  // Many labs append the method to the analyte name unbracketed, which no amount of
  // paren-stripping removes. Matching walks back word by word, but only across words
  // that describe a method.
  it.each([
    ["SODIUM ISE direct", "2951-2"],
    ["ALBUMIN BCG", "1751-7"],
    ["HEMOGLOBIN SLS Hemoglobin", "718-7"],
    ["MCV Calculated", "787-2"],
    ["WBC Flowcytometry", "6690-2"],
    ["PLATELET COUNT Hydrodynamically focused DC detection", "777-3"],
    ["UREA LEVEL UK", "3094-0"],
    ["BILIRUBIN, TOTAL Modified Jendrassik", "1975-2"],
  ])("matches %s", (name, code) => {
    expect(lookupLoinc(name)?.code).toBe(code);
  });

  it.each([
    "ALBUMIN : GLOBULIN RATIO Calculated",
    "GLOBULIN Calculated",
    "ABSOLUTE NEUTROPHIL Calculated",
    "BILIRUBIN, UNCONJUGATED Calculated",
  ])("refuses to shorten %s into a different analyte", (name) => {
    // Reporting the wrong LOINC code is materially worse than reporting none: a
    // consumer has no way to tell that "ALBUMIN : GLOBULIN RATIO" was coded as plain
    // Albumin.
    expect(lookupLoinc(name)).toBeUndefined();
  });
});
