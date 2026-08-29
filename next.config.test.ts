import { describe, expect, it } from "vitest"

import nextConfig from "./next.config"

describe("Next.js navigation configuration", () => {
  it("does not promote every visible dynamic link to a full route prefetch", () => {
    if (!nextConfig || typeof nextConfig !== "object") {
      throw new TypeError("Expected the Next.js configuration to be an object.")
    }

    expect(nextConfig.experimental?.staleTimes?.dynamic).toBeUndefined()
    expect(nextConfig.experimental?.dynamicOnHover).toBeUndefined()
  })
})
