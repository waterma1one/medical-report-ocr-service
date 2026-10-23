import type { MappedObservation } from "./mapper.js";

// meta.needsReview is not a valid FHIR R4 element — Meta only defines id, extension,
// versionId, lastUpdated, source, profile, security and tag (verified against the R4
// StructureDefinition). It is kept here as a deliberate, documented deviation so clients
// can read the list at the top level; see the README for the conformant
// alternative (a Meta.extension).
interface BundleMetaWithReviewFlags extends fhir4.Meta {
  needsReview?: string[];
}

export function buildBundle(
  observations: MappedObservation[],
  needsReview: string[],
): fhir4.Bundle {
  const entries: fhir4.BundleEntry[] = observations.map(({ observation }) => ({
    fullUrl: `urn:uuid:${observation.id}`,
    resource: observation,
  }));

  const meta: BundleMetaWithReviewFlags = { source: "ocr-extraction" };
  if (needsReview.length > 0) {
    meta.needsReview = [...new Set(needsReview)];
  }

  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: entries,
    meta,
  };
}
