import { describe, expect, it } from "vitest"

import { createUnits, paginate, type PageFrame } from "@/components/editor/editor-pagination"
import { createTemplateRenderPlan } from "@/services/templates/template-render-plan"
import { createBlankTemplateContent, type TemplateContentV3 } from "@/types/template"

// Pages 1000px tall with 100px margins and a 40px gap: 800px of content each,
// starting at 100, 1140, 2180...
const frame: PageFrame = {
  gap: 40,
  height: 1000,
  marginBottom: () => 100,
  marginTop: () => 100,
}

const unit = (
  id: string,
  height: number,
  rules: {
    pageBreakBefore?: boolean
    keepWithNext?: boolean
    rows?: { key: string; top: number }[]
    together?: string[]
  } = {}
) => ({
  height,
  id,
  keepWithNext: rules.keepWithNext ?? false,
  pageBreakBefore: rules.pageBreakBefore ?? false,
  rows: rules.rows,
  together: rules.together,
})

// Where a block can break: a line, list item or table row starting every `step` px.
const rowsEvery = (step: number, height: number) =>
  Array.from({ length: Math.ceil(height / step) - 1 }, (_, index) => ({ key: `row-${(index + 1) * step}`, top: (index + 1) * step }))

describe("paginate", () => {
  it("keeps what fits on the first page and starts the next page where one runs out", () => {
    const result = paginate([unit("a", 500), unit("b", 250), unit("c", 100)], frame)

    // b ends at 850 of 900; c would end at 950, so it starts page 2 at 1140.
    expect(result.pageCount).toBe(2)
    expect(result.pages).toEqual({ a: 0, b: 0, c: 1 })
    expect(result.spacers).toEqual({ c: 1140 - 850 })
  })

  it("moves a run kept on one page to the next page when it will not fit, as the PDF does", () => {
    const kept = { together: ["section:signatures"] }
    const moved = paginate([unit("a", 500), unit("b", 150, kept), unit("c", 200, kept)], frame)
    // A run taller than a page stays where it is and flows on.
    const tooTall = paginate([unit("a", 500), unit("b", 450, kept), unit("c", 450, kept)], frame)

    // b and c take 350 and only 300 is left, so b starts page 2 and c follows it.
    expect(moved.pages).toEqual({ a: 0, b: 1, c: 1 })
    expect(moved.spacers).toEqual({ b: 1140 - 600 })
    expect(tooTall.pages).toEqual({ a: 0, b: 1, c: 2 })
  })

  it("starts a page at a page break, and keeps a heading with the line after it", () => {
    const broken = paginate([unit("a", 100), unit("b", 100, { pageBreakBefore: true })], frame)

    expect(broken.pageCount).toBe(2)
    expect(broken.spacers).toEqual({ b: 1140 - 200 })

    const kept = paginate([unit("a", 700), unit("heading", 50, { keepWithNext: true }), unit("line", 100)], frame)

    expect(kept.spacers).toEqual({ heading: 1140 - 800 })
  })

  it("breaks a block taller than a page at its last row that fits, and carries the rest onto a new page", () => {
    const result = paginate([unit("a", 100), unit("tall", 1500, { rows: rowsEvery(100, 1500) }), unit("b", 100)], frame)

    // The block starts right after a, at 200. Rows up to 700 fit above 900;
    // the row at 700 starts page 2 at 1140, and the last 800px end at 1940.
    expect(result.pages).toEqual({ a: 0, b: 2, tall: 0 })
    expect(result.inside).toEqual({ "row-700": 1140 - 900 })
    // b no longer fits on page 2, so a third page starts for it.
    expect(result.spacers).toEqual({ b: 2180 - 1940 })
    expect(result.pageCount).toBe(3)
  })

  it("carries a block longer than two pages across as many pages as it needs", () => {
    const result = paginate([unit("long", 2000, { rows: rowsEvery(50, 2000) })], frame)

    expect(result.inside).toEqual({ "row-800": 1140 - 900, "row-1600": 2180 - 1940 })
    expect(result.pageCount).toBe(3)
  })

  it("starts a tall block on the next page when not even its first row fits where it would begin", () => {
    const result = paginate([unit("a", 780), unit("tall", 1500, { rows: rowsEvery(100, 1500) })], frame)

    // a ends at 880; the first row would end at 980, past 900.
    expect(result.spacers).toEqual({ tall: 1140 - 880 })
    expect(result.inside).toEqual({ "row-800": 2180 - 1940 })
    expect(result.pages).toEqual({ a: 0, tall: 1 })
    expect(result.pageCount).toBe(3)
  })

  it("lets a block with nowhere to break run on, and carries on after it", () => {
    const result = paginate([unit("a", 100), unit("tall", 1500), unit("b", 100)], frame)

    // ponytail's ceiling: one table row taller than a page has no line to
    // break at. It starts page 2 at 1140 and ends at 2640, inside page 3's
    // content (2180 to 2980), so b follows it there.
    expect(result.spacers).toEqual({ tall: 1140 - 200 })
    expect(result.inside).toEqual({})
    expect(result.pageCount).toBe(3)
  })

  it("draws one page for an empty document", () => {
    expect(paginate([], frame)).toEqual({ inside: {}, pageCount: 1, pages: {}, spacers: {} })
  })
})

describe("createUnits", () => {
  const field = (id: string, label: string) =>
    ({ fieldKey: label.toLowerCase(), helpText: null, id, label, multiline: false, placeholder: null, required: false, type: "text_field" }) as const
  const ids = ["a", "b", "c", "d", "e"].map((letter) => `70000000-0000-4000-8000-00000000000${letter}`)

  it("pairs side-by-side fields a row at a time and keeps runs together by the keys the PDF uses", () => {
    const [a, b, c, d, e] = ids as [string, string, string, string, string]
    const content: TemplateContentV3 = {
      ...createBlankTemplateContent(),
      blocks: [field(a, "Name"), field(b, "Company"), field(c, "Email"), field(d, "Phone"), field(e, "Notes")],
      sections: [{ id: "s", label: "Customer", startBlockId: a, pageBreakBefore: false, keepTogether: true }],
      fieldGroups: [{ id: "g", label: "Contact", startBlockId: a, endBlockId: c, columns: 2, keepTogether: true }],
      blockRules: [{ blockId: c, pageBreakBefore: true, keepWithNext: false }],
    }
    const plan = createTemplateRenderPlan({ content, mode: "build", title: "" })

    // A field that starts a new page starts a new row, as the PDF pairs them;
    // a field alone in its row keeps its column's width.
    expect(createUnits(plan).map((unit) => [unit.blocks.map(({ block }) => block.id), unit.columns, unit.groupLabel, unit.together])).toEqual([
      [[a, b], 2, "Contact", ["section:s"]],
      [[c], 2, null, ["section:s"]],
      [[d], 1, null, ["section:s"]],
      [[e], 1, null, ["section:s"]],
    ])
  })

  it("sets up to four blocks of any kind in one row, at the row's widths", () => {
    const [a, b, c, d] = ids as [string, string, string, string]
    const content: TemplateContentV3 = {
      ...createBlankTemplateContent(),
      blocks: [field(a, "Name"), { alignment: "left", id: b, text: "or", type: "paragraph" }, field(c, "Email"), field(d, "Notes")],
      fieldGroups: [{ id: "g", label: null, startBlockId: a, endBlockId: c, columns: 3, widths: [5, 2, 5], keepTogether: false }],
    }
    const plan = createTemplateRenderPlan({ content, mode: "build", title: "" })

    expect(createUnits(plan).map((unit) => [unit.blocks.map(({ block }) => block.id), unit.columns, unit.widths])).toEqual([
      [[a, b, c], 3, [5, 2, 5]],
      [[d], 1, null],
    ])
  })
})
