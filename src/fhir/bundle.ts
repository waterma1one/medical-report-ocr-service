import type { MappedObservation } from "./mapper.js";

// R4 Meta has no needsReview element, so each name is carried as a Meta.extension with
// a valueString. The URL is an identifier, not a published StructureDefinition.
export const NEEDS_REVIEW_EXTENSION_URL = "urn:medical-report-ocr-service:needs-review";

export function buildBundle(
  observations: MappedObservation[],
  needsReview: string[],
): fhir4.Bundle {
  const entries: fhir4.BundleEntry[] = observations.map(({ observation }) => ({
    fullUrl: `urn:uuid:${observation.id}`,
    resource: observation,
  }));

  const meta: fhir4.Meta = { source: "ocr-extraction" };
  if (needsReview.length > 0) {
    meta.extension = [...new Set(needsReview)].map((name) => ({
      url: NEEDS_REVIEW_EXTENSION_URL,
      valueString: name,
    }));
  }

  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: entries,
    meta,
  };
}
