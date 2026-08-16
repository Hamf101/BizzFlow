import { describe, expect, it } from "vitest"

import { createR2Client } from "@/lib/r2/client"
import type { R2Env } from "@/lib/env"

const R2_ENV: R2Env = {
  CLOUDFLARE_R2_ACCOUNT_ID: "account-id",
  CLOUDFLARE_R2_ACCESS_KEY_ID: "access-key-id",
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: "secret-access-key",
  CLOUDFLARE_R2_BUCKET_NAME: "documents",
  CLOUDFLARE_R2_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
  CLOUDFLARE_R2_REGION: "auto",
  CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS: 900,
}

describe("R2 client", () => {
  it("uses path-style addressing required by the account endpoint", () => {
    const client = createR2Client(R2_ENV)

    expect(client.config.forcePathStyle).toBe(true)
  })
})
