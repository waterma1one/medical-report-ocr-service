import { normalizeLookupKey } from "../parsing/text.js";

export interface LoincCode {
  code: string;
  display: string;
}

interface LoincEntry extends LoincCode {
  /** Additional names the same test appears under on real reports. */
  aliases?: string[];
}

// Every code verified against the NLM Clinical Tables LOINC search API
// (clinicaltables.nlm.nih.gov/api/loinc_items/v3/search) before being added here —
// none of these are guessed. Aliases are drawn from the fixture panel (Dr Lal
// PathLabs) and common Indian-lab phrasing; a handful of correctly-aliased codes beats
// a long list of exact-match-only ones, since LOINC coding is optional and a miss must
// degrade silently to code.text rather than fail the request.
const ENTRIES: LoincEntry[] = [
  { code: "718-7", display: "Hemoglobin", aliases: ["haemoglobin", "hb", "hgb"] },
  {
    code: "4544-3",
    display: "Hematocrit",
    aliases: ["haematocrit", "hct", "packedcellvolume", "pcv"],
  },
  { code: "789-8", display: "Erythrocytes", aliases: ["rbc", "rbccount", "redbloodcellcount"] },
  {
    code: "6690-2",
    display: "Leukocytes",
    aliases: ["wbc", "wbccount", "whitebloodcellcount", "tlc", "totalleukocytecount"],
  },
  { code: "777-3", display: "Platelets", aliases: ["plt", "plateletcount"] },
  { code: "787-2", display: "MCV" },
  { code: "785-6", display: "MCH" },
  { code: "786-4", display: "MCHC" },
  { code: "788-0", display: "RDW", aliases: ["rdw-cv", "redcelldistributionwidth"] },
  { code: "770-8", display: "Neutrophils", aliases: ["segmentedneutrophils", "neutrophils%"] },
  { code: "736-9", display: "Lymphocytes" },
  { code: "713-8", display: "Eosinophils" },
  { code: "5905-5", display: "Monocytes" },
  { code: "706-2", display: "Basophils" },
  { code: "30341-2", display: "ESR", aliases: ["erythrocytesedimentationrate"] },
  { code: "2345-7", display: "Glucose", aliases: ["glucoserandom", "randomblood glucose"] },
  { code: "1558-6", display: "Fasting glucose", aliases: ["glucosefasting", "fbs"] },
  { code: "4548-4", display: "Hemoglobin A1c", aliases: ["hba1c", "glycosylatedhemoglobin"] },
  { code: "2160-0", display: "Creatinine", aliases: ["s.creatinine", "serumcreatinine"] },
  {
    code: "3094-0",
    display: "Urea nitrogen",
    aliases: ["urea", "bun", "bloodureanitrogen", "ureanitrogenblood"],
  },
  { code: "3084-1", display: "Uric acid" },
  { code: "2951-2", display: "Sodium", aliases: ["na"] },
  { code: "2823-3", display: "Potassium", aliases: ["k"] },
  { code: "2075-0", display: "Chloride", aliases: ["cl"] },
  { code: "2093-3", display: "Cholesterol", aliases: ["cholesteroltotal", "totalcholesterol"] },
  { code: "2571-8", display: "Triglycerides" },
  { code: "2085-9", display: "HDL Cholesterol", aliases: ["hdl", "hdlcholesterol"] },
  {
    code: "13457-7",
    display: "LDL Cholesterol",
    aliases: ["ldl", "ldlcholesterolcalculated"],
  },
  { code: "1742-6", display: "ALT", aliases: ["sgpt", "alt(sgpt)", "alaninetransaminase"] },
  { code: "1920-8", display: "AST", aliases: ["sgot", "ast(sgot)", "aspartatetransaminase"] },
  { code: "6768-6", display: "Alkaline phosphatase", aliases: ["alp", "alkphos"] },
  { code: "1975-2", display: "Bilirubin, total", aliases: ["bilirubintotal", "totalbilirubin"] },
  {
    code: "1968-7",
    display: "Bilirubin, direct",
    aliases: ["bilirubindirect", "directbilirubin"],
  },
  { code: "1751-7", display: "Albumin" },
  { code: "2885-2", display: "Protein, total", aliases: ["totalprotein"] },
  { code: "3016-3", display: "TSH", aliases: ["thyrotropin"] },
  { code: "3053-6", display: "Triiodothyronine (T3)", aliases: ["t3", "t3total"] },
  { code: "3024-7", display: "Thyroxine (T4), free", aliases: ["t4free", "freet4"] },
  { code: "3026-2", display: "Thyroxine (T4)", aliases: ["t4", "t4total"] },
  { code: "1989-3", display: "Vitamin D, 25-OH", aliases: ["vitamind", "25ohvitamind"] },
  { code: "2132-9", display: "Vitamin B12", aliases: ["b12", "vitaminb12", "cobalamin"] },
  { code: "2276-4", display: "Ferritin" },
  { code: "1988-5", display: "C reactive protein", aliases: ["crp"] },
  { code: "17861-6", display: "Calcium, total", aliases: ["calcium", "calciumtotal"] },
  { code: "2777-1", display: "Phosphate", aliases: ["phosphorus"] },
  { code: "2601-3", display: "Magnesium", aliases: ["mg"] },
];

// normalizeLookupKey preserves punctuation like "/" because units.ts needs it
// (mg/dL). Test names carry no such punctuation that matters — "Cholesterol, Total"
// and "Total Cholesterol" name the same test — so strip it here rather than loosening
// the shared helper.
function loincKey(name: string): string {
  return normalizeLookupKey(name).replace(/[,.:;]/g, "");
}

const LOOKUP = new Map<string, LoincCode>();
for (const entry of ENTRIES) {
  const code: LoincCode = { code: entry.code, display: entry.display };
  LOOKUP.set(loincKey(entry.display), code);
  for (const alias of entry.aliases ?? []) {
    LOOKUP.set(loincKey(alias), code);
  }
}

// Strips the parts of a test name that vary between labs but don't change what's
// being measured: method annotations ("(Modified Jaffe,Kinetic)"), unit suffixes
// ("Sodium (Indirect ISE)" -> "Sodium"), and a leading specimen prefix ("S. Creatinine").
function stripAnnotations(name: string): string {
  return name
    .replace(/\([^)]*\)/g, "")
    .replace(/^(?:s\.?|serum)\s+/i, "")
    .trim();
}

/**
 * Vocabulary of words that describe *how* a test was run rather than *what* was
 * measured. Many labs append the method to the analyte name without parentheses
 * ("SODIUM ISE direct", "MCV Calculated"), which no amount of bracket-stripping will
 * remove.
 *
 * Some entries ("hemoglobin", "rbc", "count") are also analyte names in their own
 * right. That is safe here because this list is only ever consulted against the
 * portion being *dropped from the end* — a prefix is never discarded on its own.
 */
const METHOD_WORDS = new Set([
  "modified", "jendrassik", "calculated", "calc", "kinetic", "ifcc", "uv", "without",
  "p5p", "pyridoxal", "phosphate", "biuret", "assay", "bcg", "bcp", "pnpp",
  "colorimetric", "colourimetric", "lkg", "uk", "ec", "ise", "direct", "indirect",
  "sls", "hemoglobin", "haemoglobin", "hydrodynamically", "focused", "dc", "detection",
  "rbc", "pulse", "height", "flowcytometry", "flow", "cytometry", "microscopy",
  "photo", "optical", "clot", "eclia", "clia", "elisa", "cmia", "photometry",
  "impedance", "electrical", "automated", "enzymatic", "immunoinhibition", "arsenazo",
  "iii", "molybdate", "urease", "uricase", "jaffe", "oxidation", "biotret", "hplc",
  "ngsp", "certified", "level", "levels", "method", "principle", "sandwich",
  "estimation", "count", "cho-pod", "gpo-pod", "hexokinase", "turbidimetry",
  "nephelometry", "spectrophotometry", "potentiometry", "chemiluminescence",
]);

function isMethodOnly(words: string[]): boolean {
  if (words.length === 0) return false;
  return words.every((word) => {
    const cleaned = word.replace(/[(),.:;]/g, "").toLowerCase();
    return cleaned === "" || METHOD_WORDS.has(cleaned);
  });
}

export function lookupLoinc(testName: string): LoincCode | undefined {
  const direct = LOOKUP.get(loincKey(testName));
  if (direct) return direct;

  const stripped = stripAnnotations(testName);
  if (stripped !== testName) {
    const viaAnnotations = LOOKUP.get(loincKey(stripped));
    if (viaAnnotations) return viaAnnotations;
  }

  // Longest-prefix match, accepted only when everything dropped is method vocabulary.
  // Without that guard "ALBUMIN : GLOBULIN RATIO Calculated" would happily shorten to
  // "ALBUMIN" and report the wrong analyte — a far worse outcome than no code at all.
  const words = stripped.split(/\s+/).filter(Boolean);
  for (let take = words.length - 1; take >= 1; take--) {
    const dropped = words.slice(take);
    if (!isMethodOnly(dropped)) continue;
    const candidate = LOOKUP.get(loincKey(words.slice(0, take).join(" ")));
    if (candidate) return candidate;
  }

  return undefined;
}
