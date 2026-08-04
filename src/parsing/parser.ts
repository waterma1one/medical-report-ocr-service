import { parseReferenceRange, type ParsedRange } from "./referenceRange.js";
import { cleanCell, normalizeLookupKey, stripDigitGroupSeparators } from "./text.js";
import { resolveUnit } from "./units.js";

export interface RawObservation {
  /** Test name as printed, including any method annotation. */
  name: string;
  /** The value cell exactly as printed, kept so validation can explain a rejection. */
  rawValue: string;
  /** Present only when the value parsed cleanly as a number. */
  value?: number;
  /** Comparator the lab printed alongside the value, e.g. the "<" in "<0.01". */
  comparator?: "<" | "<=" | ">" | ">=";
  /**
   * Abnormality flag the lab itself printed ("11.2*", "6.8 H"). The lab's own
   * assertion is more authoritative than anything derived from a reference range,
   * so it is captured rather than discarded.
   */
  flag?: "H" | "L" | "N" | "HH" | "LL" | "A";
  unit?: string;
  range?: ParsedRange;
  /** True when the row names a test but the result cell was empty. */
  valueMissing?: boolean;
  /** 1-based page number. Datalab's markers are 0-indexed; we add one for humans. */
  page?: number;
}

export interface ParseStats {
  tablesSeen: number;
  tablesAccepted: number;
  rowsSeen: number;
  observations: number;
  /** Rows rejected, keyed by reason, so a systematically empty parse is visible. */
  droppedByReason: Record<string, number>;
}

export interface ParseResult {
  observations: RawObservation[];
  stats: ParseStats;
}

const PAGE_MARKER = /^\{(\d+)\}-{4,}\s*$/;
const SEPARATOR_ROW = /^\|[\s:\-|]+\|$/;
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;
const COMPARATOR_VALUE = /^(<=|>=|<|>|≤|≥)\s*(-?\d+(?:\.\d+)?)$/;
const RANGE_LIKE = /^(?:<|>|≤|≥|up\s*to|upto)|(?:\d\s*(?:[-–—]|to)\s*\d)/i;
const CONTAINS_LETTER = /\p{L}/u;
const ONLY_DIGITS_AND_PUNCTUATION = /^[\d\W_]+$/u;
const VALUE_FLAG = /\s*(\*|↑|↓|HH|LL|H|L|N)\s*$/;

const MAX_NAME_LENGTH = 80;

const HEADER_PATTERNS = {
  name: /test|investigation|parameter|description|analyte|examination|particular/i,
  value: /result|value|observed|obs\b|reading|finding/i,
  unit: /unit|uom|u\/m/i,
  range: /reference|range|normal|interval|bio\.?\s*ref|ref\.?\s*value/i,
} as const;

// Demographic and administrative rows sit in tables that look structurally identical
// to result tables. The table-level gate removes most of them; this catches stragglers
// that share a table with real results.
const NON_OBSERVATION_NAMES = [
  "name",
  "labno",
  "labno.",
  "patientid",
  "patientname",
  "age",
  "gender",
  "sex",
  "refby",
  "referredby",
  "collected",
  "collectedat",
  "collectedon",
  "received",
  "reported",
  "reportedon",
  "reportstatus",
  "a/cstatus",
  "accountstatus",
  "processedat",
  "barcode",
  "barcodeno",
  "sampletype",
  "specimen",
  "clientcode",
  "registeredon",
  "approvedby",
  "instrument",
  "panel",
  "department",
];

interface TableColumns {
  name: number;
  value: number;
  unit?: number;
  range?: number;
}

interface MarkdownTable {
  rows: string[][];
  /** Index of the header row within `rows`, or -1 when the table has no header. */
  headerIndex: number;
  page: number;
}

export function parseObservations(markdown: string): RawObservation[] {
  return parseReport(markdown).observations;
}

export function parseReport(markdown: string): ParseResult {
  const observations: RawObservation[] = [];
  const stats: ParseStats = {
    tablesSeen: 0,
    tablesAccepted: 0,
    rowsSeen: 0,
    observations: 0,
    droppedByReason: {},
  };

  const drop = (reason: string) => {
    stats.droppedByReason[reason] = (stats.droppedByReason[reason] ?? 0) + 1;
  };

  for (const table of extractTables(markdown)) {
    stats.tablesSeen++;
    const dataRows = table.rows.filter((_, index) => index !== table.headerIndex);

    const columns = classifyColumns(table.rows, table.headerIndex);
    if (!columns) {
      drop("table_not_observations");
      continue;
    }
    stats.tablesAccepted++;

    for (const row of dataRows) {
      stats.rowsSeen++;
      const outcome = rowToObservation(row, columns, table.page);
      if ("reason" in outcome) {
        drop(outcome.reason);
        continue;
      }
      observations.push(outcome.observation);
    }
  }

  stats.observations = observations.length;
  return { observations, stats };
}

function extractTables(markdown: string): MarkdownTable[] {
  const tables: MarkdownTable[] = [];
  let page = 1;
  let rows: string[][] = [];
  let headerIndex = -1;
  let justCrossedPageBreak = false;

  const flush = (crossingPage: boolean) => {
    if (rows.length === 0) {
      justCrossedPageBreak = crossingPage;
      return;
    }

    // A table continued after a page break arrives with no separator row of its own.
    // Append it to the previous table rather than discarding it — otherwise the tail
    // of a panel split across pages is silently lost.
    const previous = tables[tables.length - 1];
    if (
      justCrossedPageBreak &&
      headerIndex === -1 &&
      previous !== undefined &&
      previous.headerIndex !== -1 &&
      columnCountOf(previous.rows) === columnCountOf(rows)
    ) {
      previous.rows.push(...rows);
    } else if (rows.length >= 1) {
      tables.push({ rows, headerIndex, page });
    }

    rows = [];
    headerIndex = -1;
    justCrossedPageBreak = crossingPage;
  };

  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();

    const marker = PAGE_MARKER.exec(trimmed);
    if (marker?.[1] !== undefined) {
      flush(true);
      page = Number(marker[1]) + 1;
      continue;
    }

    if (trimmed.startsWith("|")) {
      if (SEPARATOR_ROW.test(trimmed)) {
        // The row immediately above a separator is the header.
        if (rows.length > 0) headerIndex = rows.length - 1;
        continue;
      }
      rows.push(splitRow(trimmed));
      continue;
    }

    if (trimmed === "") continue;
    flush(false);
  }

  flush(false);
  return tables;
}

function columnCountOf(rows: string[][]): number {
  return Math.max(...rows.map((row) => row.length));
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cleanCell(cell));
}

function cellAt(row: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return row[index] ?? "";
}

interface ScalarValue {
  value: number;
  comparator?: "<" | "<=" | ">" | ">=";
  flag?: RawObservation["flag"];
  hadDecoration: boolean;
}

const COMPARATOR_TO_FHIR: Record<string, "<" | "<=" | ">" | ">="> = {
  "<": "<",
  "<=": "<=",
  "≤": "<=",
  ">": ">",
  ">=": ">=",
  "≥": ">=",
};

const FLAG_TO_CODE: Record<string, RawObservation["flag"]> = {
  H: "H",
  L: "L",
  N: "N",
  HH: "HH",
  LL: "LL",
  "*": "A",
  "↑": "H",
  "↓": "L",
};

/**
 * Parses a value cell into a scalar result. Handles the three forms labs actually
 * print: a plain number, a number carrying the lab's own abnormality flag
 * ("11.2*", "6.8 H"), and a comparator-bounded value ("<0.01") which is a legitimate
 * convention for a result below an assay's detection floor.
 */
function parseScalarValue(cell: string): ScalarValue | undefined {
  let working = stripDigitGroupSeparators(cell.trim());
  if (working === "") return undefined;

  let flag: RawObservation["flag"];
  let hadDecoration = false;

  const flagMatch = VALUE_FLAG.exec(working);
  // Only strip a trailing letter when something numeric precedes it, so a purely
  // qualitative "N" or "H" isn't mistaken for a flag on an empty value.
  if (flagMatch?.[1] && /\d/.test(working.slice(0, flagMatch.index))) {
    flag = FLAG_TO_CODE[flagMatch[1].toUpperCase()] ?? FLAG_TO_CODE[flagMatch[1]];
    working = working.slice(0, flagMatch.index).trim();
    hadDecoration = true;
  }

  if (PLAIN_NUMBER.test(working)) {
    const value = Number(working);
    if (!Number.isFinite(value)) return undefined;
    return { value, hadDecoration, ...(flag === undefined ? {} : { flag }) };
  }

  const comparatorMatch = COMPARATOR_VALUE.exec(working);
  if (comparatorMatch?.[1] && comparatorMatch[2]) {
    const comparator = COMPARATOR_TO_FHIR[comparatorMatch[1]];
    const value = Number(comparatorMatch[2]);
    if (comparator === undefined || !Number.isFinite(value)) return undefined;
    return {
      value,
      comparator,
      hadDecoration,
      ...(flag === undefined ? {} : { flag }),
    };
  }

  return undefined;
}

function isPlainNumericCell(cell: string): boolean {
  return PLAIN_NUMBER.test(stripDigitGroupSeparators(cell.trim()));
}

/**
 * A column of consecutive small integers starting at 1 is a row-index column, not a
 * result column. Without this, a serial-number column wins the "most numeric cells"
 * contest against the real values (it is numeric in 100% of rows, whereas a result
 * column always has some qualitative rows) and the report ships row numbers as
 * clinical values.
 */
function looksLikeRowIndex(rows: string[][], index: number): boolean {
  const values: number[] = [];
  for (const row of rows) {
    const cell = cellAt(row, index).trim();
    if (cell === "") continue;
    if (!/^\d{1,3}$/.test(cell)) return false;
    values.push(Number(cell));
  }
  if (values.length < 2) return false;
  return values.every((value, position) => value === (values[0] ?? 0) + position);
}

/**
 * Decides whether a table holds observations at all, and which column is which.
 *
 * The gate: a table qualifies when either two of its rows carry a plain numeric value
 * in the same column, or one row carries a scalar value and the table has a column of
 * recognised units.
 *
 * A lab result is a scalar (`15.00`, `<0.01`); a reference guide holds thresholds and
 * bands in every column (`<70`, `4.0-5.6`, `≥6.5`). Header matching alone is not
 * enough — real reports contain risk-category tables carrying the exact headers
 * "Test Name | Results | Units | Ref. Interval" whose every cell is a threshold. The
 * unit clause is what lets a single-analyte report (a standalone TSH or HbA1c) and an
 * all-comparator panel (a cardiac panel where every value is "<0.01") through, since
 * a reference guide has no unit column to offer.
 */
function classifyColumns(rows: string[][], headerIndex: number): TableColumns | null {
  const dataRows = rows.filter((_, index) => index !== headerIndex);
  if (dataRows.length === 0) return null;

  const columnCount = columnCountOf(rows);
  if (columnCount < 2) return null;

  const unitColumn = findUnitColumn(dataRows, columnCount, new Set());
  const valueColumn = findValueColumn(dataRows, columnCount, unitColumn !== undefined);
  if (valueColumn === null) return null;

  const header = headerIndex === -1 ? undefined : rows[headerIndex];
  return combineClassification(dataRows, columnCount, valueColumn, header);
}

function findValueColumn(
  rows: string[][],
  columnCount: number,
  hasUnitColumn: boolean,
): number | null {
  let bestPlain: { index: number; count: number } | null = null;
  let bestScalar: { index: number; count: number } | null = null;

  for (let index = 0; index < columnCount; index++) {
    if (looksLikeRowIndex(rows, index)) continue;

    const plain = rows.filter((row) => isPlainNumericCell(cellAt(row, index))).length;
    if (plain >= 2 && (bestPlain === null || plain > bestPlain.count)) {
      bestPlain = { index, count: plain };
    }

    const scalar = rows.filter((row) => parseScalarValue(cellAt(row, index)) !== undefined).length;
    if (scalar >= 1 && (bestScalar === null || scalar > bestScalar.count)) {
      bestScalar = { index, count: scalar };
    }
  }

  if (bestPlain !== null) return bestPlain.index;
  if (hasUnitColumn && bestScalar !== null) return bestScalar.index;
  return null;
}

function findUnitColumn(
  rows: string[][],
  columnCount: number,
  taken: ReadonlySet<number>,
): number | undefined {
  let best: { index: number; count: number } | undefined;

  for (let index = 0; index < columnCount; index++) {
    if (taken.has(index)) continue;
    const count = rows.filter((row) => resolveUnit(cellAt(row, index))?.ucum !== undefined).length;
    if (count >= 1 && (best === undefined || count > best.count)) {
      best = { index, count };
    }
  }

  return best?.index;
}

/**
 * Resolves the remaining columns. Header matches are preferred where they exist, but
 * any slot the headers don't resolve falls through to the positional heuristics — a
 * header row that says "UOM" instead of "Units" must not cost the table its unit
 * column entirely.
 */
function combineClassification(
  rows: string[][],
  columnCount: number,
  valueColumn: number,
  header: string[] | undefined,
): TableColumns | null {
  const findHeader = (pattern: RegExp): number | undefined => {
    if (!header) return undefined;
    for (let index = 0; index < columnCount; index++) {
      if (pattern.test(cellAt(header, index))) return index;
    }
    return undefined;
  };

  const taken = new Set<number>([valueColumn]);

  let nameColumn = findHeader(HEADER_PATTERNS.name);
  if (nameColumn === undefined || nameColumn === valueColumn) {
    nameColumn = undefined;
    for (let index = 0; index < columnCount; index++) {
      if (index === valueColumn) continue;
      if (looksLikeRowIndex(rows, index)) continue;
      const textRows = rows.filter((row) => CONTAINS_LETTER.test(cellAt(row, index))).length;
      if (textRows >= 1) {
        nameColumn = index;
        break;
      }
    }
  }
  if (nameColumn === undefined) return null;
  taken.add(nameColumn);

  let rangeColumn = findHeader(HEADER_PATTERNS.range);
  if (rangeColumn === undefined || taken.has(rangeColumn)) {
    rangeColumn = pickColumn(rows, columnCount, taken, (cell) => RANGE_LIKE.test(cell));
  }
  if (rangeColumn !== undefined) taken.add(rangeColumn);

  let unitColumn = findHeader(HEADER_PATTERNS.unit);
  if (unitColumn === undefined || taken.has(unitColumn)) {
    unitColumn = findUnitColumn(rows, columnCount, taken) ?? pickColumn(rows, columnCount, taken, isUnitShaped);
  }

  return {
    name: nameColumn,
    value: valueColumn,
    ...(unitColumn === undefined ? {} : { unit: unitColumn }),
    ...(rangeColumn === undefined ? {} : { range: rangeColumn }),
  };
}

function isUnitShaped(cell: string): boolean {
  if (cell === "" || cell.length > 20) return false;
  if (PLAIN_NUMBER.test(cell)) return false;
  return /^[A-Za-z%µμ][A-Za-z0-9%µμ/^*.[\]{}_-]*$/.test(cell);
}

function pickColumn(
  rows: string[][],
  columnCount: number,
  taken: ReadonlySet<number>,
  predicate: (cell: string) => boolean,
): number | undefined {
  let best: { index: number; count: number } | undefined;

  for (let index = 0; index < columnCount; index++) {
    if (taken.has(index)) continue;
    const count = rows.filter((row) => predicate(cellAt(row, index))).length;
    if (count >= 1 && (best === undefined || count > best.count)) {
      best = { index, count };
    }
  }

  return best?.index;
}

type RowOutcome = { observation: RawObservation } | { reason: string };

function rowToObservation(row: string[], columns: TableColumns, page: number): RowOutcome {
  const rawName = cellAt(row, columns.name);
  const rawValue = cellAt(row, columns.value);
  const unit = cellAt(row, columns.unit) || undefined;
  const range = parseReferenceRange(cellAt(row, columns.range));

  const name = normalizeTestName(rawName);
  if (name === null) return { reason: "implausible_name" };

  if (rawValue === "") {
    // A row with a unit or a reference range names a test that was genuinely ordered;
    // its result just didn't survive OCR. That is different from a panel heading, and
    // dropping it silently loses the fact that the test exists at all.
    if (unit !== undefined || range !== undefined) {
      return {
        observation: {
          name,
          rawValue: "",
          valueMissing: true,
          ...(unit === undefined ? {} : { unit }),
          ...(range === undefined ? {} : { range }),
          page,
        },
      };
    }
    return { reason: "panel_heading_or_empty_row" };
  }

  const scalar = parseScalarValue(rawValue);

  return {
    observation: {
      name,
      rawValue,
      ...(scalar === undefined
        ? {}
        : {
            value: scalar.value,
            ...(scalar.comparator === undefined ? {} : { comparator: scalar.comparator }),
            ...(scalar.flag === undefined ? {} : { flag: scalar.flag }),
          }),
      ...(unit === undefined ? {} : { unit }),
      ...(range === undefined ? {} : { range }),
      page,
    },
  };
}

/**
 * Returns the name to use, or null when the cell can't be a test name at all.
 * An over-long name is truncated rather than dropped — cleanCell deliberately joins a
 * test name to its method annotation, so long names are the norm this parser creates
 * for itself, and discarding the row loses a real result.
 */
function normalizeTestName(rawName: string): string | null {
  const name = rawName.trim();
  if (name.length < 2) return null;
  if (!CONTAINS_LETTER.test(name)) return null;
  // Reject a cell that is entirely digits and punctuation (dates, IDs, barcodes) —
  // anchored to the whole cell so "25-OH Vitamin D" and "T3, Total" survive.
  if (ONLY_DIGITS_AND_PUNCTUATION.test(name)) return null;

  const key = normalizeLookupKey(name).replace(/:$/, "");
  if (NON_OBSERVATION_NAMES.includes(key)) return null;

  return name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…` : name;
}
