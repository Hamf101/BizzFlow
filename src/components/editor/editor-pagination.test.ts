import { describe, expect, it } from "vitest"

import { paginate, type PageFrame } from "@/components/editor/editor-pagination"

// Pages 1000px tall with 100px margins and a 40px gap: 800px of content each,
// starting at 100, 1140, 2180...
const frame: PageFrame = {
  gap: 40,
  height: 1000,
  marginBottom: () => 100,
  marginTop: () => 100,
}

const unit = (id: string, height: number, rules: { pageBreakBefore?: boolean; keepWithNext?: boolean } = {}) => ({
  height,
  id,
  keepWithNext: rules.keepWithNext ?? false,
  pageBreakBefore: rules.pageBreakBefore ?? false,
})

describe("paginate", () => {
  it("keeps what fits on the first page and starts the next page where one runs out", () => {
    const result = paginate([unit("a", 500), unit("b", 250), unit("c", 100)], frame)

    // b ends at 850 of 900; c would end at 950, so it starts page 2 at 1140.
    expect(result.pageCount).toBe(2)
    expect(result.pages).toEqual({ a: 0, b: 0, c: 1 })
    expect(result.spacers).toEqual({ c: 1140 - 850 })
  })

  it("starts a page at a page break, and keeps a heading with the line after it", () => {
    const broken = paginate([unit("a", 100), unit("b", 100, { pageBreakBefore: true })], frame)

    expect(broken.pageCount).toBe(2)
    expect(broken.spacers).toEqual({ b: 1140 - 200 })

    const kept = paginate([unit("a", 700), unit("heading", 50, { keepWithNext: true }), unit("line", 100)], frame)

    expect(kept.spacers).toEqual({ heading: 1140 - 800 })
  })

  it("lets a block taller than a page run on, and carries on after it", () => {
    const result = paginate([unit("a", 100), unit("tall", 1500), unit("b", 100)], frame)

    // The tall block starts page 2 at 1140 and ends at 2640, inside page 3's
    // content (2180 to 2980), so b follows it there.
    expect(result.spacers).toEqual({ tall: 1140 - 200 })
    expect(result.pageCount).toBe(3)
  })

  it("draws one page for an empty document", () => {
    expect(paginate([], frame)).toEqual({ pageCount: 1, pages: {}, spacers: {} })
  })
})
