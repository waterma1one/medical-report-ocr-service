// Subset of Datalab's InitialResponse / MarkerFinalResponse — only the fields this
// service actually reads. Verified against https://www.datalab.to/openapi.json.

export interface DatalabInitialResponse {
  success: boolean;
  error: string | null;
  request_id: string;
  request_check_url: string;
}

export interface DatalabPollResponse {
  // Documented as 'processing' | 'complete' | 'failed', but the OpenAPI schema types
  // it as an unconstrained string and both 'complete' and 'completed' appear elsewhere
  // in the spec — treat status.startsWith('complete') as the exit condition rather
  // than an exact match, and success:false as the authoritative failure signal.
  status: string;
  success?: boolean | null;
  error?: string | null;
  markdown?: string | null;
  result_url?: string | null;
  page_count?: number | null;
}

export interface OcrResult {
  markdown: string;
  pageCount: number | null;
}
