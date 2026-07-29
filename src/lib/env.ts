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

const resendEnvSchema = z.object({
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().email(),
  RESEND_REPLY_TO_EMAIL: z.preprocess(
    emptyStringToUndefined,
    z.string().email().optional()
  ),
  RESEND_TIMEOUT_MS: z.preprocess(
    parseIntegerEnvValue,
    z.number().int().min(1000).max(60000).default(10000)
  ),
})

const aiEnvSchema = z.object({
  AI_PROVIDER: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z][a-z0-9_-]*$/)
    .default("gemini"),
  AI_MODEL: z.string().trim().min(1),
  AI_TIMEOUT_MS: z.preprocess(
    parseIntegerEnvValue,
    z.number().int().min(1000).max(60000).default(30000)
  )
})

const geminiEnvSchema = z.object({
  GEMINI_API_KEY: z.string().trim().min(1)
})

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

type PublicSupabaseInput = z.infer<typeof publicSupabaseSchema>
type AdminSupabaseInput = z.infer<typeof adminSupabaseSchema>

export type PublicSupabaseEnv = {
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
}

export type AdminSupabaseEnv = PublicSupabaseEnv & {
  SUPABASE_SECRET_KEY: string
}

export type AppUrlEnv = z.infer<typeof appUrlSchema>
export type ResendEnv = z.infer<typeof resendEnvSchema>
export type AiEnv = z.infer<typeof aiEnvSchema>
export type GeminiEnv = z.infer<typeof geminiEnvSchema>
export type R2Env = z.infer<typeof r2EnvSchema>
export type FileUploadPolicyEnv = z.infer<typeof fileUploadPolicySchema>
export type InngestEnv = z.infer<typeof inngestEnvSchema>
export type SentryEnv = z.infer<typeof sentryEnvSchema>
export type UpstashRedisEnv = z.infer<typeof upstashRedisEnvSchema>

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

function formatEnvError(error: z.ZodError): string {
  return error.issues
    .map((issue: z.core.$ZodIssue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ")
}

function normalizePublicSupabaseEnv(env: PublicSupabaseInput): PublicSupabaseEnv {
  return {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY,
  }
}

function normalizeAdminSupabaseEnv(env: AdminSupabaseInput): AdminSupabaseEnv {
  return {
    ...normalizePublicSupabaseEnv(env),
    SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY,
  }
}

/**
 * Reads and validates browser-safe Supabase environment values.
 *
 * @returns Normalized Supabase URL and publishable key.
 * @throws Error when the URL or publishable key is missing or invalid.
 */
export function getPublicSupabaseEnv(): PublicSupabaseEnv {
  const result = publicSupabaseSchema.safeParse(process.env)

  if (!result.success) {
    throw new Error(`Invalid public Supabase environment: ${formatEnvError(result.error)}`)
  }

  return normalizePublicSupabaseEnv(result.data)
}

/**
 * Checks whether browser-safe Supabase environment values are configured.
 *
 * @returns True when the URL and publishable key are set.
 */
export function isPublicSupabaseEnvConfigured(): boolean {
  const result = publicSupabaseSchema.safeParse(process.env)

  if (!result.success) {
    return false
  }

  return true
}

/**
 * Reads and validates server-only Supabase admin environment values.
 *
 * @returns Normalized public values plus the Supabase secret key.
 * @throws Error when any required admin value is missing or invalid.
 */
export function getAdminSupabaseEnv(): AdminSupabaseEnv {
  const result = adminSupabaseSchema.safeParse(process.env)

  if (!result.success) {
    throw new Error(`Invalid admin Supabase environment: ${formatEnvError(result.error)}`)
  }

  return normalizeAdminSupabaseEnv(result.data)
}

/**
 * Reads and validates the public application URL.
 *
 * @returns Required configured application URL.
 * @throws Error when the configured app URL is invalid.
 */
export function getAppUrlEnv(): AppUrlEnv {
  const result = appUrlSchema.safeParse(process.env)

  if (!result.success) {
    throw new Error(`Invalid app URL environment: ${formatEnvError(result.error)}`)
  }

  return result.data
}

/**
 * Reads and validates the server-side Resend configuration.
 *
 * @returns Resend API key, sender, reply address, and timeout.
 * @throws Error when required email-delivery values are missing or invalid.
 */
export function getResendEnv(): ResendEnv {
  const result = resendEnvSchema.safeParse(process.env)

  if (!result.success) {
    throw new Error(`Invalid Resend environment: ${formatEnvError(result.error)}`)
  }

  return result.data
}

/**
 * Reads and validates the server-only AI provider configuration.
 *
 * The deprecated Gemini model and timeout names remain read-only compatibility
 * aliases for one release. Canonical AI-prefixed values always take precedence.
 *
 * @returns Provider, exact model identifier, provider credential, and timeout.
 * @throws Error when required AI configuration is missing or invalid.
 */
export function getAiEnv(): AiEnv {
  const provider = process.env.AI_PROVIDER?.trim() || "gemini"
  const result = aiEnvSchema.safeParse({
    AI_PROVIDER: provider,
    AI_MODEL: readCanonicalOrDeprecatedEnvValue(
      process.env.AI_MODEL,
      provider === "gemini" ? process.env.GEMINI_MODEL : undefined
    ) ?? (provider === "gemini" ? "gemini-3.6-flash" : undefined),
    AI_TIMEOUT_MS: readCanonicalOrDeprecatedEnvValue(
      process.env.AI_TIMEOUT_MS,
      provider === "gemini" ? process.env.GEMINI_TIMEOUT_MS : undefined
    ),
  })

  if (!result.success) {
    throw new Error(
      `Invalid AI environment: ${formatEnvError(result.error)}`
    )
  }

  return result.data
}

/**
 * Reads and validates the credential for the Gemini infrastructure adapter.
 *
 * @returns Server-only Gemini credential.
 * @throws Error when the Gemini credential is missing or invalid.
 */
export function getGeminiEnv(): GeminiEnv {
  const result = geminiEnvSchema.safeParse(process.env)

  if (!result.success) {
    throw new Error(
      `Invalid Gemini environment: ${formatEnvError(result.error)}`
    )
  }

  return result.data
}

function readCanonicalOrDeprecatedEnvValue(
  canonicalValue: string | undefined,
  deprecatedValue: string | undefined
): string | undefined {
  if (
    typeof canonicalValue === "string" &&
    canonicalValue.trim().length > 0
  ) {
    return canonicalValue
  }

  if (
    typeof deprecatedValue === "string" &&
    deprecatedValue.trim().length > 0
  ) {
    return deprecatedValue
  }

  return undefined
}

/**
 * Reads and validates server-only Cloudflare R2 environment values.
 *
 * @returns R2 account, bucket, endpoint, credentials, region, and signed URL TTL.
 * @throws Error when required values are missing or invalid.
 */
export function getR2Env(): R2Env {
  const result = r2EnvSchema.safeParse(process.env)

  if (!result.success) {
    throw new Error(`Invalid R2 environment: ${formatEnvError(result.error)}`)
  }

  return result.data
}

/**
 * Reads and validates document upload policy environment values.
 *
 * @returns Maximum upload size and allowed MIME types.
 * @throws Error when the size or MIME type list is missing or invalid.
 */
export function getFileUploadPolicyEnv(): FileUploadPolicyEnv {
  const result = fileUploadPolicySchema.safeParse(process.env)

  if (!result.success) {
    throw new Error(`Invalid file upload policy environment: ${formatEnvError(result.error)}`)
  }

  return result.data
}

/**
 * Reads and validates the Upstash Redis REST configuration.
 *
 * @returns Upstash REST URL and token for distributed rate limiting.
 * @throws Error when the URL or token is missing or invalid.
 */
export function getUpstashRedisEnv(): UpstashRedisEnv {
  const result = upstashRedisEnvSchema.safeParse(process.env)

  if (!result.success) {
    throw new Error(`Invalid Upstash Redis environment: ${formatEnvError(result.error)}`)
  }

  return result.data
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
  const result = upstashRedisEnvSchema.safeParse(process.env)

  if (!result.success) {
    return false
  }

  return true
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
  const result = inngestEnvSchema.safeParse(process.env)

  if (!result.success) {
    throw new Error(`Invalid Inngest environment: ${formatEnvError(result.error)}`)
  }

  return result.data
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

  const result = sentryEnvSchema.safeParse(process.env)

  if (!result.success) {
    throw new Error(`Invalid Sentry environment: ${formatEnvError(result.error)}`)
  }

  return result.data
}
