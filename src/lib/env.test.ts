import { afterEach, describe, expect, it } from "vitest"

import { getAdminSupabaseEnv } from "./env"

const originalEnv = { ...process.env }

describe("Supabase environment validation", () => {
  afterEach(() => {
    process.env = { ...originalEnv }
  })

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
