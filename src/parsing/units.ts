import { normalizeLookupKey } from "./text.js";

// valueQuantity.system is http://unitsofmeasure.org, so valueQuantity.code has to be a
// UCUM expression — which is rarely the string a lab prints. `unit` keeps the printed
// form (FHIR's intent for that field); `code` carries the UCUM equivalent.
//
// Keys are matched through normalizeLookupKey: lowercased, whitespace removed, micro
// sign folded to ASCII "u". So one entry covers µIU/mL, uIU/mL and "µ IU / mL".
const UCUM_BY_PRINTED_UNIT = new Map<string, string>(
  Object.entries({
    // Mass / volume
    "g/dl": "g/dL",
    "gm/dl": "g/dL",
    "gms/dl": "g/dL",
    "gm%": "g/dL",
    "g%": "g/dL",
    "mg/dl": "mg/dL",
    "mgs/dl": "mg/dL",
    "mg%": "mg/dL",
    "mg/l": "mg/L",
    "ug/dl": "ug/dL",
    "ng/ml": "ng/mL",
    "ng/dl": "ng/dL",
    "pg/ml": "pg/mL",

    // Counts. 1 mm3 is exactly 1 uL, which is what makes these safely mappable.
    "million/mm3": "10*6/uL",
    "million/cumm": "10*6/uL",
    "mill/cumm": "10*6/uL",
    "mil/cumm": "10*6/uL",
    "mill/mm3": "10*6/uL",
    "10^6/ul": "10*6/uL",
    "thou/mm3": "10*3/uL",
    "thou/cumm": "10*3/uL",
    "thousand/mm3": "10*3/uL",
    "10^3/ul": "10*3/uL",
    "k/ul": "10*3/uL",
    "10^9/l": "10*9/L",
    "10^12/l": "10*12/L",
    "lakhs/mm3": "10*5/uL",
    "lakhs/cumm": "10*5/uL",
    "/ul": "/uL",
    "/cumm": "/uL",
    "/mm3": "/uL",
    "cells/ul": "/uL",

    // Enzyme activity and international units
    "u/l": "U/L",
    "u/lt": "U/L",
    "iu/l": "[IU]/L",
    "uiu/ml": "u[IU]/mL",
    // mIU/L is numerically equal to µIU/mL but is a different expression. Emitting
    // u[IU]/mL for it would assert the printed unit was micro-IU per mL, which is false.
    "miu/l": "m[IU]/L",
    "iu/ml": "[IU]/mL",

    // Substance concentration
    "mmol/l": "mmol/L",
    "umol/l": "umol/L",
    "nmol/l": "nmol/L",
    "mmol/mol": "mmol/mol",
    "meq/l": "meq/L",

    // Renal
    "ml/min/1.73m2": "mL/min/{1.73_m2}",
    "ml/min/1.73sqm": "mL/min/{1.73_m2}",

    // Dimensionless and misc
    "%": "%",
    fl: "fL",
    pg: "pg",
    pgm: "pg",
    "mm/hr": "mm/h",
    "mm/1sthr": "mm/h",
    sec: "s",
    secs: "s",
  }),
);

export interface ResolvedUnit {
  /** The unit exactly as the report printed it. */
  printed: string;
  /** UCUM expression, when the printed unit maps to one. */
  ucum?: string;
}

export function resolveUnit(raw: string | undefined): ResolvedUnit | undefined {
  if (raw === undefined) return undefined;
  const printed = raw.trim();
  if (printed === "") return undefined;

  const ucum = UCUM_BY_PRINTED_UNIT.get(normalizeLookupKey(printed));
  return ucum === undefined ? { printed } : { printed, ucum };
}

/**
 * Two units are comparable when they normalise to the same UCUM code, or — when neither
 * is recognised — when their printed forms match. Used before deriving an
 * interpretation from a reference range, so a value in mg/dL is never compared against
 * a range in mmol/L.
 */
export function unitsAreComparable(
  a: ResolvedUnit | undefined,
  b: ResolvedUnit | undefined,
): boolean {
  // Both unitless is a legitimate match (a ratio compared against a unitless range).
  if (a === undefined && b === undefined) return true;
  // One side carrying a unit and the other not is not something we can verify, so
  // fail closed rather than compare a bare number against a mmol/L range.
  if (a === undefined || b === undefined) return false;
  if (a.ucum !== undefined && b.ucum !== undefined) return a.ucum === b.ucum;
  return normalizeLookupKey(a.printed) === normalizeLookupKey(b.printed);
}
