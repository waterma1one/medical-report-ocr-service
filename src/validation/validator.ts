import type { MappedObservation } from "../fhir/mapper.js";
import { resolveUnit, unitsAreComparable } from "../parsing/units.js";

export interface ValidationIssue {
  code: string;
  message: string;
}

const CLEAN_NUMBER = /^(?:<=|>=|<|>|≤|≥)?\s*-?\d+(?:\.\d+)?$/;

/** Powers of ten an OCR decimal-point slip realistically produces. */
const DECIMAL_SHIFT_FACTORS = [0.1, 0.01, 10, 100] as const;
/** A rescale has to remove at least 90% of the distance to count as an explanation. */
const SHIFT_EXPLANATION_THRESHOLD = 0.1;
/** Separate, cruder signal for a gross magnitude error. */
const GROSS_FACTOR = 10;

/**
 * Sanity checks run before an Observation is returned. None of these reject the
 * Observation — a failure here means it ships in the Bundle with its name added to
 * the Bundle's needs-review extension and the specific issues attached as notes.
 */
export function validateObservation(mapped: MappedObservation): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { raw } = mapped;

  if (raw.valueMissing) {
    issues.push({
      code: "VALUE_MISSING",
      message: "The test was reported but no result value could be read",
    });
  } else {
    // "Value is a valid number (not a string like '11.2*')" — a value with a
    // trailing flag. Checked against the value as printed, not the number recovered from
    // it: the trailing flag is stripped to get a usable 11.2, but that flag was
    // clinically meaningful, so the row still deserves a human look.
    const trimmedValue = raw.rawValue.trim();
    if (trimmedValue !== "" && !CLEAN_NUMBER.test(trimmedValue)) {
      issues.push({
        code: "VALUE_NOT_A_CLEAN_NUMBER",
        message: `Value "${raw.rawValue}" is not a plain number`,
      });
    }
  }

  if (!raw.unit || raw.unit.trim() === "") {
    issues.push({ code: "MISSING_UNIT", message: "Unit is missing" });
  }

  if (
    raw.range?.low !== undefined &&
    raw.range.high !== undefined &&
    raw.range.low > raw.range.high
  ) {
    issues.push({
      code: "INCOHERENT_RANGE",
      message: `Reference range low (${raw.range.low}) is greater than high (${raw.range.high})`,
    });
  }

  if (raw.unit && raw.range?.unit) {
    const valueUnit = resolveUnit(raw.unit);
    const rangeUnit = resolveUnit(raw.range.unit);
    if (!unitsAreComparable(valueUnit, rangeUnit)) {
      issues.push({
        code: "UNIT_MISMATCH",
        message: `Value unit "${raw.unit}" does not match reference range unit "${raw.range.unit}"`,
      });
    }
  }

  const plausibility = checkPlausibility(raw.value, raw.range?.low, raw.range?.high);
  if (plausibility) issues.push(plausibility);

  return issues;
}

function distanceFromRange(
  value: number,
  low: number | undefined,
  high: number | undefined,
): number {
  if (low !== undefined && value < low) return low - value;
  if (high !== undefined && value > high) return value - high;
  return 0;
}

/**
 * OCR drops decimal points far more often than it produces garbage a human would
 * notice, and that failure mode is the most dangerous one here: it yields a
 * numerically valid, confidently-labelled Observation that is simply wrong.
 *
 * The obvious check — "more than 10x the reference high" — cannot actually catch it.
 * A 10x shift of a true value V trips `V * 10 > high * 10` only when `V > high`, so
 * any in-range result that gets shifted is mathematically invisible to it. A
 * haemoglobin of 11.2 read as 112 sails through.
 *
 * Instead, ask whether a power-of-ten rescale *explains* the value: if dividing by ten
 * moves it from wildly outside the range to essentially inside, a dropped decimal
 * point is the most likely story. This is a heuristic — a genuinely extreme result
 * exists in real medicine — which is why it flags for review rather than rejecting.
 */
function checkPlausibility(
  value: number | undefined,
  low: number | undefined,
  high: number | undefined,
): ValidationIssue | undefined {
  if (value === undefined) return undefined;
  if (low === undefined && high === undefined) return undefined;

  const distance = distanceFromRange(value, low, high);
  if (distance === 0) return undefined;

  // Only meaningful against a range bounded on both sides. With a one-sided range
  // ("> 40") almost any rescale lands "inside" it, which turns a genuinely low HDL
  // of 25 into a false decimal-error report.
  if (low !== undefined && high !== undefined) {
    for (const factor of DECIMAL_SHIFT_FACTORS) {
      const rescaled = value * factor;
      if (distanceFromRange(rescaled, low, high) <= distance * SHIFT_EXPLANATION_THRESHOLD) {
        return {
          code: "IMPLAUSIBLE_VALUE",
          message:
            `Value ${value} sits far outside the reference range, but ${rescaled} would fall within it ` +
            `— possible OCR decimal-point error`,
        };
      }
    }
  }

  if (high !== undefined && high > 0 && value > high * GROSS_FACTOR) {
    return {
      code: "IMPLAUSIBLE_VALUE",
      message: `Value ${value} is more than ${GROSS_FACTOR}x the reference high (${high})`,
    };
  }

  if (low !== undefined && low > 0 && value > 0 && value < low / GROSS_FACTOR) {
    return {
      code: "IMPLAUSIBLE_VALUE",
      message: `Value ${value} is less than 1/${GROSS_FACTOR} of the reference low (${low})`,
    };
  }

  return undefined;
}

export interface ReviewedObservation extends MappedObservation {
  issues: ValidationIssue[];
}

/**
 * Runs validation across the set, attaching each Observation's issues to it as FHIR
 * notes so the reason for a review flag reaches the client, and returning the names
 * for the Bundle's needs-review extension.
 */
export function reviewObservations(observations: MappedObservation[]): {
  reviewed: ReviewedObservation[];
  needsReview: string[];
} {
  const reviewed: ReviewedObservation[] = [];
  const names: string[] = [];
  const seen = new Set<string>();

  for (const mapped of observations) {
    const issues = validateObservation(mapped);
    if (issues.length > 0) {
      // Observation.note carries the specific reason each entry was flagged. Without
      // it the client sees only a name in the Bundle's needs-review extension and cannot tell a
      // discarded abnormality flag from a unit mismatch — different follow-ups.
      mapped.observation.note = issues.map((issue) => ({
        text: `${issue.code}: ${issue.message}`,
      }));

      const name = mapped.observation.code.text ?? mapped.raw.name;
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
    reviewed.push({ ...mapped, issues });
  }

  return { reviewed, needsReview: names };
}

/** Names of every Observation that failed at least one check, deduplicated, in order. */
export function collectNeedsReview(observations: MappedObservation[]): string[] {
  return reviewObservations(observations).needsReview;
}
