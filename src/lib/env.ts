import { z } from "zod"

const publicSupabaseSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
})

const adminSupabaseSchema = publicSupabaseSchema.extend({
  SUPABASE_SECRET_KEY: z.string().min(1),
})

const appUrlSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
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
 * @returns Configured app URL, defaulting to localhost for development.
 * @throws Error when the configured app URL is invalid.
 */
export function getAppUrlEnv(): AppUrlEnv {
  const result = appUrlSchema.safeParse(process.env)

  if (!result.success) {
    throw new Error(`Invalid app URL environment: ${formatEnvError(result.error)}`)
  }

  return result.data
}
