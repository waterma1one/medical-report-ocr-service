import { describe, expect, it } from "vitest";
import { mapToObservation } from "../src/fhir/mapper.js";
import type { RawObservation } from "../src/parsing/parser.js";

// exactOptionalPropertyTypes forbids explicit `undefined` on RawObservation's own
// optional fields, but tests need to override a default away (e.g. "this case has no
// unit"). Loosen only this helper's input type, then drop the resulting undefined
// keys so the return value still satisfies the real contract.
type Overrides = { [K in keyof RawObservation]?: RawObservation[K] | undefined };

function raw(overrides: Overrides): RawObservation {
  const merged: Record<string, unknown> = {
    name: "Hemoglobin",
    rawValue: "15.00",
    value: 15,
    unit: "g/dL",
    ...overrides,
  };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  return merged as unknown as RawObservation;
}

describe("mapToObservation — basic shape", () => {
  it("sets status to preliminary and code.text to the name as found", () => {
    const { observation } = mapToObservation(raw({ name: "Hemoglobin (Photometry)" }));
    expect(observation.resourceType).toBe("Observation");
    expect(observation.status).toBe("preliminary");
    expect(observation.code.text).toBe("Hemoglobin (Photometry)");
  });

  it("adds a LOINC coding only on a hit", () => {
    const hit = mapToObservation(raw({ name: "Hemoglobin" }));
    expect(hit.observation.code.coding).toEqual([
      { system: "http://loinc.org", code: "718-7", display: "Hemoglobin" },
    ]);

    const miss = mapToObservation(raw({ name: "Some Unlisted Analyte" }));
    expect(miss.observation.code.coding).toBeUndefined();
  });
});

describe("mapToObservation — valueQuantity", () => {
  it("carries the printed unit and the resolved UCUM code together", () => {
    const { observation } = mapToObservation(raw({ unit: "g/dL" }));
    expect(observation.valueQuantity).toEqual({
      value: 15,
      unit: "g/dL",
      system: "http://unitsofmeasure.org",
      code: "g/dL",
    });
  });

  it("omits system and code together when the unit doesn't resolve to UCUM", () => {
    const { observation } = mapToObservation(raw({ unit: "some-unrecognised-unit" }));
    expect(observation.valueQuantity?.unit).toBe("some-unrecognised-unit");
    expect(observation.valueQuantity?.system).toBeUndefined();
    expect(observation.valueQuantity?.code).toBeUndefined();
  });

  it("omits valueQuantity entirely for a qualitative result", () => {
    const { observation } = mapToObservation(
      raw({ name: "GFR Category", rawValue: "G1", value: undefined, unit: undefined }),
    );
    expect(observation.valueQuantity).toBeUndefined();
  });

  it("carries a comparator through to Quantity.comparator", () => {
    // The parser extracts the comparator and hands the mapper a value plus a
    // comparator; the mapper does not re-parse the printed string.
    const { observation } = mapToObservation(
      raw({ rawValue: "<0.5", value: 0.5, comparator: "<", unit: "mg/dL" }),
    );
    expect(observation.valueQuantity?.value).toBe(0.5);
    expect(observation.valueQuantity?.comparator).toBe("<");
  });

  it("emits each FHIR comparator form the parser can produce", () => {
    for (const comparator of ["<", "<=", ">", ">="] as const) {
      const { observation } = mapToObservation(
        raw({ rawValue: `${comparator}0.5`, value: 0.5, comparator }),
      );
      expect(observation.valueQuantity?.comparator).toBe(comparator);
    }
  });
});

describe("mapToObservation — referenceRange and obs-3", () => {
  it("emits low and high with the same unit as the value", () => {
    const { observation } = mapToObservation(
      raw({ range: { low: 13, high: 17 }, unit: "g/dL" }),
    );
    expect(observation.referenceRange).toEqual([
      {
        low: { value: 13, unit: "g/dL", system: "http://unitsofmeasure.org", code: "g/dL" },
        high: { value: 17, unit: "g/dL", system: "http://unitsofmeasure.org", code: "g/dL" },
      },
    ]);
  });

  it("never puts a comparator on a referenceRange bound (SimpleQuantity profile)", () => {
    const { observation } = mapToObservation(raw({ range: { high: 200 } }));
    const bound = observation.referenceRange?.[0]?.high;
    expect(bound).toBeDefined();
    expect(bound && "comparator" in bound).toBe(false);
  });

  it("omits referenceRange entirely rather than emitting an empty element (obs-3)", () => {
    const { observation } = mapToObservation(raw({ range: undefined }));
    expect(observation.referenceRange).toBeUndefined();

    const emptyRange = mapToObservation(raw({ range: {} }));
    expect(emptyRange.observation.referenceRange).toBeUndefined();
  });

  it("keeps range.text for a non-numeric range without low or high", () => {
    const { observation } = mapToObservation(
      raw({ range: { text: "Male: 13-17 Female: 12-15" } }),
    );
    expect(observation.referenceRange).toEqual([{ text: "Male: 13-17 Female: 12-15" }]);
  });
});

describe("mapToObservation — interpretation derivation", () => {
  it("flags Low when the value is under the low bound", () => {
    const { observation } = mapToObservation(raw({ value: 11.2, range: { low: 12, high: 16 } }));
    expect(observation.interpretation?.[0]?.coding?.[0]).toMatchObject({ code: "L" });
  });

  it("flags High when the value is over the high bound", () => {
    const { observation } = mapToObservation(raw({ value: 18, range: { low: 12, high: 16 } }));
    expect(observation.interpretation?.[0]?.coding?.[0]).toMatchObject({ code: "H" });
  });

  it("flags Normal when the value sits inside the range", () => {
    const { observation } = mapToObservation(raw({ value: 14, range: { low: 12, high: 16 } }));
    expect(observation.interpretation?.[0]?.coding?.[0]).toMatchObject({ code: "N" });
  });

  it("derives High from a high-only range", () => {
    const { observation } = mapToObservation(raw({ value: 250, range: { high: 200 } }));
    expect(observation.interpretation?.[0]?.coding?.[0]).toMatchObject({ code: "H" });
  });

  it("derives Low from a low-only range", () => {
    const { observation } = mapToObservation(raw({ value: 30, range: { low: 40 } }));
    expect(observation.interpretation?.[0]?.coding?.[0]).toMatchObject({ code: "L" });
  });

  it("omits interpretation when there is no range at all", () => {
    const { observation } = mapToObservation(raw({ range: undefined }));
    expect(observation.interpretation).toBeUndefined();
  });

  it("omits interpretation for a comparator-bounded value rather than guessing", () => {
    const { observation } = mapToObservation(
      raw({ rawValue: "<0.5", value: undefined, range: { low: 1, high: 5 } }),
    );
    expect(observation.interpretation).toBeUndefined();
  });

  it("omits interpretation when the value and range units don't agree", () => {
    const { observation } = mapToObservation(
      raw({ value: 100, unit: "mg/dL", range: { low: 3.5, high: 5.1, unit: "mEq/L" } }),
    );
    expect(observation.interpretation).toBeUndefined();
  });

  it("uses the correct interpretation system URI", () => {
    const { observation } = mapToObservation(raw({ value: 18, range: { low: 12, high: 16 } }));
    expect(observation.interpretation?.[0]?.coding?.[0]?.system).toBe(
      "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
    );
  });
});
