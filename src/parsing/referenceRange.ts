import { cleanCell, stripDigitGroupSeparators } from "./text.js";

export interface ParsedRange {
  low?: number;
  high?: number;
  /**
   * Preserved verbatim when the range carries meaning we can't express as low/high —
   * sex-split ("Male: 13-17 Female: 12-15"), banded lipid targets, or free text. FHIR
   * allows referenceRange.text alongside or instead of the bounds.
   */
  text?: string;
  /** Some labs print the unit inside the range cell rather than its own column. */
  unit?: string;
}

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const DASH = String.raw`[-–—]`;

const BOUNDED = new RegExp(`^(${NUMBER})\\s*(?:${DASH}|to)\\s*(${NUMBER})$`, "i");
const UPPER_BOUND = new RegExp(`^(?:<|≤|<=|up\\s*to|upto)\\s*(${NUMBER})$`, "i");
const LOWER_BOUND = new RegExp(`^(?:>|≥|>=)\\s*(${NUMBER})$`);

// Trailing unit inside the range cell, e.g. "0.4 - 4.0 µIU/mL".
const TRAILING_UNIT = new RegExp(`^(.*?${NUMBER})\\s+([^\\s\\d][^\\s]*(?:/[^\\s]+)*)$`);

const EMPTY_MARKERS = new Set(["", "-", "--", "---", "na", "n/a", "nil", "none", "not established"]);

export function parseReferenceRange(raw: string): ParsedRange | undefined {
  const cleaned = cleanCell(raw);
  if (EMPTY_MARKERS.has(cleaned.toLowerCase())) return undefined;

  let working = stripDigitGroupSeparators(cleaned);
  let unit: string | undefined;

  const withUnit = TRAILING_UNIT.exec(working);
  if (withUnit?.[1] && withUnit[2]) {
    working = withUnit[1].trim();
    unit = withUnit[2];
  }

  const bounded = BOUNDED.exec(working);
  if (bounded?.[1] && bounded[2]) {
    const low = Number(bounded[1]);
    const high = Number(bounded[2]);
    if (Number.isFinite(low) && Number.isFinite(high)) {
      return withUnitIfPresent({ low, high }, unit);
    }
  }

  const upper = UPPER_BOUND.exec(working);
  if (upper?.[1]) {
    const high = Number(upper[1]);
    if (Number.isFinite(high)) return withUnitIfPresent({ high }, unit);
  }

  const lower = LOWER_BOUND.exec(working);
  if (lower?.[1]) {
    const low = Number(lower[1]);
    if (Number.isFinite(low)) return withUnitIfPresent({ low }, unit);
  }

  // Anything still unparsed is meaningful to a clinician but not to us. Keep the text
  // so it survives into the Bundle, and let the validation layer flag it for review
  // rather than silently dropping a stated reference range.
  return { text: cleaned };
}

function withUnitIfPresent(range: ParsedRange, unit: string | undefined): ParsedRange {
  return unit === undefined ? range : { ...range, unit };
}

/** obs-3: a referenceRange element must carry at least a low, a high, or text. */
export function isEmittableRange(range: ParsedRange | undefined): range is ParsedRange {
  if (!range) return false;
  return range.low !== undefined || range.high !== undefined || range.text !== undefined;
}
