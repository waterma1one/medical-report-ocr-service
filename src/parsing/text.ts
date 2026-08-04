// Marker's markdown carries HTML fragments, LaTeX math and mixed Unicode straight
// through from the source PDF. Everything downstream (name matching, unit lookup,
// range parsing) assumes plain text, so normalise once here rather than defending
// against `<br>` and `$\geq$` in every regex.

const LATEX_OPERATORS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\\geq\b/g, "≥"],
  [/\\leq\b/g, "≤"],
  [/\\ge\b/g, "≥"],
  [/\\le\b/g, "≤"],
  [/\\lt\b/g, "<"],
  [/\\gt\b/g, ">"],
  [/\\pm\b/g, "±"],
  [/\\times\b/g, "x"],
];

export function cleanCell(raw: string): string {
  let out = raw;

  // Superscripts first, and without the surrounding space: the eGFR unit arrives as
  // `mL/min/1.73m <sup>2</sup>` and must become `mL/min/1.73m2`, not `mL/min/1.73m 2`.
  out = out.replace(/\s*<sup>\s*(.*?)\s*<\/sup>/gi, "$1");
  out = out.replace(/\s*<sub>\s*(.*?)\s*<\/sub>/gi, "$1");

  // <br> separates a test name from its method annotation; a space keeps them joined
  // as one readable label.
  out = out.replace(/<br\s*\/?>/gi, " ");

  // Images (signature blocks) contribute nothing but their alt text noise.
  out = out.replace(/<img\b[^>]*>/gi, " ");

  out = out.replace(/<[^>]+>/g, " ");

  for (const [pattern, replacement] of LATEX_OPERATORS) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(/\$/g, "");

  // Markdown escapes and emphasis.
  out = out.replace(/\\([|*_$])/g, "$1");
  out = out.replace(/\*\*/g, "").replace(/__/g, "");

  out = out.normalize("NFKC");

  // NFKC leaves both micro-sign variants distinct from ASCII; unify whitespace kinds too.
  out = out.replace(/[   ]/g, " ").replace(/[​-‍﻿]/g, "");

  return out.replace(/\s+/g, " ").trim();
}

// Lookup key for unit and test-name maps: case- and punctuation-insensitive, with the
// micro sign folded to ASCII so `µIU/mL` and `uIU/mL` collide on purpose.
export function normalizeLookupKey(value: string): string {
  return cleanCell(value)
    .toLowerCase()
    .replace(/[µμ]/g, "u")
    .replace(/×/g, "x")
    .replace(/\s+/g, "");
}

// Indian lab reports group digits as 1,50,000. Strip separators that sit between two
// digits so grouped counts parse, while leaving comma-separated prose alone.
export function stripDigitGroupSeparators(value: string): string {
  return value.replace(/(?<=\d),(?=\d)/g, "");
}
