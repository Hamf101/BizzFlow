import { describe, expect, it } from "vitest"

import { getPaperContrastRatio } from "@/lib/document-surface"

describe("paper contrast", () => {
  it.each([
    ["#000000", 21],
    ["#ffffff", 1],
    ["#FF0000", 3.9985],
    ["#00ff00", 1.3722],
    ["#0000ff", 8.5925],
    ["#0a0a0a", 19.7981],
  ])("measures %s against white paper", (color, expected) => {
    expect(getPaperContrastRatio(color)).toBeCloseTo(expected, 3)
  })

  it("keeps full precision at the normal-text warning boundary", () => {
    expect(getPaperContrastRatio("#767676")).toBeGreaterThan(4.5)
    expect(getPaperContrastRatio("#777777")).toBeLessThan(4.5)
  })
})
