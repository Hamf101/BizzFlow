import { afterEach, describe, expect, it } from "vitest"

import {
  assertProductionEnv,
  getAdminSupabaseEnv,
  getAiEnv,
  getAppUrlEnv,
  getFileUploadPolicyEnv,
  getAiProviderKey,
  getEmailEnv,
  getR2Env,
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
  it("requires the exact Supabase secret key name for admin access", () => {
    setIsolatedEnv({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    })

    expect(() => getAdminSupabaseEnv()).toThrow("SUPABASE_SECRET_KEY")
  })

  it("does not accept removed Next.js public Supabase aliases", () => {
    setIsolatedEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      SUPABASE_SECRET_KEY: "sb_secret_test",
    })

    expect(() => getAdminSupabaseEnv()).toThrow("SUPABASE_URL")
  })
})

describe("boot-time production validation", () => {
  const productionEnv = {
    ...validR2Env,
    VERCEL_ENV: "production",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
    EMAILJS_SERVICE_ID: "service",
    EMAILJS_TEMPLATE_ID: "template",
    EMAILJS_PUBLIC_KEY: "public",
    EMAILJS_PRIVATE_KEY: "private",
    FILE_UPLOAD_MAX_BYTES: "1048576",
    FILE_UPLOAD_ALLOWED_MIME_TYPES: "application/pdf",
  }

  it("fails a production deployment at boot that is missing a required value, and passes a complete one", () => {
    setIsolatedEnv({ ...productionEnv, CLOUDFLARE_R2_ENDPOINT: undefined })
    expect(() => assertProductionEnv()).toThrow("CLOUDFLARE_R2_ENDPOINT")

    setIsolatedEnv(productionEnv)
    expect(() => assertProductionEnv()).not.toThrow()

    // Development, tests and the local production build used by e2e start without it.
    setIsolatedEnv({})
    expect(() => assertProductionEnv()).not.toThrow()
  })
})

describe("application URL validation", () => {
  it("requires an explicit canonical application URL", () => {
    setIsolatedEnv({})

    expect(() => getAppUrlEnv()).toThrow("NEXT_PUBLIC_APP_URL")
  })

})

describe("email environment validation", () => {
  it("keeps Resend disabled even when a stale selector remains deployed", () => {
    setIsolatedEnv({
      EMAIL_PROVIDER: "resend",
      EMAILJS_SERVICE_ID: "service_buy2dql",
      EMAILJS_TEMPLATE_ID: "template_d6o6c8p",
      EMAILJS_PUBLIC_KEY: "public-test-key",
    })

    expect(getEmailEnv()).toMatchObject({
      EMAIL_PROVIDER: "emailjs",
      EMAILJS_TEMPLATE_ID: "template_d6o6c8p",
    })
  })

  it("requires the private EmailJS key in production, where the public key alone would relay mail for anyone", () => {
    setIsolatedEnv({
      VERCEL_ENV: "production",
      EMAILJS_SERVICE_ID: "service_buy2dql",
      EMAILJS_TEMPLATE_ID: "template_d6o6c8p",
      EMAILJS_PUBLIC_KEY: "public-test-key",
    })

    expect(() => getEmailEnv()).toThrow("EMAILJS_PRIVATE_KEY")
  })

  it("requires the public EmailJS account key", () => {
    setIsolatedEnv({
      EMAIL_PROVIDER: "emailjs",
      EMAILJS_SERVICE_ID: "service_buy2dql",
      EMAILJS_TEMPLATE_ID: "template_d6o6c8p",
      EMAILJS_PRIVATE_KEY: "private-test-key",
    })

    expect(() => getEmailEnv()).toThrow("EMAILJS_PUBLIC_KEY")
  })

  it("does not accept Resend credentials in place of EmailJS configuration", () => {
    setIsolatedEnv({
      RESEND_API_KEY: "re-test-key",
      RESEND_FROM_EMAIL: "docs@example.com",
    })

    expect(() => getEmailEnv()).toThrow("EMAILJS_SERVICE_ID")
  })

  it.each(["999", "60001", "1.5", "not-a-number"])(
    "rejects invalid email timeout %s",
    (timeoutMs: string) => {
      setIsolatedEnv({
        EMAILJS_SERVICE_ID: "service_buy2dql",
        EMAILJS_TEMPLATE_ID: "template_d6o6c8p",
        EMAILJS_PUBLIC_KEY: "public-test-key",
        EMAIL_TIMEOUT_MS: timeoutMs,
      })

      expect(() => getEmailEnv()).toThrow("EMAIL_TIMEOUT_MS")
    }
  )
})

describe("Upstash Redis environment validation", () => {
  it("reports unconfigured when the URL or token is missing", () => {
    setIsolatedEnv({ UPSTASH_REDIS_REST_URL: "https://example.upstash.io" })

    expect(isUpstashRedisEnvConfigured()).toBe(false)
    expect(() => getUpstashRedisEnv()).toThrow("UPSTASH_REDIS_REST_TOKEN")
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
  it.each([undefined, "   "])("treats DSN %j as unconfigured", (dsn) => {
    setIsolatedEnv({ SENTRY_DSN: dsn, SENTRY_TRACES_SAMPLE_RATE: "0.5" })

    expect(getSentryEnv()).toBeNull()
  })

  it("reports a Vercel production deploy as production when no environment is set", () => {
    setIsolatedEnv({
      SENTRY_DSN: "https://key@o0.ingest.sentry.io/1",
      VERCEL_ENV: "production",
    })

    expect(getSentryEnv()?.SENTRY_ENVIRONMENT).toBe("production")
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
  it("requires an explicit model for providers without a registered default", () => {
    setIsolatedEnv({
      AI_PROVIDER: "future-provider",
    })

    expect(() => getAiEnv()).toThrow("AI_MODEL")
  })

  it("reads only the configured provider's key, and names a missing one", () => {
    setIsolatedEnv({
      GEMINI_API_KEY: " gemini-test-key ",
    })

    expect(getAiProviderKey("gemini")).toBe("gemini-test-key")
    expect(() => getAiProviderKey("openrouter")).toThrow("OPENROUTER_API_KEY")
  })

  it.each(["999", "120001", "1.5", "not-a-number"])(
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
