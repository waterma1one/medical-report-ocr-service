import { describe, expect, it } from "vitest";
import { parseObservations, parseReport } from "../src/parsing/parser.js";
import { mapToObservation } from "../src/fhir/mapper.js";
import { validateObservation, reviewObservations } from "../src/validation/validator.js";
import type { RawObservation } from "../src/parsing/parser.js";

type Overrides = { [K in keyof RawObservation]?: RawObservation[K] | undefined };

function mapped(overrides: Overrides) {
  const merged: Record<string, unknown> = {
    name: "Haemoglobin",
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

function table(...rows: string[]): string {
  return rows.join("\n");
}

// Each block below reproduces a defect found in review. All were verified to fail
// against the previous implementation before the fix landed.

describe("regression: a decimal-point shift must be flagged", () => {
  // The original rule was `value > high * 10`. A 10x shift of a true value V only
  // trips that when V > high, so any in-range result that got shifted was
  // mathematically invisible — the exact case the check existed for.
  it("flags haemoglobin 112 (true 11.2) against a 13-17 range", () => {
    const issues = validateObservation(mapped({ rawValue: "112", value: 112 }));
    expect(issues.map((i) => i.code)).toContain("IMPLAUSIBLE_VALUE");
  });

  it("flags potassium 41 (true 4.1) against a 3.5-5.1 range", () => {
    const issues = validateObservation(
      mapped({ rawValue: "41", value: 41, unit: "mmol/L", range: { low: 3.5, high: 5.1 } }),
    );
    expect(issues.map((i) => i.code)).toContain("IMPLAUSIBLE_VALUE");
  });

  it("flags glucose 1400 (true 140) at exactly 10x the high bound", () => {
    const issues = validateObservation(
      mapped({ rawValue: "1400", value: 1400, unit: "mg/dL", range: { low: 70, high: 140 } }),
    );
    expect(issues.map((i) => i.code)).toContain("IMPLAUSIBLE_VALUE");
  });

  it("still does not flag a genuinely abnormal result that no rescale explains", () => {
    const issues = validateObservation(mapped({ rawValue: "6.5", value: 6.5 }));
    expect(issues.map((i) => i.code)).not.toContain("IMPLAUSIBLE_VALUE");
  });

  it("does not fire on a one-sided range, where any rescale trivially lands inside", () => {
    // HDL 25 against "> 40" is a real low HDL. Rescaling to 250 satisfies a range
    // with no upper bound, so the shift heuristic must not apply here at all.
    const issues = validateObservation(
      mapped({ rawValue: "25", value: 25, unit: "mg/dL", range: { low: 40 } }),
    );
    expect(issues.map((i) => i.code)).not.toContain("IMPLAUSIBLE_VALUE");
  });
});

describe("regression: qualitative results must reach the Bundle", () => {
  // Previously an unparseable value set no value[x] at all, so a positive result
  // rendered as "test performed, no result recorded".
  it("keeps a positive serology result as valueString", () => {
    const { observation } = mapped({
      name: "HBsAg (ELISA)",
      rawValue: "POSITIVE",
      value: undefined,
      unit: undefined,
      range: { text: "Negative" },
    });
    expect(observation.valueString).toBe("POSITIVE");
  });

  it("keeps a CKD stage as valueString", () => {
    const { observation } = mapped({
      name: "GFR Category",
      rawValue: "G1",
      value: undefined,
      unit: undefined,
      range: undefined,
    });
    expect(observation.valueString).toBe("G1");
  });
});

describe("regression: real analyte names must not be dropped as header rows", () => {
  // The old heuristic matched /test|investigation|.../ against data cells, so any
  // analyte containing "test" was discarded.
  it("keeps Testosterone and Widal Test rows", () => {
    const names = parseObservations(
      table(
        "| Investigation | Result | Bio. Ref. Interval |",
        "|---|---|---|",
        "| Widal Test O Titre | 80 | < 80 |",
        "| Testosterone Total | 450 | 240 - 870 |",
        "| Haemoglobin | 13.5 | 13.0 - 17.0 |",
      ),
    ).map((o) => o.name);

    expect(names).toContain("Widal Test O Titre");
    expect(names).toContain("Testosterone Total");
    expect(names).toContain("Haemoglobin");
  });

  it("still excludes the actual header row", () => {
    const names = parseObservations(
      table(
        "| Particulars | Result | UOM | Bio. Ref. Interval |",
        "|---|---|---|---|",
        "| Haemoglobin | 13.5 | g/dL | 13.0 - 17.0 |",
        "| Creatinine | 1.0 | mg/dL | 0.7 - 1.3 |",
      ),
    ).map((o) => o.name);

    expect(names).toEqual(["Haemoglobin", "Creatinine"]);
  });
});

describe("regression: single-analyte and all-comparator panels must parse", () => {
  it("parses a standalone single-row report", () => {
    const observations = parseObservations(
      table(
        "| Test Name | Result | Units | Ref. Interval |",
        "|---|---|---|---|",
        "| TSH | 2.50 | uIU/mL | 0.40 - 4.00 |",
      ),
    );
    expect(observations).toHaveLength(1);
    expect(observations[0]?.value).toBe(2.5);
  });

  it("parses a panel where every value is comparator-bounded", () => {
    const observations = parseObservations(
      table(
        "| Test | Result | Units | Ref. Interval |",
        "|---|---|---|---|",
        "| Troponin I | <0.01 | ng/mL | <0.04 |",
        "| CRP | <5 | mg/L | <6 |",
      ),
    );
    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({ value: 0.01, comparator: "<" });
  });

  it("still rejects a risk-category reference table", () => {
    expect(
      parseObservations(
        table(
          "| Test Name | Results | Units | Ref. Interval |",
          "|---|---|---|---|",
          "| High | <70 | <100 | ≥70 |",
          "| Moderate | <100 | <130 | ≥100 |",
          "| Low | <100 | <130 | ≥130 |",
        ),
      ),
    ).toEqual([]);
  });
});

describe("regression: a non-UCUM index unit must not sink the gate", () => {
  // Immunoassay panels commonly report a Cut-off Index ("COI") or Signal/Cutoff
  // ratio instead of a physical unit. Neither resolves to UCUM, so the unit-column
  // gate must fall back to recognising them by name rather than requiring a UCUM hit.
  it("parses a single-row table whose unit is COI", () => {
    const observations = parseObservations(
      table(
        "| Investigation | Result | Unit | Biological Reference |",
        "|---|---|---|---|",
        "| HIV I & II Antibodies (ELISA) | 0.08 | COI | Non Reactive: < 0.90 |",
      ),
    );
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ value: 0.08, unit: "COI" });
  });

  it("still rejects a risk-category table with plain-English category cells", () => {
    // The fix must not widen the gate into matching ordinary words like "High" or
    // "Deficient" as a unit — only explicit index/ratio terms and slash-containing
    // tokens qualify.
    expect(
      parseObservations(
        table(
          "| Test Name | Results | Units | Ref. Interval |",
          "|---|---|---|---|",
          "| High | <70 | <100 | >=70 |",
          "| Moderate | <100 | <130 | >=100 |",
        ),
      ),
    ).toEqual([]);
  });
});

describe("regression: a serial-number column must not become the value column", () => {
  it("uses the real result column, not the row index", () => {
    const observations = parseObservations(
      table(
        "|  |  |  |  |  |",
        "|---|---|---|---|---|",
        "| 1 | Haemoglobin | 13.5 | g/dL | 13.0 - 17.0 |",
        "| 2 | RBC Count | 4.8 | million/cumm | 4.5 - 5.5 |",
        "| 3 | Platelet Count | 250 | thou/mm3 | 150 - 410 |",
      ),
    );

    const rbc = observations.find((o) => o.name === "RBC Count");
    expect(rbc?.value).toBe(4.8);
    expect(observations.find((o) => o.name === "Haemoglobin")?.value).toBe(13.5);
  });
});

describe("regression: a table continued across a page break keeps its tail", () => {
  it("does not lose a single continuation row", () => {
    const names = parseObservations(
      [
        "{0}------------------------------------------------",
        "| Test Name | Result | Units | Ref. Interval |",
        "|---|---|---|---|",
        "| Haemoglobin | 13.5 | g/dL | 13.0 - 17.0 |",
        "| RBC Count | 4.8 | million/cumm | 4.5 - 5.5 |",
        "{1}------------------------------------------------",
        "| Platelet Count | 250 | thou/mm3 | 150 - 410 |",
      ].join("\n"),
    ).map((o) => o.name);

    expect(names).toContain("Platelet Count");
  });
});

describe("regression: an over-long test name is truncated, not dropped", () => {
  it("keeps the observation", () => {
    const longName =
      "Thyroid Stimulating Hormone (TSH) Ultrasensitive (Chemiluminescent Microparticle Immunoassay, CMIA)";
    const observations = parseObservations(
      table(
        "| Test | Result | Units | Ref. Interval |",
        "|---|---|---|---|",
        `| ${longName} | 2.50 | uIU/mL | 0.40 - 4.00 |`,
        "| Prolactin | 12.0 | ng/mL | 4.0 - 15.2 |",
      ),
    );
    expect(observations).toHaveLength(2);
    expect(observations[0]?.name.length).toBeLessThanOrEqual(80);
  });
});

describe("regression: an ordered test with no readable result is preserved", () => {
  it("emits it with dataAbsentReason instead of dropping it", () => {
    const observations = parseObservations(
      table(
        "| Test Name | Result | Units | Ref. Interval |",
        "|---|---|---|---|",
        "| Uric Acid |  | mg/dL | 3.50 - 7.20 |",
        "| Urea | 40.00 | mg/dL | 13.00 - 43.00 |",
        "| Creatinine | 1.00 | mg/dL | 0.70 - 1.30 |",
      ),
    );

    const uricAcid = observations.find((o) => o.name === "Uric Acid");
    expect(uricAcid?.valueMissing).toBe(true);

    const { observation } = mapToObservation(uricAcid as RawObservation);
    expect(observation.dataAbsentReason?.coding?.[0]?.code).toBe("unknown");
    expect(validateObservation({ observation, raw: uricAcid as RawObservation }).map((i) => i.code)).toContain(
      "VALUE_MISSING",
    );
  });
});

describe("regression: the lab's own abnormality flag survives", () => {
  it("maps a printed H flag to interpretation even with no reference range", () => {
    const observations = parseObservations(
      table(
        "| Test | Result | Units |",
        "|---|---|---|",
        "| Potassium | 6.8 H | mmol/L |",
        "| Sodium | 140 | mmol/L |",
      ),
    );

    const potassium = observations.find((o) => o.name === "Potassium");
    expect(potassium?.value).toBe(6.8);
    expect(potassium?.flag).toBe("H");

    const { observation } = mapToObservation(potassium as RawObservation);
    expect(observation.interpretation?.[0]?.coding?.[0]?.code).toBe("H");
  });

  it("prefers the lab's flag over a derived interpretation", () => {
    const { observation } = mapped({ rawValue: "15 L", value: 15, flag: "L" });
    // 15 sits inside 13-17, so derivation alone would say "N".
    expect(observation.interpretation?.[0]?.coding?.[0]?.code).toBe("L");
  });
});

describe("regression: validation issues reach the client", () => {
  it("attaches the specific reason to the Observation as a note", () => {
    const dirty = mapped({ rawValue: "11.2*", value: 11.2, unit: undefined });
    const { needsReview } = reviewObservations([dirty]);

    expect(needsReview).toContain("Haemoglobin");
    const noteText = (dirty.observation.note ?? []).map((n) => n.text).join(" ");
    expect(noteText).toContain("MISSING_UNIT");
  });
});

describe("regression: parse statistics are produced for observability", () => {
  it("reports tables seen, accepted, and rows dropped by reason", () => {
    const { stats } = parseReport(
      table(
        "| Test Name | Results | Units | Ref. Interval |",
        "|---|---|---|---|",
        "| High | <70 | <100 | ≥70 |",
        "| Moderate | <100 | <130 | ≥100 |",
      ),
    );
    expect(stats.tablesSeen).toBe(1);
    expect(stats.tablesAccepted).toBe(0);
    expect(stats.droppedByReason["table_not_observations"]).toBe(1);
  });
});
