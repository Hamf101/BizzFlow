import { afterEach, describe, expect, it } from "vitest"

import {
  getAdminSupabaseEnv,
  getAppUrlEnv,
  getEmailJsEnv,
  getFileUploadPolicyEnv,
  getGeminiEnv,
  getR2Env,
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

describe("EmailJS environment validation", () => {
  it("defaults the request timeout to ten seconds", () => {
    setIsolatedEnv({
      EMAILJS_SERVICE_ID: "service_o0h0qnp",
      EMAILJS_TEMPLATE_ID: "template_notifications",
      EMAILJS_PUBLIC_KEY: "public-test-key",
    })

    expect(getEmailJsEnv()).toEqual({
      EMAILJS_SERVICE_ID: "service_o0h0qnp",
      EMAILJS_TEMPLATE_ID: "template_notifications",
      EMAILJS_PUBLIC_KEY: "public-test-key",
      EMAILJS_TIMEOUT_MS: 10000,
    })
  })

  it.each(["999", "60001", "1.5", "not-a-number"])(
    "rejects invalid EmailJS timeout %s",
    (timeoutMs: string) => {
      setIsolatedEnv({
        EMAILJS_SERVICE_ID: "service_o0h0qnp",
        EMAILJS_TEMPLATE_ID: "template_notifications",
        EMAILJS_PUBLIC_KEY: "public-test-key",
        EMAILJS_TIMEOUT_MS: timeoutMs,
      })

      expect(() => getEmailJsEnv()).toThrow("EMAILJS_TIMEOUT_MS")
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

describe("Gemini environment validation", () => {
  it("uses a stable model and timeout by default", () => {
    setIsolatedEnv({
      GEMINI_API_KEY: "gemini-test-key",
    })

    expect(getGeminiEnv()).toEqual({
      GEMINI_API_KEY: "gemini-test-key",
      GEMINI_MODEL: "gemini-3.6-flash",
      GEMINI_TIMEOUT_MS: 30000,
    })
  })

  it.each(["999", "60001", "1.5", "not-a-number"])(
    "rejects invalid Gemini timeout %s",
    (timeoutMs: string) => {
      setIsolatedEnv({
        GEMINI_API_KEY: "gemini-test-key",
        GEMINI_TIMEOUT_MS: timeoutMs,
      })

      expect(() => getGeminiEnv()).toThrow("GEMINI_TIMEOUT_MS")
    }
  )
})
