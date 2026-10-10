import { z } from "zod"

const publicSupabaseSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
})

const adminSupabaseSchema = publicSupabaseSchema.extend({
  SUPABASE_SECRET_KEY: z.string().min(1),
})

const appUrlSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
})

const sharedEmailEnvShape = {
  EMAIL_REPLY_TO_EMAIL: z.preprocess(
    emptyStringToUndefined,
    z.string().email().optional()
  ),
  EMAIL_TIMEOUT_MS: z.preprocess(
    parseIntegerEnvValue,
    z.number().int().min(1000).max(60000).default(10000)
  ),
}

const emailJsEmailEnvSchema = z.object({
  EMAIL_PROVIDER: z.literal("emailjs"),
  ...sharedEmailEnvShape,
  EMAILJS_SERVICE_ID: z.string().trim().min(1),
  EMAILJS_TEMPLATE_ID: z.string().trim().min(1),
  EMAILJS_PUBLIC_KEY: z.string().trim().min(1),
  EMAILJS_PRIVATE_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(1).optional()
  ),
})

const aiEnvSchema = z.object({
  AI_PROVIDER: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z][a-z0-9_-]*$/),
  AI_MODEL: z.string().trim().min(1),
  // A Flow turn that builds a form has taken Gemini 12-43 seconds, and its
  // longest answer (8,192 tokens) takes longer still.
  AI_TIMEOUT_MS: z.preprocess(
    parseIntegerEnvValue,
    z.number().int().min(1000).max(120000).default(90000)
  ),
  // Overrides the approved model's reasoning effort, for benchmark sweeps.
  AI_EFFORT: z.enum(["minimal", "low", "medium", "high"]).optional()
})

// Each registered AI provider's credential. Read only when that provider is
// the one configured, so an unused provider needs no key.
const AI_PROVIDER_KEY_NAMES = {
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY"
} as const

const r2EnvSchema = z.object({
  CLOUDFLARE_R2_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().min(1),
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().min(1),
  CLOUDFLARE_R2_BUCKET_NAME: z.string().min(1),
  CLOUDFLARE_R2_ENDPOINT: z.string().url(),
  CLOUDFLARE_R2_REGION: z.string().min(1).default("auto"),
  CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS: z
    .preprocess(
      parseIntegerEnvValue,
      z.number().int().min(1).max(604800).default(900)
    ),
})

const fileUploadPolicySchema = z.object({
  FILE_UPLOAD_MAX_BYTES: z.preprocess(
    parseIntegerEnvValue,
    z.number().int().positive()
  ),
  FILE_UPLOAD_ALLOWED_MIME_TYPES: z
    .string()
    .transform(parseAllowedMimeTypes),
})

const upstashRedisEnvSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
})

const posthogEnvSchema = z.object({
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
})

const inngestEnvSchema = z.object({
  INNGEST_APP_ID: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/)
    .default("bizflow-docs"),
  INNGEST_SERVE_PATH: z
    .string()
    .trim()
    .regex(/^\/[a-z0-9/-]*$/)
    .default("/api/inngest"),
  INNGEST_EVENT_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
  INNGEST_SIGNING_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().optional()
  ),
})

const sentryEnvSchema = z.object({
  SENTRY_DSN: z.string().url(),
  SENTRY_ENVIRONMENT: z.string().min(1).default("development"),
  SENTRY_TRACES_SAMPLE_RATE: z.preprocess(
    parseNumberEnvValue,
    z.number().min(0).max(1).default(0.1)
  ),
  SENTRY_PROFILES_SAMPLE_RATE: z.preprocess(
    parseNumberEnvValue,
    z.number().min(0).max(1).default(0)
  ),
})

const smsEnvSchema = z.object({
  SMS_PROVIDER: z.enum(["termii", "mock"]).default("mock"),
  TERMII_API_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
  TERMII_SENDER_ID: z.preprocess(
    emptyStringToUndefined,
    z.string().default("BizFlow")
  ),
  TERMII_BASE_URL: z
    .preprocess(emptyStringToUndefined, z.string().url().optional())
    .default("https://api.ng.termii.com/api"),
  SMS_TIMEOUT_MS: z.preprocess(
    parseIntegerEnvValue,
    z.number().int().min(1000).max(60000).default(10000)
  ),
})

export type PublicSupabaseEnv = z.infer<typeof publicSupabaseSchema>
export type AdminSupabaseEnv = z.infer<typeof adminSupabaseSchema>

export type AppUrlEnv = z.infer<typeof appUrlSchema>
export type EmailJsEmailEnv = z.infer<typeof emailJsEmailEnvSchema>
export type EmailEnv = EmailJsEmailEnv
export type AiEnv = z.infer<typeof aiEnvSchema>
export type AiKeyedProvider = keyof typeof AI_PROVIDER_KEY_NAMES
export type R2Env = z.infer<typeof r2EnvSchema>
export type FileUploadPolicyEnv = z.infer<typeof fileUploadPolicySchema>
export type InngestEnv = z.infer<typeof inngestEnvSchema>
export type SentryEnv = z.infer<typeof sentryEnvSchema>
export type UpstashRedisEnv = z.infer<typeof upstashRedisEnvSchema>
export type SmsEnv = z.infer<typeof smsEnvSchema>

function emptyStringToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim().length === 0
    ? undefined
    : value
}

function parseIntegerEnvValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value
  }

  const normalizedValue = value.trim()

  if (normalizedValue.length === 0) {
    return undefined
  }

  if (!/^-?\d+$/.test(normalizedValue)) {
    return Number.NaN
  }

  return Number(normalizedValue)
}

function parseNumberEnvValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value
  }

  const normalizedValue = value.trim()

  if (normalizedValue.length === 0) {
    return undefined
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalizedValue)) {
    return Number.NaN
  }

  return Number(normalizedValue)
}

function parseAllowedMimeTypes(
  value: string,
  context: z.core.$RefinementCtx<string>
): string[] {
  const mimeTypes = value
    .split(",")
    .map((mimeType: string) => mimeType.trim())
    .filter((mimeType: string) => mimeType.length > 0)

  if (mimeTypes.length === 0) {
    context.addIssue({
      code: "custom",
      message: "At least one MIME type is required.",
    })
    return z.NEVER
  }

  return mimeTypes
}

// Zod objects drop undeclared keys, so only the schema's own values come back.
function parseEnv<Schema extends z.ZodType>(
  schema: Schema,
  source: unknown,
  label: string
): z.infer<Schema> {
  const result = schema.safeParse(source)

  if (!result.success) {
    const issues = result.error.issues
      .map((issue: z.core.$ZodIssue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")
    throw new Error(`Invalid ${label} environment: ${issues}`)
  }

  return result.data
}

/**
 * Reads and validates browser-safe Supabase environment values.
 *
 * @returns Normalized Supabase URL and publishable key.
 * @throws Error when the URL or publishable key is missing or invalid.
 */
export function getPublicSupabaseEnv(): PublicSupabaseEnv {
  return parseEnv(publicSupabaseSchema, process.env, "public Supabase")
}

/**
 * Checks whether browser-safe Supabase environment values are configured.
 *
 * @returns True when the URL and publishable key are set.
 */
export function isPublicSupabaseEnvConfigured(): boolean {
  return publicSupabaseSchema.safeParse(process.env).success
}

/**
 * Reads and validates server-only Supabase admin environment values.
 *
 * @returns Normalized public values plus the Supabase secret key.
 * @throws Error when any required admin value is missing or invalid.
 */
export function getAdminSupabaseEnv(): AdminSupabaseEnv {
  return parseEnv(adminSupabaseSchema, process.env, "admin Supabase")
}

/**
 * Reads and validates the public application URL.
 *
 * @returns Required configured application URL.
 * @throws Error when the configured app URL is invalid.
 */
export function getAppUrlEnv(): AppUrlEnv {
  return parseEnv(appUrlSchema, process.env, "app URL")
}

/**
 * Reads and validates the active server-side EmailJS configuration.
 *
 * Transactional delivery is pinned to EmailJS, the only email provider; a
 * stale EMAIL_PROVIDER value cannot select another one.
 *
 * @returns The validated EmailJS delivery configuration.
 * @throws Error when required email-delivery values are missing or invalid.
 */
export function getEmailEnv(): EmailEnv {
  const env = parseEnv(
    emailJsEmailEnvSchema,
    { ...process.env, EMAIL_PROVIDER: "emailjs" },
    "email"
  )

  // EmailJS's public key ships to browsers by design; without the private key
  // anyone holding it could send through this account.
  if (isProductionRuntime() && !env.EMAILJS_PRIVATE_KEY) {
    throw new Error(
      "Invalid email environment: EMAILJS_PRIVATE_KEY is required in production."
    )
  }

  return env
}

/**
 * Fails a Vercel production deployment at boot when a value every request
 * path depends on is missing, instead of on the first user who reaches it.
 * Optional services (Sentry, PostHog, Upstash, AI, SMS) keep their fallbacks.
 *
 * @throws Error naming the first missing or invalid value.
 */
export function assertProductionEnv(): void {
  if (process.env.VERCEL_ENV !== "production") {
    return
  }

  getAdminSupabaseEnv()
  getAppUrlEnv()
  getEmailEnv()
  getR2Env()
  getFileUploadPolicyEnv()
}

/**
 * Whether this is a production build or a Vercel production deployment,
 * where a development fallback must fail closed rather than pretend to work.
 *
 * @returns True when NODE_ENV or VERCEL_ENV is `production`.
 */
export function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  )
}

/**
 * Reads and validates the server-only AI provider configuration.
 *
 * @returns Provider, exact model identifier, provider credential, and timeout.
 * @throws Error when required AI configuration is missing or invalid.
 */
export function getAiEnv(): AiEnv {
  const provider = process.env.AI_PROVIDER?.trim() || "gemini"
  return parseEnv(
    aiEnvSchema,
    {
      AI_PROVIDER: provider,
      AI_MODEL:
        process.env.AI_MODEL?.trim() ||
        // The newest approved model (services/ai/approved-models.ts).
        (provider === "gemini" ? "gemini-3.8-flash" : undefined),
      AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
      AI_EFFORT: process.env.AI_EFFORT?.trim() || undefined,
    },
    "AI"
  )
}

/**
 * Reads one AI provider's API key.
 *
 * @param provider - The registered provider whose key is needed.
 * @returns The trimmed key.
 * @throws Error naming the missing variable.
 */
export function getAiProviderKey(provider: AiKeyedProvider): string {
  const name = AI_PROVIDER_KEY_NAMES[provider]
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`Invalid AI environment: ${name} is required.`)
  }

  return value
}

/**
 * Reads and validates server-only Cloudflare R2 environment values.
 *
 * @returns R2 account, bucket, endpoint, credentials, region, and signed URL TTL.
 * @throws Error when required values are missing or invalid.
 */
export function getR2Env(): R2Env {
  return parseEnv(r2EnvSchema, process.env, "R2")
}

/**
 * Reads and validates document upload policy environment values.
 *
 * @returns Maximum upload size and allowed MIME types.
 * @throws Error when the size or MIME type list is missing or invalid.
 */
export function getFileUploadPolicyEnv(): FileUploadPolicyEnv {
  return parseEnv(fileUploadPolicySchema, process.env, "file upload policy")
}

/**
 * Reads and validates the Upstash Redis REST configuration.
 *
 * @returns Upstash REST URL and token for distributed rate limiting.
 * @throws Error when the URL or token is missing or invalid.
 */
export function getUpstashRedisEnv(): UpstashRedisEnv {
  return parseEnv(upstashRedisEnvSchema, process.env, "Upstash Redis")
}

/**
 * Checks whether the Upstash Redis environment is configured.
 *
 * Rate limiting is opt-in per environment: when unconfigured the limiter
 * allows every request, so local dev, CI, and tests need no Redis.
 *
 * @returns True when the REST URL and token are both set and valid.
 */
export function isUpstashRedisEnvConfigured(): boolean {
  return upstashRedisEnvSchema.safeParse(process.env).success
}

/**
 * Reads and validates the Inngest background-job configuration.
 *
 * Both keys are optional by design: the local Inngest Dev Server accepts
 * unsigned requests and mints its own keys, so development and tests need no
 * credentials. Production receives them from the Inngest Vercel integration.
 *
 * @returns App id, serve path, and the optional event and signing keys.
 * @throws Error when a configured value is present but malformed.
 */
export function getInngestEnv(): InngestEnv {
  return parseEnv(inngestEnvSchema, process.env, "Inngest")
}

/**
 * Reads and validates the optional Sentry monitoring configuration.
 *
 * Monitoring is opt-in: when no DSN is set the app runs without Sentry, so
 * this getter returns `null` instead of throwing — SDK initialization has no
 * caller positioned to catch a configuration error.
 *
 * @returns Validated Sentry settings, or null when no DSN is configured.
 * @throws Error when a DSN is set but the configuration is invalid.
 */
export function getSentryEnv(): SentryEnv | null {
  const configuredDsn = process.env.SENTRY_DSN

  if (typeof configuredDsn !== "string" || configuredDsn.trim().length === 0) {
    return null
  }

  return parseEnv(
    sentryEnvSchema,
    {
      ...process.env,
      // Unset, a deploy reports as its Vercel environment, not "development".
      SENTRY_ENVIRONMENT:
        process.env.SENTRY_ENVIRONMENT?.trim() ||
        process.env.VERCEL_ENV?.trim() ||
        undefined,
    },
    "Sentry"
  )
}

/** Default PostHog ingest origin used when no host is configured. */
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com"

/**
 * Reads and validates the public PostHog analytics configuration.
 *
 * Returns null when no project key is configured, which disables analytics
 * rather than failing the build. The resolved host is also what the
 * `connect-src` CSP directive must allow, so both callers read it from here.
 *
 * @returns Validated key and resolved ingest host, or null when unconfigured.
 * @throws Error when a key is set but the configuration is invalid.
 */
export function getPosthogEnv(): { key: string; host: string } | null {
  const configuredKey = process.env.NEXT_PUBLIC_POSTHOG_KEY

  if (typeof configuredKey !== "string" || configuredKey.trim().length === 0) {
    return null
  }

  const env = parseEnv(posthogEnvSchema, process.env, "PostHog")

  return {
    key: configuredKey,
    host: env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
  }
}

/**
 * Reads and validates the server-only SMS provider configuration.
 *
 * @returns SMS provider mode, Termii API key, sender ID, base URL, and timeout.
 * @throws Error when SMS environment configuration is invalid.
 */
export function getSmsEnv(): SmsEnv {
  return parseEnv(smsEnvSchema, process.env, "SMS")
}
