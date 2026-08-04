import { existsSync } from "node:fs";
import { z } from "zod";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const numericString = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((val) => (val === undefined ? fallback : Number(val)))
    .pipe(z.number().int().positive());

const envSchema = z
  .object({
    PORT: numericString(3000),

    API_BEARER_TOKEN: z.string().min(1, "API_BEARER_TOKEN is required"),

    // Deliberately not required at the field level: OCR_PROVIDER=fixture exists so
    // this service is runnable with no Datalab account at all. Required-ness is
    // enforced below, conditional on which provider is actually selected.
    //
    // .env.example ships this key blank ("DATALAB_API_KEY="), which loadEnvFile turns
    // into an empty string, not an absent one — treat the two the same, or a
    // never-filled-in placeholder trips the check below with a confusing error.
    DATALAB_API_KEY: z
      .string()
      .optional()
      .transform((val) => (val === "" ? undefined : val)),
    DATALAB_API_URL: z
      .string()
      .url()
      .default("https://www.datalab.to/api/v1/marker"),
    DATALAB_MODE: z.enum(["fast", "balanced", "accurate"]).default("balanced"),
    DATALAB_POLL_INTERVAL_MS: numericString(2000),
    DATALAB_POLL_TIMEOUT_MS: numericString(180_000),

    OCR_PROVIDER: z.enum(["datalab", "fixture"]).default("datalab"),
    OCR_FIXTURE_PATH: z.string().default("examples/sample-ocr-output.md"),

    MAX_FILE_SIZE_BYTES: numericString(10 * 1024 * 1024),

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  })
  .refine((env) => env.OCR_PROVIDER !== "datalab" || Boolean(env.DATALAB_API_KEY), {
    message: "DATALAB_API_KEY is required unless OCR_PROVIDER=fixture",
    path: ["DATALAB_API_KEY"],
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const env = parsed.data;

export const config = {
  port: env.PORT,
  bearerToken: env.API_BEARER_TOKEN,
  datalab: {
    // The .refine() above guarantees this is set whenever OCR_PROVIDER is "datalab",
    // which is the only branch that ever reads it (see ocr/index.ts). Fixture mode
    // leaves it unset and never touches this field.
    apiKey: env.DATALAB_API_KEY ?? "",
    apiUrl: env.DATALAB_API_URL,
    mode: env.DATALAB_MODE,
    pollIntervalMs: env.DATALAB_POLL_INTERVAL_MS,
    pollTimeoutMs: env.DATALAB_POLL_TIMEOUT_MS,
  },
  ocrProvider: env.OCR_PROVIDER,
  ocrFixturePath: env.OCR_FIXTURE_PATH,
  maxFileSizeBytes: env.MAX_FILE_SIZE_BYTES,
  logLevel: env.LOG_LEVEL,
} as const;
