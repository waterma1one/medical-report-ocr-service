// src/config.ts validates the environment when it is first imported, so these have to
// be in place before any module that reaches it gets evaluated. Setting them inside a
// beforeAll hook runs too late.
process.env.API_BEARER_TOKEN ??= "test-token";
process.env.DATALAB_API_KEY ??= "test-datalab-key";
process.env.LOG_LEVEL ??= "silent";

// Pinned rather than defaulted: config.ts reads a local .env when one exists, so
// without this the suite would take whichever OCR provider the developer happens to
// have configured. The route tests stub fetch and assert on the Datalab path, so a
// machine set to fixture mode would silently exercise a different provider and fail.
process.env.OCR_PROVIDER = "datalab";
