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
  RESEND_FROM_EMAIL: z.string().min(1),
  RESEND_REPLY_TO_EMAIL: z.preprocess(
    (value: unknown): unknown =>
      typeof value === "string" && value.trim().length === 0 ? undefined : value,
    z.string().email().optional()
  ),
  RESEND_TIMEOUT_MS: z.preprocess(
    parseIntegerEnvValue,
    z.number().int().min(1000).max(60000).default(10000)
  ),
})

const openRouterEnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().min(1).default("openai/gpt-5-mini"),
  OPENROUTER_TIMEOUT_MS: z.preprocess(
    parseIntegerEnvValue,
    z.number().int().min(1000).max(60000).default(30000)
  ),
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
export type OpenRouterEnv = z.infer<typeof openRouterEnvSchema>
export type R2Env = z.infer<typeof r2EnvSchema>
export type FileUploadPolicyEnv = z.infer<typeof fileUploadPolicySchema>

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
 * Reads and validates the server-only Resend email configuration.
 *
 * @returns Resend API key, sender addresses, and request timeout.
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
 * Reads and validates server-only OpenRouter assistant configuration.
 *
 * @returns OpenRouter API key, model identifier, and request timeout.
 * @throws Error when required AI configuration is missing or invalid.
 */
export function getOpenRouterEnv(): OpenRouterEnv {
  const result = openRouterEnvSchema.safeParse(process.env)

  if (!result.success) {
    throw new Error(
      `Invalid OpenRouter environment: ${formatEnvError(result.error)}`
    )
  }

  return result.data
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
