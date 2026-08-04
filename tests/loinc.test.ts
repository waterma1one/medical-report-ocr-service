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
