import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseObservations } from "../src/parsing/parser.js";

const fixture = readFileSync("tests/fixtures/lalpath-cbc-panel.md", "utf-8");

describe("parseObservations — table shapes", () => {
  it("parses a table with recognisable headers", () => {
    const md = [
      "| Test Name | Results | Units | Ref. Interval |",
      "|---|---|---|---|",
      "| Hemoglobin | 15.00 | g/dL | 13.00 - 17.00 |",
      "| Platelet Count | 151 | thou/mm3 | 150.00 - 410.00 |",
    ].join("\n");

    expect(parseObservations(md)).toEqual([
      expect.objectContaining({ name: "Hemoglobin", value: 15, unit: "g/dL" }),
      expect.objectContaining({ name: "Platelet Count", value: 151, unit: "thou/mm3" }),
    ]);
  });

  it("parses a headerless table positionally", () => {
    const md = [
      "|  |  |  |  |",
      "|---|---|---|---|",
      "| T3, Total | 1.00 | ng/dL | 0.60 - 1.81 |",
      "| TSH | 3.00 | µIU/mL | 0.550 - 4.780 |",
    ].join("\n");

    const observations = parseObservations(md);
    // The name column must not be mistaken for the unit column on a blank-header table.
    expect(observations[0]?.name).toBe("T3, Total");
    expect(observations[0]?.unit).toBe("ng/dL");
    expect(observations[1]?.name).toBe("TSH");
  });

  it("aligned separator rows are still recognised as separators", () => {
    const md = [
      "| Test Name | Results | Units | Ref. Interval |",
      "|:---|---:|:--:|---|",
      "| Sodium | 140.00 | mEq/L | 136.00 - 145.00 |",
      "| Potassium | 4.00 | mEq/L | 3.50 - 5.10 |",
    ].join("\n");

    expect(parseObservations(md)).toHaveLength(2);
  });
});

describe("parseObservations — noise rejection", () => {
  it("rejects a risk-category table even though it carries valid headers", () => {
    // Real reports embed treatment-goal tables with the exact result-table headers.
    // Every cell is a threshold, so no column holds plain numeric values.
    const md = [
      "| Test Name | Results | Units | Ref. Interval |",
      "|---|---|---|---|",
      "| High | <70 | <100 | ≥70 |",
      "| Moderate | <100 | <130 | ≥100 |",
      "| Low | <100 | <130 | ≥130 |",
    ].join("\n");

    expect(parseObservations(md)).toEqual([]);
  });

  it("rejects a banded reference table", () => {
    const md = [
      "| LEVEL | REFERENCE RANGE IN nmol/L | COMMENTS |",
      "|---|---|---|",
      "| Deficient | < 50 | High risk for bone disease |",
      "| Sufficient | 75-250 | Optimal concentration |",
    ].join("\n");

    expect(parseObservations(md)).toEqual([]);
  });

  it("rejects a patient demographics table", () => {
    const md = [
      "|  |  |  |  |",
      "|---|---|---|---|",
      "| Name | : Mr. DUMMY | Age | : 25 Years |",
      "| Lab No. | : WM17SPF | Gender | : Male |",
      "| Ref By | : SELF | Reported | : 17/1/2024 |",
    ].join("\n");

    expect(parseObservations(md)).toEqual([]);
  });

  it("accepts a wholly qualitative panel when the header names both columns", () => {
    // A blood group report carries no numbers and no units anywhere, so neither of the
    // numeric acceptance paths can fire. The explicit header is what distinguishes it
    // from a demographics block.
    const md = [
      "| INVESTIGATION | RESULT | UNIT | BIOLOGICAL REFERENCE INTERVAL |",
      "|---|---|---|---|",
      "| <b>BLOOD GROUP BY GEL METHOD</b> |  |  |  |",
      "| ABO SYSTEM | O |  |  |",
      "| RHESUS SYSTEM | POSITIVE |  |  |",
      "| BLOOD GROUP | O POSITIVE |  |  |",
    ].join("\n");

    const observations = parseObservations(md);
    expect(observations.map((o) => o.name)).toEqual([
      "ABO SYSTEM",
      "RHESUS SYSTEM",
      "BLOOD GROUP",
    ]);
    expect(observations[0]?.rawValue).toBe("O");
    expect(observations[0]?.value).toBeUndefined();
  });

  it("rejects a qualitative table whose header names only one of the two columns", () => {
    const md = [
      "| INVESTIGATION | COMMENTS | NOTE |",
      "|---|---|---|",
      "| Sample condition | Adequate |  |",
      "| Storage | Refrigerated |  |",
    ].join("\n");

    expect(parseObservations(md)).toEqual([]);
  });

  it("drops a METHOD row, which names the assay rather than a result", () => {
    const md = [
      "| INVESTIGATION | RESULT | UNIT | BIOLOGICAL REFERENCE INTERVAL |",
      "|---|---|---|---|",
      "| ABO SYSTEM | O |  |  |",
      "| RHESUS SYSTEM | POSITIVE |  |  |",
      "| METHOD | GEL METHOD |  |  |",
    ].join("\n");

    expect(parseObservations(md).map((o) => o.name)).toEqual(["ABO SYSTEM", "RHESUS SYSTEM"]);
  });

  it("drops a bold panel-heading row that has no value", () => {
    const md = [
      "| Test Name | Results | Units | Ref. Interval |",
      "|---|---|---|---|",
      "| <b>COMPLETE BLOOD COUNT; CBC</b> |  |  |  |",
      "| Hemoglobin | 15.00 | g/dL | 13.00 - 17.00 |",
      "| Packed Cell Volume | 45.00 | % | 40.00 - 50.00 |",
    ].join("\n");

    const observations = parseObservations(md);
    expect(observations).toHaveLength(2);
    expect(observations.map((o) => o.name)).not.toContain("COMPLETE BLOOD COUNT; CBC");
  });

  it("preserves a row whose result did not survive OCR, marked as missing", () => {
    // The row names a test and carries a unit and a reference range, so the test was
    // genuinely ordered — only the result cell was lost. Dropping it silently would
    // hide the fact that the test exists at all.
    const md = [
      "| Test Name | Results | Units | Ref. Interval |",
      "|---|---|---|---|",
      "| Uric Acid |  | mg/dL | 3.50 - 7.20 |",
      "| Urea | 40.00 | mg/dL | 13.00 - 43.00 |",
      "| Creatinine | 1.00 | mg/dL | 0.70 - 1.30 |",
    ].join("\n");

    const observations = parseObservations(md);
    expect(observations.map((o) => o.name)).toEqual(["Uric Acid", "Urea", "Creatinine"]);
    expect(observations[0]?.valueMissing).toBe(true);
    expect(observations[0]?.value).toBeUndefined();
  });
});

describe("parseObservations — cell cleaning", () => {
  it("joins a method annotation split by <br> and strips <sup> from units", () => {
    const md = [
      "|  |  |  |  |",
      "|---|---|---|---|",
      "| Creatinine<br>(Modified Jaffe,Kinetic) | 1.00 | mg/dL | 0.70 - 1.30 |",
      "| GFR Estimated<br>(CKD EPI Equation 2021) | 107 | mL/min/1.73m <sup>2</sup> | >59 |",
    ].join("\n");

    const observations = parseObservations(md);
    expect(observations[0]?.name).toBe("Creatinine (Modified Jaffe,Kinetic)");
    expect(observations[1]?.unit).toBe("mL/min/1.73m2");
    expect(observations[1]?.range).toEqual({ low: 59 });
  });

  it("keeps a qualitative value while recording that it isn't numeric", () => {
    const md = [
      "|  |  |  |  |",
      "|---|---|---|---|",
      "| Creatinine | 1.00 | mg/dL | 0.70 - 1.30 |",
      "| Urea | 40.00 | mg/dL | 13.00 - 43.00 |",
      "| GFR Category | G1 |  |  |",
    ].join("\n");

    const qualitative = parseObservations(md).find((o) => o.name === "GFR Category");
    expect(qualitative).toBeDefined();
    expect(qualitative?.rawValue).toBe("G1");
    expect(qualitative?.value).toBeUndefined();
  });

  it("parses a value carrying an abnormality flag", () => {
    const md = [
      "| Test Name | Results | Units | Ref. Interval |",
      "|---|---|---|---|",
      "| Hemoglobin | 11.2* | g/dL | 13.00 - 17.00 |",
      "| Glucose | 240 H | mg/dL | 70 - 100 |",
    ].join("\n");

    const observations = parseObservations(md);
    expect(observations[0]).toMatchObject({ rawValue: "11.2*", value: 11.2 });
    expect(observations[1]).toMatchObject({ rawValue: "240 H", value: 240 });
  });
});

describe("parseObservations — against the real Datalab fixture", () => {
  const observations = parseObservations(fixture);

  it("extracts the full panel", () => {
    expect(observations.length).toBeGreaterThan(45);
  });

  it("extracts no demographic or reference-guide rows", () => {
    const names = observations.map((o) => o.name.toLowerCase());
    for (const forbidden of ["name", "lab no.", "gender", "age", "high", "moderate", "deficient"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("assigns 1-based page numbers spanning the report", () => {
    const pages = [...new Set(observations.map((o) => o.page))].sort((a, b) => a! - b!);
    expect(pages[0]).toBe(1);
    expect(pages.length).toBeGreaterThan(3);
  });

  it("keeps repeated test names that are genuinely distinct observations", () => {
    // The differential reports Lymphocytes twice: once as a percentage and once as an
    // absolute count. Both are real results and both must survive.
    const lymphocytes = observations.filter((o) => o.name === "Lymphocytes");
    expect(lymphocytes).toHaveLength(2);
    expect(new Set(lymphocytes.map((o) => o.unit))).toEqual(new Set(["%", "thou/mm3"]));
  });

  it("resolves single-sided ranges from the lipid panel", () => {
    const cholesterol = observations.find((o) => o.name.startsWith("Cholesterol, Total"));
    expect(cholesterol?.range).toEqual({ high: 200 });
    const hdl = observations.find((o) => o.name.startsWith("HDL Cholesterol"));
    expect(hdl?.range).toEqual({ low: 40 });
  });
});
