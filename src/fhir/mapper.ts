import { randomUUID } from "node:crypto";
import type { RawObservation } from "../parsing/parser.js";
import { isEmittableRange, type ParsedRange } from "../parsing/referenceRange.js";
import { lookupLoinc } from "./loinc.js";
import { resolveUnit, unitsAreComparable } from "../parsing/units.js";

export interface MappedObservation {
  observation: fhir4.Observation;
  raw: RawObservation;
}

const INTERPRETATION_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation";

const INTERPRETATION_DISPLAY: Record<string, string> = {
  H: "High",
  L: "Low",
  N: "Normal",
  HH: "Critical high",
  LL: "Critical low",
  A: "Abnormal",
};

export function mapToObservation(raw: RawObservation): MappedObservation {
  const loinc = lookupLoinc(raw.name);
  const unit = resolveUnit(raw.unit);

  const observation: fhir4.Observation = {
    resourceType: "Observation",
    id: randomUUID(),
    status: "preliminary",
    code: buildCode(raw.name, loinc),
  };

  if (raw.value !== undefined) {
    observation.valueQuantity = buildQuantity(raw.value, unit, raw.comparator);
  } else if (raw.valueMissing) {
    // The test was ordered — the row carried a unit or a reference range — but the
    // result cell was empty. Say that explicitly rather than emitting an Observation
    // that looks like it simply has no value.
    observation.dataAbsentReason = {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/data-absent-reason",
          code: "unknown",
          display: "Unknown",
        },
      ],
    };
  } else if (raw.rawValue.trim() !== "") {
    // Qualitative results — "POSITIVE", "Non Reactive", "G1", a blood group — are real
    // clinical content. Without this they would vanish from the Bundle entirely,
    // leaving an Observation that reads as "test performed, no result recorded".
    observation.valueString = raw.rawValue.trim();
  }

  const range = buildReferenceRange(raw.range, unit);
  if (range) {
    observation.referenceRange = [range];
  }

  const interpretation = resolveInterpretation(raw, unit);
  if (interpretation) {
    observation.interpretation = [interpretation];
  }

  return { observation, raw };
}

function buildCode(name: string, loinc: ReturnType<typeof lookupLoinc>): fhir4.CodeableConcept {
  const code: fhir4.CodeableConcept = { text: name };
  if (loinc) {
    code.coding = [{ system: "http://loinc.org", code: loinc.code, display: loinc.display }];
  }
  return code;
}

function buildQuantity(
  value: number,
  unit: ReturnType<typeof resolveUnit>,
  comparator: RawObservation["comparator"],
): fhir4.Quantity {
  const quantity: fhir4.Quantity = { value };
  if (comparator) quantity.comparator = comparator;
  if (unit) {
    quantity.unit = unit.printed;
    // system and code travel together or not at all: asserting the UCUM system next
    // to a unit we couldn't map to a UCUM code would claim a correspondence we don't
    // actually have.
    if (unit.ucum) {
      quantity.system = "http://unitsofmeasure.org";
      quantity.code = unit.ucum;
    }
  }
  return quantity;
}

function buildReferenceRange(
  range: ParsedRange | undefined,
  valueUnit: ReturnType<typeof resolveUnit>,
): fhir4.ObservationReferenceRange | undefined {
  if (!isEmittableRange(range)) return undefined;

  // referenceRange.low/high are SimpleQuantity-profiled in R4 — comparator is
  // prohibited there, unlike on valueQuantity.
  const rangeUnit = resolveUnit(range.unit) ?? valueUnit;
  const bound = (n: number | undefined): fhir4.Quantity | undefined => {
    if (n === undefined) return undefined;
    const q: fhir4.Quantity = { value: n };
    if (rangeUnit) {
      q.unit = rangeUnit.printed;
      if (rangeUnit.ucum) {
        q.system = "http://unitsofmeasure.org";
        q.code = rangeUnit.ucum;
      }
    }
    return q;
  };

  const result: fhir4.ObservationReferenceRange = {};
  const low = bound(range.low);
  const high = bound(range.high);
  if (low) result.low = low;
  if (high) result.high = high;
  if (range.text) result.text = range.text;

  return result.low || result.high || result.text ? result : undefined;
}

/**
 * The lab's own printed flag wins over anything we derive: the lab knows the patient's
 * age, sex and clinical context, and we only have a printed range. A derived
 * interpretation is used only when the lab didn't state one.
 */
function resolveInterpretation(
  raw: RawObservation,
  unit: ReturnType<typeof resolveUnit>,
): fhir4.CodeableConcept | undefined {
  if (raw.flag) return interpretationConcept(raw.flag);

  // A comparator already expresses that the true value lies beyond a bound; deriving
  // H/L/N on top of it would restate an uncertainty FHIR has already captured.
  if (raw.value === undefined || raw.comparator !== undefined || !raw.range) return undefined;

  const derived = deriveInterpretation(raw.value, raw.range, unit);
  return derived === undefined ? undefined : interpretationConcept(derived);
}

function interpretationConcept(code: string): fhir4.CodeableConcept {
  return {
    coding: [
      {
        system: INTERPRETATION_SYSTEM,
        code,
        display: INTERPRETATION_DISPLAY[code] ?? code,
      },
    ],
  };
}

function deriveInterpretation(
  value: number,
  range: ParsedRange,
  valueUnit: ReturnType<typeof resolveUnit>,
): "L" | "H" | "N" | undefined {
  if (range.low === undefined && range.high === undefined) return undefined;

  const rangeUnit = resolveUnit(range.unit) ?? valueUnit;
  if (!unitsAreComparable(valueUnit, rangeUnit)) return undefined;

  if (range.low !== undefined && range.high !== undefined) {
    return value < range.low ? "L" : value > range.high ? "H" : "N";
  }
  if (range.high !== undefined) return value > range.high ? "H" : "N";
  return value < (range.low as number) ? "L" : "N";
}
