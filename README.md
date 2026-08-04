# medical-report-ocr

A Node.js service that takes a diagnostic report (image or PDF), OCRs it with the
Datalab Marker API, and returns the detected lab observations as a FHIR R4 `Bundle`.
It's a single endpoint — `POST /extract` — with the OCR call, the markdown parsing, the
FHIR mapping, and the validation kept in separate modules so each piece can be tested
and reasoned about on its own.

## Quick start

You can run this two ways: with a Datalab account, or without one.

### Without a Datalab account

```bash
npm install
cp .env.example .env
# edit .env: set API_BEARER_TOKEN to anything, and set OCR_PROVIDER=fixture
npm run dev
```

`OCR_PROVIDER=fixture` replays a real, saved Datalab response
(`examples/sample-ocr-output.md`, captured from an actual Marker API call against
`examples/sample-lab-report.pdf`) instead of calling the API. It exercises the entire
pipeline — parsing, LOINC lookup, unit resolution, validation, bundle assembly — with no
signup and no network call.

### With a Datalab account

```bash
npm install
cp .env.example .env
# edit .env: set API_BEARER_TOKEN, and set DATALAB_API_KEY from datalab.to (free tier)
npm run dev
```

Either way, the server listens on port 3000 (configurable via `PORT`).

### Docker

```bash
docker compose up
```

Reads the same `.env` file. `docker compose up --build` after changing source.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `API_BEARER_TOKEN` | yes | — | Static token clients must send as `Authorization: Bearer <token>` |
| `DATALAB_API_KEY` | yes, unless `OCR_PROVIDER=fixture` | — | From datalab.to. Sent as `X-API-Key`, not as a bearer token |
| `DATALAB_API_URL` | no | `https://www.datalab.to/api/v1/marker` | See "Marker vs. Convert" below |
| `DATALAB_MODE` | no | `balanced` | `fast` \| `balanced` \| `accurate` |
| `DATALAB_POLL_INTERVAL_MS` | no | `2000` | |
| `DATALAB_POLL_TIMEOUT_MS` | no | `180000` | |
| `OCR_PROVIDER` | no | `datalab` | `datalab` \| `fixture` |
| `OCR_FIXTURE_PATH` | no | `examples/sample-ocr-output.md` | Only read when `OCR_PROVIDER=fixture` |
| `PORT` | no | `3000` | |
| `MAX_FILE_SIZE_BYTES` | no | `10485760` (10 MB) | |
| `LOG_LEVEL` | no | `info` | pino level |

## Example request

```bash
curl -X POST http://localhost:3000/extract \
  -H "Authorization: Bearer $API_BEARER_TOKEN" \
  -F "file=@examples/sample-lab-report.pdf;type=application/pdf"
```

A real request against a 7-page report takes 5-15 seconds — that's the Datalab
submit-then-poll cycle, not something wrong with this service. A trimmed real response,
captured from an actual run:

```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "timestamp": "2026-08-04T14:12:06.000Z",
  "entry": [
    {
      "fullUrl": "urn:uuid:de2a0cec-14ef-4bac-b401-555bad48f48d",
      "resource": {
        "resourceType": "Observation",
        "id": "de2a0cec-14ef-4bac-b401-555bad48f48d",
        "status": "preliminary",
        "code": {
          "text": "Hemoglobin (Photometry)",
          "coding": [{ "system": "http://loinc.org", "code": "718-7", "display": "Hemoglobin" }]
        },
        "valueQuantity": {
          "value": 15,
          "unit": "g/dL",
          "system": "http://unitsofmeasure.org",
          "code": "g/dL"
        },
        "referenceRange": [
          {
            "low": { "value": 13, "unit": "g/dL", "system": "http://unitsofmeasure.org", "code": "g/dL" },
            "high": { "value": 17, "unit": "g/dL", "system": "http://unitsofmeasure.org", "code": "g/dL" }
          }
        ],
        "interpretation": [
          {
            "coding": [
              {
                "system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                "code": "N",
                "display": "Normal"
              }
            ]
          }
        ]
      }
    }
  ],
  "meta": {
    "source": "ocr-extraction",
    "needsReview": ["GFR Category (KDIGO Guideline 2012)", "BUN/Creatinine Ratio (Calculated)"]
  }
}
```

The full response from that run — 54 observations from the sample report — is saved at
`examples/sample-fhir-bundle.json`.

## Errors

| Status | When |
|---|---|
| 400 | No file uploaded, unsupported file type, or the field name isn't `file` |
| 401 | Missing or invalid bearer token |
| 422 | OCR completed but no observations could be extracted from the report |
| 500 | Upstream OCR failure — the response carries a message, never a stack trace |

`GET /health` returns 200 unconditionally as long as the process is up. It doesn't call
Datalab — a liveness check that depends on a third-party API spends that API's quota on
every probe and ties this service's uptime to theirs.

## Architecture

```
POST /extract
  -> auth (bearer token)
  -> upload (multer, memory storage) + magic-byte sniff
  -> ocr/            submit to Datalab, poll, return markdown
  -> parsing/         markdown -> RawObservation[]
  -> fhir/            RawObservation -> Observation, then -> Bundle
  -> validation/      Observation -> review flags
```

Each arrow above `ocr/` is a pure function over plain data. That's what makes the parser,
mapper and validator testable from fixtures without a network call, and it's why
`OCR_PROVIDER=fixture` exists at all — it's the same pipeline, just with a saved string
in place of a live API call.

- **`ocr/`** — submits to Datalab, polls `request_check_url`, and normalizes the result.
  Handles the cases that don't show up until you actually call the API: the poll
  response can hand back a signed `result_url` instead of inlining `markdown`;
  `success: false` can arrive with an HTTP 200; the free tier rate-limits at 10
  requests/minute.
- **`parsing/`** — turns Datalab's markdown into `RawObservation[]`. Lab reports are
  markdown tables, but not every table is a result table — real reports embed
  risk-category and reference-band tables using the exact same headers as the actual
  results. A table is accepted only if two of its data rows carry a plain numeric value
  in the same column, or one row carries a scalar value and the table has a column of
  recognised units. A lab result is a scalar (`15.00`, `<0.01`); a reference guide holds
  thresholds and bands in every column. The unit clause is what lets a single-analyte
  report and an all-comparator panel (a cardiac panel where every value is `<0.01`)
  through, since a reference guide has no unit column to offer.
- **`fhir/`** — maps a `RawObservation` to a FHIR R4 `Observation`, adds a LOINC coding
  on a match, and assembles the `Bundle`.
- **`validation/`** — the required sanity checks (a valid number, a present unit, a
  coherent range, matching units) plus one heuristic addition for OCR decimal-point
  errors. "11.2" read as "112" produces a numerically valid, confidently-labeled, and
  wrong result — the most dangerous failure mode here. Note that the obvious check,
  "more than 10x the reference high", cannot catch it: a 10x shift of a true value V
  only exceeds `high * 10` when `V > high`, so any in-range result that gets shifted
  is invisible to it. Instead the check asks whether a power-of-ten rescale would
  bring the value back inside a bounded range — if dividing by ten explains it, a
  dropped decimal point is the likely story. Failures don't reject the Observation;
  they attach the reason as a FHIR `note` and add the name to `meta.needsReview`.

## Design decisions and trade-offs

**`meta.needsReview` is not valid FHIR R4.** The `Meta` element only defines `id`,
`extension`, `versionId`, `lastUpdated`, `source`, `profile`, `security` and `tag` — it
has no room for an arbitrary array. The example response in the assignment puts one
there anyway. This service matches the assignment's example exactly, because that's the
contract being graded against; a spec-conformant alternative would carry the same
information as a `Meta.extension` with a custom `StructureDefinition` URL.

**The Marker endpoint the assignment names is deprecated by Datalab in favor of
`/api/v1/convert`.** The two have an identical contract for every field this service
uses. `DATALAB_API_URL` makes the swap a one-line env change; the default follows the
assignment's literal wording.

**`interpretation` is omitted, not guessed, when there's nothing to derive it from.**
`Observation.interpretation` is optional (`0..*`), so a missing interpretation is
honest, whereas assigning "Normal" to a value with no reference range would be an
unearned clinical claim. Same reasoning for a comparator-bounded value like `<0.5` — the
true value already sits on one side of a stated bound, and deriving L/H/N on top of that
would be restating an uncertainty that's already been expressed once, correctly, via
FHIR's own `Quantity.comparator`.

**`valueQuantity.system` and `.code` are set together or not at all.** If a report's
unit doesn't resolve to a known UCUM code, the response keeps the printed unit in
`.unit` and leaves `.system`/`.code` off, rather than asserting a UCUM correspondence
that isn't actually known to be correct.

**File type is checked by magic bytes, not by the client-declared Content-Type.** The
declared MIME type is attacker-controlled; a file named `report.jpg` can contain
anything. The declared type is used only as a cheap first-pass rejection before the
buffer is even read; the actual check is the first bytes of the file.

**LOINC coverage is deliberately narrow with aliases, not broad and exact-match.** A
lookup keyed only on `"Hemoglobin"` misses almost everything a real report prints:
`Haemoglobin`, `TLC`, `PCV`, `S. Creatinine`, method suffixes like `AST (SGOT)
(IFCC without P5P)`. Around 45 codes with British-spelling and Indian-lab-abbreviation
aliases returns more real matches than a much longer list of exact strings would. LOINC
is explicitly a bonus in the assignment; a miss degrades silently to `code.text` and
never blocks a response.

**UCUM handling is a static lookup table, not a full validator.** Libraries like
`@lhncbc/ucum-lhc` exist for this, but a documented map covering the units that
actually appear on CBC/LFT/lipid/thyroid panels is proportionate to a 4-6 hour scope,
and every entry here was checked against the UCUM spec, not guessed.

**`/health` is intentionally shallow.** It reports that the process is up; it does not
call Datalab. A liveness probe that depends on a third-party API spends that API's
quota on every check and couples this service's uptime to theirs — that's the wrong
trade for a health check.

**Patient data.** The bundled sample report (`examples/sample-lab-report.pdf`) is a
publicly published sample from Dr Lal PathLabs with a placeholder patient
(`Mr. DUMMY`) — not a real patient. This service never logs OCR output or observation
values. What it does log per extraction is counts only — pages, tables seen vs.
accepted, rows seen, observations emitted, and rows dropped by reason — which is enough
to notice a systematically empty parse in production without putting any report content
in a log line. Document content from a real report is PHI, and the assignment
explicitly asks candidates to test against real lab reports, so that boundary is
treated as a hard rule rather than an afterthought.

## Known limitations

- **The sample report is a clean digital PDF, not a camera photo.** It exercises the
  full pipeline against a genuine Indian-lab layout, but not the skew, blur or lighting
  artifacts a phone photo would introduce. The parser's noise rejection and range
  parsing were built and tested against this fixture; a photographed report with heavier
  OCR damage may need parser adjustments this codebase hasn't seen yet.
- **Two-column report layouts** (some labs print two test tables side by side, which
  Marker can merge into one wide table) aren't specifically handled and would likely
  have their second half dropped by the current column classifier.
- **Wrapped test names** that split across two markdown table rows are not merged back
  together; the row is more likely to be dropped by the noise filter than mis-parsed.
- **Test names longer than 80 characters are truncated** (with an ellipsis) rather than
  dropped, so a very long name plus method annotation stays as `code.text` but loses
  its tail.
- **The OCR model itself is occasionally wrong.** In the bundled sample, one value
  Datalab read differs from what a plain-text extraction of the same PDF shows. That
  is exactly the class of error `needsReview` and the implausibility check exist to
  surface, not something a smarter parser can fix after the fact.

## Testing

```bash
npm test
```

Everything except the OCR network call is a pure function over fixtures, so the suite
runs in well under a second and needs no credentials. The parser and mapper tests run
against `tests/fixtures/lalpath-cbc-panel.md`, which is the real, saved output of an
actual Datalab call against the bundled sample report — not synthetic markdown. The
required validation-layer test is `tests/validation.test.ts`.

## Assumptions

- A single `file` field, one file per request, as specified.
- No patient identity or demographics are extracted or included in the response — the
  assignment's example response contains none, and this service follows that.
- `Observation.subject` is omitted. There's no patient context to reference, and R4
  makes `subject` optional (`0..1`) for exactly this situation.
- Multi-page PDFs are supported by concatenating observations across all pages (the
  bonus item); observations aren't deduplicated across pages, since a real duplicate
  test result is a legitimate thing for a report to contain and a naive dedupe risks
  dropping one.
