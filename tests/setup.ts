// src/config.ts validates the environment when it is first imported, so these have to
// be in place before any module that reaches it gets evaluated. Setting them inside a
// beforeAll hook runs too late.
process.env.API_BEARER_TOKEN ??= "test-token";
process.env.DATALAB_API_KEY ??= "test-datalab-key";
process.env.LOG_LEVEL ??= "silent";
