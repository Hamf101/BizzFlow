import { afterEach, describe, expect, it } from "vitest"

import {
  getAdminSupabaseEnv,
  getAiEnv,
  getAppUrlEnv,
  getFileUploadPolicyEnv,
  getGeminiEnv,
  getR2Env,
  getResendEnv,
  getSentryEnv,
  getUpstashRedisEnv,
  isUpstashRedisEnvConfigured,
} from "./env"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

const validR2Env = {
  CLOUDFLARE_R2_ACCOUNT_ID: "account-id",
  CLOUDFLARE_R2_ACCESS_KEY_ID: "access-key-id",
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: "secret-access-key",
  CLOUDFLARE_R2_BUCKET_NAME: "documents",
  CLOUDFLARE_R2_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
}

function setIsolatedEnv(env: Partial<NodeJS.ProcessEnv>): void {
  process.env = {
    ...env,
    NODE_ENV: "test",
  }
}

describe("Supabase environment validation", () => {
  it("uses the exact current Supabase secret key name for admin access", () => {
    process.env = {
      ...originalEnv,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      SUPABASE_SECRET_KEY: "sb_secret_test",
    }

    expect(getAdminSupabaseEnv()).toEqual({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      SUPABASE_SECRET_KEY: "sb_secret_test",
    })
  })

  it("requires the exact Supabase secret key name for admin access", () => {
    process.env = {
      ...originalEnv,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    }

    expect(() => getAdminSupabaseEnv()).toThrow("SUPABASE_SECRET_KEY")
  })

  it("does not accept removed Next.js public Supabase aliases", () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      SUPABASE_SECRET_KEY: "sb_secret_test",
    }

    expect(() => getAdminSupabaseEnv()).toThrow("SUPABASE_URL")
  })
})

describe("application URL validation", () => {
  it("requires an explicit canonical application URL", () => {
    setIsolatedEnv({})

    expect(() => getAppUrlEnv()).toThrow("NEXT_PUBLIC_APP_URL")
  })

  it("accepts an absolute canonical application URL", () => {
    setIsolatedEnv({ NEXT_PUBLIC_APP_URL: "https://app.example.com" })

    expect(getAppUrlEnv()).toEqual({
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
    })
  })
})

describe("Resend environment validation", () => {
  it("drops a blank reply-to and defaults the request timeout", () => {
    setIsolatedEnv({
      RESEND_API_KEY: "re-test-key",
      RESEND_FROM_EMAIL: "docs@example.com",
      RESEND_REPLY_TO_EMAIL: "  ",
    })

    expect(getResendEnv()).toEqual({
      RESEND_API_KEY: "re-test-key",
      RESEND_FROM_EMAIL: "docs@example.com",
      RESEND_TIMEOUT_MS: 10000,
    })
  })

  it("requires a valid sender address", () => {
    setIsolatedEnv({
      RESEND_API_KEY: "re-test-key",
      RESEND_FROM_EMAIL: "not-an-email",
    })

    expect(() => getResendEnv()).toThrow("RESEND_FROM_EMAIL")
  })

  it.each(["999", "60001", "1.5", "not-a-number"])(
    "rejects invalid Resend timeout %s",
    (timeoutMs: string) => {
      setIsolatedEnv({
        RESEND_API_KEY: "re-test-key",
        RESEND_FROM_EMAIL: "docs@example.com",
        RESEND_TIMEOUT_MS: timeoutMs,
      })

      expect(() => getResendEnv()).toThrow("RESEND_TIMEOUT_MS")
    }
  )
})

describe("Upstash Redis environment validation", () => {
  it("reports unconfigured when the URL or token is missing", () => {
    setIsolatedEnv({ UPSTASH_REDIS_REST_URL: "https://example.upstash.io" })

    expect(isUpstashRedisEnvConfigured()).toBe(false)
    expect(() => getUpstashRedisEnv()).toThrow("UPSTASH_REDIS_REST_TOKEN")
  })

  it("accepts a complete REST configuration", () => {
    setIsolatedEnv({
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "upstash-test-token",
    })

    expect(isUpstashRedisEnvConfigured()).toBe(true)
    expect(getUpstashRedisEnv()).toEqual({
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "upstash-test-token",
    })
  })

  it("rejects a non-URL REST endpoint", () => {
    setIsolatedEnv({
      UPSTASH_REDIS_REST_URL: "not-a-url",
      UPSTASH_REDIS_REST_TOKEN: "upstash-test-token",
    })

    expect(isUpstashRedisEnvConfigured()).toBe(false)
    expect(() => getUpstashRedisEnv()).toThrow("UPSTASH_REDIS_REST_URL")
  })
})

describe("Sentry environment validation", () => {
  it("returns null when no DSN is configured", () => {
    setIsolatedEnv({ SENTRY_TRACES_SAMPLE_RATE: "0.5" })

    expect(getSentryEnv()).toBeNull()
  })

  it("treats a blank DSN as unconfigured", () => {
    setIsolatedEnv({ SENTRY_DSN: "   " })

    expect(getSentryEnv()).toBeNull()
  })

  it("applies defaults and parses fractional sample rates", () => {
    setIsolatedEnv({
      SENTRY_DSN: "https://key@o0.ingest.sentry.io/1",
      SENTRY_TRACES_SAMPLE_RATE: "0.25",
    })

    expect(getSentryEnv()).toEqual({
      SENTRY_DSN: "https://key@o0.ingest.sentry.io/1",
      SENTRY_ENVIRONMENT: "development",
      SENTRY_TRACES_SAMPLE_RATE: 0.25,
      SENTRY_PROFILES_SAMPLE_RATE: 0,
    })
  })

  it.each(["1.5", "-0.1", "not-a-number"])(
    "rejects invalid traces sample rate %s",
    (sampleRate: string) => {
      setIsolatedEnv({
        SENTRY_DSN: "https://key@o0.ingest.sentry.io/1",
        SENTRY_TRACES_SAMPLE_RATE: sampleRate,
      })

      expect(() => getSentryEnv()).toThrow("SENTRY_TRACES_SAMPLE_RATE")
    }
  )
})

describe("R2 environment validation", () => {
  it("defaults region to auto and signed URL TTL to 900 seconds", () => {
    setIsolatedEnv({
      ...validR2Env,
    })

    expect(getR2Env()).toEqual({
      CLOUDFLARE_R2_ACCOUNT_ID: "account-id",
      CLOUDFLARE_R2_ACCESS_KEY_ID: "access-key-id",
      CLOUDFLARE_R2_SECRET_ACCESS_KEY: "secret-access-key",
      CLOUDFLARE_R2_BUCKET_NAME: "documents",
      CLOUDFLARE_R2_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
      CLOUDFLARE_R2_REGION: "auto",
      CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS: 900,
    })
  })

  it("accepts signed URL TTL lower and upper bounds", () => {
    setIsolatedEnv({
      ...validR2Env,
      CLOUDFLARE_R2_REGION: "us-east-1",
      CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS: "604800",
    })

    expect(getR2Env().CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS).toBe(604800)

    setIsolatedEnv({
      ...validR2Env,
      CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS: "1",
    })

    expect(getR2Env().CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS).toBe(1)
  })

  it.each(["0", "604801", "1.5", "not-a-number"])(
    "rejects invalid signed URL TTL value %s",
    (ttlSeconds: string) => {
      setIsolatedEnv({
        ...validR2Env,
        CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS: ttlSeconds,
      })

      expect(() => getR2Env()).toThrow("CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS")
    }
  )

  it("requires all server-only R2 values", () => {
    setIsolatedEnv({})

    expect(() => getR2Env()).toThrow("CLOUDFLARE_R2_ACCOUNT_ID")
  })
})

describe("file upload policy environment validation", () => {
  it("parses max bytes and comma-delimited MIME types", () => {
    setIsolatedEnv({
      FILE_UPLOAD_MAX_BYTES: "10485760",
      FILE_UPLOAD_ALLOWED_MIME_TYPES: "application/pdf, image/png ,text/csv",
    })

    expect(getFileUploadPolicyEnv()).toEqual({
      FILE_UPLOAD_MAX_BYTES: 10485760,
      FILE_UPLOAD_ALLOWED_MIME_TYPES: [
        "application/pdf",
        "image/png",
        "text/csv",
      ],
    })
  })

  it.each(["0", "-1", "1.5", "not-a-number"])(
    "rejects invalid max byte value %s",
    (maxBytes: string) => {
      setIsolatedEnv({
        FILE_UPLOAD_MAX_BYTES: maxBytes,
        FILE_UPLOAD_ALLOWED_MIME_TYPES: "application/pdf",
      })

      expect(() => getFileUploadPolicyEnv()).toThrow("FILE_UPLOAD_MAX_BYTES")
    }
  )

  it.each(["", " , "])(
    "rejects empty allowed MIME type list %s",
    (allowedMimeTypes: string) => {
      setIsolatedEnv({
        FILE_UPLOAD_MAX_BYTES: "1024",
        FILE_UPLOAD_ALLOWED_MIME_TYPES: allowedMimeTypes,
      })

      expect(() => getFileUploadPolicyEnv()).toThrow(
        "FILE_UPLOAD_ALLOWED_MIME_TYPES"
      )
    }
  )
})

describe("AI environment validation", () => {
  it("uses the current provider, stable model, and timeout by default", () => {
    setIsolatedEnv({
      GEMINI_API_KEY: "gemini-test-key",
    })

    expect(getAiEnv()).toEqual({
      AI_PROVIDER: "gemini",
      AI_MODEL: "gemini-3.6-flash",
      AI_TIMEOUT_MS: 30000,
    })
  })

  it("uses canonical model and timeout values without changing the model", () => {
    setIsolatedEnv({
      AI_PROVIDER: "gemini",
      AI_MODEL: "gemini-exact-test-model",
      AI_TIMEOUT_MS: "12000",
      GEMINI_API_KEY: "gemini-test-key",
      GEMINI_MODEL: "deprecated-model",
      GEMINI_TIMEOUT_MS: "45000",
    })

    expect(getAiEnv()).toEqual({
      AI_PROVIDER: "gemini",
      AI_MODEL: "gemini-exact-test-model",
      AI_TIMEOUT_MS: 12000,
    })
  })

  it("reads deprecated model and timeout aliases for one release", () => {
    setIsolatedEnv({
      GEMINI_API_KEY: "gemini-test-key",
      GEMINI_MODEL: "gemini-deployed-model",
      GEMINI_TIMEOUT_MS: "18000",
    })

    expect(getAiEnv()).toEqual({
      AI_PROVIDER: "gemini",
      AI_MODEL: "gemini-deployed-model",
      AI_TIMEOUT_MS: 18000,
    })
  })

  it("keeps generic provider configuration independent of adapter registration", () => {
    setIsolatedEnv({
      AI_PROVIDER: "unknown-provider",
      AI_MODEL: "provider-model-v1",
    })

    expect(getAiEnv()).toEqual({
      AI_PROVIDER: "unknown-provider",
      AI_MODEL: "provider-model-v1",
      AI_TIMEOUT_MS: 30000,
    })
  })

  it("requires an explicit model for providers without a registered default", () => {
    setIsolatedEnv({
      AI_PROVIDER: "future-provider",
    })

    expect(() => getAiEnv()).toThrow("AI_MODEL")
  })

  it("validates Gemini credentials separately from generic AI settings", () => {
    setIsolatedEnv({
      GEMINI_API_KEY: "gemini-test-key",
    })

    expect(getGeminiEnv()).toEqual({
      GEMINI_API_KEY: "gemini-test-key",
    })
  })

  it("rejects a missing Gemini adapter credential", () => {
    setIsolatedEnv({})

    expect(() => getGeminiEnv()).toThrow("GEMINI_API_KEY")
  })

  it.each(["999", "60001", "1.5", "not-a-number"])(
    "rejects invalid AI timeout %s",
    (timeoutMs: string) => {
      setIsolatedEnv({
        AI_TIMEOUT_MS: timeoutMs,
        GEMINI_API_KEY: "gemini-test-key",
      })

      expect(() => getAiEnv()).toThrow("AI_TIMEOUT_MS")
    }
  )
})
