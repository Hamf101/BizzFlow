import { describe, expect, it } from "vitest"

import vercelConfig from "./vercel.json"

describe("Vercel runtime configuration", () => {
  it("runs server-rendered pages close to the Supabase database", () => {
    const config = vercelConfig as { regions?: string[] }

    expect(config.regions).toEqual(["cle1"])
  })
})
