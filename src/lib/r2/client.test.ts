import { describe, expect, it, vi } from "vitest"

import { createR2Client } from "./client"

const ENV = vi.hoisted(() => ({
  CLOUDFLARE_R2_ACCESS_KEY_ID: "key",
  CLOUDFLARE_R2_BUCKET: "bucket",
  CLOUDFLARE_R2_ENDPOINT: "https://r2.example",
  CLOUDFLARE_R2_REGION: "auto",
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: "secret",
}))
vi.mock("@/lib/env", () => ({ getR2Env: vi.fn(() => ENV) }))

describe("createR2Client", () => {
  it("reuses one client, and its connections, across calls; given settings get their own", () => {
    expect(createR2Client()).toBe(createR2Client())
    expect(createR2Client(ENV as never)).not.toBe(createR2Client())
  })
})
