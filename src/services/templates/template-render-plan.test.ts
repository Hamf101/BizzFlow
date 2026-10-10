import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { TemplatePreview } from "@/components/templates/template-preview"
import {
  createTemplateRenderPlan,
  resizeTemplateLayout,
  resolvePageGeometry,
  shouldRenderTemplateFooter,
  shouldRenderTemplateHeader
} from "@/services/templates/template-render-plan"
import {
  createBlankTemplateContent,
  templateContentV3Schema,
  templateLayoutSchema,
  type TemplateContentV2,
  type TemplateContentV3
} from "@/types/template"
import { insertTemplateBlock } from "@/types/template-structure"

const SOURCE_ID = "10000000-0000-4000-8000-000000000001"
const CONDITIONAL_ID = "10000000-0000-4000-8000-000000000002"
const SECOND_CONDITIONAL_ID = "10000000-0000-4000-8000-000000000009"
const FINAL_ID = "10000000-0000-4000-8000-000000000003"
const SECTION_ID = "10000000-0000-4000-8000-000000000011"
const GROUP_ID = "10000000-0000-4000-8000-000000000021"

describe("template render plan", () => {
  it("resolves custom landscape geometry and repeated-region policies", () => {
    const content = createStructuredContent()
    content.layout = {
      ...content.layout,
      pageSize: "Legal",
      orientation: "landscape",
      marginPreset: "generous",
      printedTitle: { mode: "custom", text: "Client authorization" },
      headerPolicy: "all_pages",
      footerPolicy: "first_page"
    }

    const plan = createTemplateRenderPlan({
      title: "Metadata title",
      content,
      mode: "preview"
    })

    expect(plan.title).toBe("Client authorization")
    expect(plan.geometry).toEqual({
      widthPoints: 1008,
      heightPoints: 612,
      marginPoints: 56,
      margins: { top: 56, right: 56, bottom: 56, left: 56 },
      contentWidthPoints: 896,
      contentHeightPoints: 500,
      scale: 1
    })
    expect(shouldRenderTemplateHeader(plan.layout, 2)).toBe(true)
    expect(shouldRenderTemplateFooter(plan.layout, 1)).toBe(true)
    expect(shouldRenderTemplateFooter(plan.layout, 2)).toBe(false)
  })

  it("keeps conditional fields selectable in Build and filters final output", () => {
    const content = createStructuredContent()
    const buildPlan = createTemplateRenderPlan({
      title: "Approval",
      content,
      mode: "build"
    })
    const hiddenPlan = createTemplateRenderPlan({
      title: "Approval",
      content,
      answers: { include_details: false },
      mode: "final"
    })
    const visiblePlan = createTemplateRenderPlan({
      title: "Approval",
      content,
      answers: { include_details: true },
      mode: "test"
    })

    expect(buildPlan.blocks.map(({ block }) => block.id)).toEqual([
      SOURCE_ID,
      CONDITIONAL_ID,
      FINAL_ID
    ])
    expect(hiddenPlan.blocks.map(({ block }) => block.id)).toEqual([
      SOURCE_ID,
      FINAL_ID
    ])
    expect(visiblePlan.blocks.map(({ block }) => block.id)).toEqual([
      SOURCE_ID,
      CONDITIONAL_ID,
      FINAL_ID
    ])
  })

  it("keeps every branch on a blank form, cueing each branch once by its rule", () => {
    const structured = createStructuredContent()
    const content = insertTemplateBlock(structured, CONDITIONAL_ID, {
      id: SECOND_CONDITIONAL_ID,
      type: "paragraph",
      text: "More details.",
      alignment: "left",
      visibleWhen: { sourceBlockId: SOURCE_ID, operator: "equals", value: true }
    })
    const cues = (mode: "blank" | "final") =>
      createTemplateRenderPlan({ title: "Approval", content, answers: { include_details: false }, mode }).blocks.map(
        ({ block, cue }) => [block.id, cue]
      )

    expect(cues("blank")).toEqual([
      [SOURCE_ID, null],
      [CONDITIONAL_ID, "If Include details is ticked:"],
      [SECOND_CONDITIONAL_ID, null],
      [FINAL_ID, null]
    ])
    expect(cues("final")).toEqual([
      [SOURCE_ID, null],
      [FINAL_ID, null]
    ])
    expect(
      renderToStaticMarkup(
        createElement(TemplatePreview, {
          renderPlan: createTemplateRenderPlan({ title: "Approval", content, mode: "blank" })
        })
      )
    ).toContain("If Include details is ticked:")
  })

  it("decorates blocks from one canonical order without duplicating structure", () => {
    const plan = createTemplateRenderPlan({
      title: "Approval",
      content: createStructuredContent(),
      answers: { include_details: true },
      mode: "test"
    })

    expect(plan.sections).toHaveLength(1)
    expect(plan.sections[0]).toMatchObject({
      id: SECTION_ID,
      label: "Approval details",
      pageBreakBefore: true,
      keepTogether: true
    })
    expect(plan.blocks[0]).toMatchObject({
      canonicalIndex: 0,
      sectionId: SECTION_ID,
      fieldGroupId: GROUP_ID,
      fieldGroupColumns: 2,
      pageBreakBefore: true,
      keepTogether: true,
      keepWithNext: true
    })
    expect(plan.blocks[1]).toMatchObject({
      canonicalIndex: 1,
      sectionId: SECTION_ID,
      fieldGroupId: GROUP_ID,
      fieldGroupColumns: 2
    })
  })

  it("projects legacy snapshots with stable A4 defaults without rewriting them", () => {
    const content: TemplateContentV2 = {
      schemaVersion: 2,
      branding: createBlankTemplateContent().branding,
      blocks: [
        {
          id: FINAL_ID,
          type: "paragraph",
          text: "Legacy content",
          alignment: "left"
        }
      ]
    }
    const plan = createTemplateRenderPlan({
      title: " Legacy title ",
      content,
      mode: "final"
    })

    expect(content.schemaVersion).toBe(2)
    expect(plan.title).toBe("Legacy title")
    expect(plan.layout).toMatchObject({
      pageSize: "A4",
      orientation: "portrait",
      marginPreset: "standard"
    })
    expect(plan.geometry).toMatchObject({
      widthPoints: 595.28,
      heightPoints: 841.89,
      marginPoints: 40
    })
    expect(plan.sections[0]).toMatchObject({ id: null, label: null })
  })

  it("projects sectionless version-three content as one implicit section", () => {
    const blankContent = createBlankTemplateContent()
    const content: TemplateContentV3 = {
      ...blankContent,
      blocks: [
        {
          id: FINAL_ID,
          type: "paragraph",
          text: "Implicit section content",
          alignment: "left"
        }
      ],
      sections: [],
      blockRules: [
        {
          blockId: FINAL_ID,
          pageBreakBefore: true,
          keepWithNext: false
        }
      ]
    }
    const plan = createTemplateRenderPlan({
      title: "Sectionless template",
      content,
      mode: "preview"
    })

    expect(plan.sections).toHaveLength(1)
    expect(plan.sections[0]).toMatchObject({
      id: null,
      label: null,
      blocks: [plan.blocks[0]]
    })
    expect(plan.blocks[0]?.pageBreakBefore).toBe(true)
  })

  it("keeps what comes before the first section, printed without a section title", () => {
    const content: TemplateContentV3 = {
      ...createBlankTemplateContent(),
      blocks: [
        { id: SOURCE_ID, type: "paragraph", text: "Opening words", alignment: "left" },
        { id: FINAL_ID, type: "paragraph", text: "Signed here", alignment: "left" }
      ],
      sections: [
        { id: SECTION_ID, label: "Signatures", startBlockId: FINAL_ID, pageBreakBefore: true, keepTogether: true }
      ]
    }
    const plan = createTemplateRenderPlan({ title: "Agreement", content, mode: "preview" })
    const markup = renderToStaticMarkup(createElement(TemplatePreview, { renderPlan: plan }))

    expect(
      plan.sections.map((section) => [section.id, section.label, section.blocks.map(({ block }) => block.id)])
    ).toEqual([
      [null, null, [SOURCE_ID]],
      [SECTION_ID, "Signatures", [FINAL_ID]]
    ])
    expect(plan.blocks.map((block) => [block.sectionId, block.pageBreakBefore, block.keepTogether])).toEqual([
      [null, false, false],
      [SECTION_ID, true, true]
    ])
    expect(markup).toContain("Opening words")
    expect(markup.match(/data-template-section-label="true"/g)).toHaveLength(1)
  })

  it("starts a section's new page at its first block that shows, when a hidden field opens it", () => {
    const content: TemplateContentV3 = {
      ...createStructuredContent(),
      sections: [
        { id: SECTION_ID, label: "Decision", startBlockId: SOURCE_ID, pageBreakBefore: false, keepTogether: false },
        { id: GROUP_ID, label: "Details", startBlockId: CONDITIONAL_ID, pageBreakBefore: true, keepTogether: false }
      ],
      fieldGroups: [],
      blockRules: []
    }
    const plan = createTemplateRenderPlan({
      title: "Approval",
      content,
      answers: { include_details: false },
      mode: "final"
    })

    expect(plan.blocks.map((block) => [block.block.id, block.sectionLabel, block.pageBreakBefore])).toEqual([
      [SOURCE_ID, "Decision", false],
      [FINAL_ID, "Details", true]
    ])
  })

  it("renders exactly one resolved printed title and only planned web blocks", () => {
    const content = createStructuredContent()
    content.layout = {
      ...content.layout,
      printedTitle: { mode: "custom", text: "Printable approval" }
    }
    const plan = createTemplateRenderPlan({
      title: "Metadata approval",
      content,
      answers: { include_details: false },
      mode: "preview"
    })
    const markup = renderToStaticMarkup(
      createElement(TemplatePreview, { renderPlan: plan })
    )

    expect(markup.match(/data-template-printed-title="true"/g)).toHaveLength(1)
    expect(markup).toContain("Printable approval")
    expect(markup).toContain("Include details")
    expect(markup).toContain("Thank you.")
    expect(markup).not.toContain("Explain the approval details.")
  })

  it("preserves section, field-group, and pagination structure in preview markup", () => {
    const plan = createTemplateRenderPlan({
      title: "Approval",
      content: createStructuredContent(),
      answers: { include_details: true },
      mode: "preview"
    })
    const markup = renderToStaticMarkup(
      createElement(TemplatePreview, { renderPlan: plan })
    )

    expect(markup).toContain(`data-template-section-id="${SECTION_ID}"`)
    expect(markup).toContain("data-template-section-label=\"true\"")
    expect(markup).toContain("Approval details")
    expect(markup).toContain(`data-template-field-group-id="${GROUP_ID}"`)
    expect(markup).toContain("data-template-field-group-columns=\"2\"")
    expect(markup).toContain("data-template-field-group-label=\"true\"")
    expect(markup).toContain("Decision")
    expect(markup).toContain(
      "--row-columns:repeat(2, minmax(0, 1fr))"
    )
    expect(markup).toContain("break-before:page")
    expect(markup).toContain("break-inside:avoid-page")
    expect(markup).toContain("break-after:avoid-page")
  })

  it("reflects layout policies in the web preview", () => {
    const content = createStructuredContent()
    content.branding = {
      ...content.branding,
      organizationName: "Hidden preview brand"
    }
    content.layout = {
      ...content.layout,
      orientation: "landscape",
      marginPreset: "generous",
      density: "compact",
      headerPolicy: "none",
      footerPolicy: "all_pages",
      pageNumbering: "page_x_of_y"
    }
    const plan = createTemplateRenderPlan({
      title: "Landscape approval",
      content,
      mode: "preview"
    })
    const markup = renderToStaticMarkup(
      createElement(TemplatePreview, { renderPlan: plan })
    )

    expect(markup).toContain("max-w-[64rem]")
    expect(markup).toContain("aspect-ratio:841.89 / 595.28")
    expect(markup).toContain("margin:6.651700340899643%")
    expect(markup).toContain("py-4")
    expect(markup).toContain("data-template-header-policy=\"none\"")
    expect(markup).toContain("data-template-footer-policy=\"all_pages\"")
    expect(markup).toContain("data-template-page-footer=\"true\"")
    expect(markup).toContain("Page 1 of 1")
    expect(markup).not.toContain("data-template-brand-header=\"true\"")
    expect(markup).not.toContain("Hidden preview brand")
  })

  it("shows a neutral prompt for an unanswered dropdown", () => {
    const content = createBlankTemplateContent()
    content.blocks = [
      {
        id: SOURCE_ID,
        type: "dropdown_field",
        fieldKey: "request_type",
        label: "Request type",
        required: false,
        helpText: null,
        placeholder: null,
        options: ["Standard", "Expedited"]
      }
    ]
    const plan = createTemplateRenderPlan({
      title: "Request",
      content,
      mode: "preview"
    })
    const markup = renderToStaticMarkup(
      createElement(TemplatePreview, { renderPlan: plan })
    )

    expect(markup).toContain("Select an option")
    expect(markup).not.toContain("Standard")
  })

  it("keeps content in proportion on new paper, and at its size when the page only turns", () => {
    const content = createStructuredContent()
    const plan = (layout: TemplateContentV3["layout"]) =>
      createTemplateRenderPlan({ title: "Lease", content: { ...content, layout }, mode: "final" })
    const a4 = plan(content.layout)
    const a3Layout = resizeTemplateLayout(content.layout, { pageSize: "A3" })
    const a3 = plan(a3Layout)

    // The design page is unchanged, so every line and page break stays put and
    // the whole page prints larger.
    expect(a3.geometry.scale).toBeCloseTo(841.89 / 595.28, 3)
    expect(a3.geometry.widthPoints).toBeCloseTo(a4.geometry.widthPoints, 0)
    expect(a3.geometry.heightPoints).toBeCloseTo(a4.geometry.heightPoints, 0)
    expect(a3.geometry.marginPoints).toBe(a4.geometry.marginPoints)

    // Turning the page keeps text at its size, and going back undoes the scale.
    expect(plan(resizeTemplateLayout(content.layout, { orientation: "landscape" })).geometry.scale).toBe(1)
    expect(resizeTemplateLayout(a3Layout, { pageSize: "A4" })).toEqual(content.layout)
  })

  it("sets each margin on its own side, and fits the writing between them", () => {
    const page = resolvePageGeometry(templateLayoutSchema.parse({ margins: { bottom: 36, left: 72, right: 48, top: 24 } }))

    expect(page.margins).toEqual({ bottom: 36, left: 72, right: 48, top: 24 })
    expect(page.contentWidthPoints).toBeCloseTo(page.widthPoints - 120)
    expect(page.contentHeightPoints).toBeCloseTo(page.heightPoints - 60)
    expect(templateLayoutSchema.safeParse({ margins: { bottom: 20, left: 20, right: 20, top: -1 } }).success).toBe(false)
  })

  it("prints no title when the layout asks for none", () => {
    const content = createStructuredContent()
    content.layout = { ...content.layout, printedTitle: { mode: "none" } }

    expect(createTemplateRenderPlan({ title: "Lease", content, mode: "final" }).title).toBe("")
  })

  it("rejects invalid one-based page numbers by omitting repeated regions", () => {
    const layout = createBlankTemplateContent().layout

    expect(shouldRenderTemplateHeader(layout, 0)).toBe(false)
    expect(shouldRenderTemplateFooter(layout, 1.5)).toBe(false)
  })
})

function createStructuredContent(): TemplateContentV3 {
  let content = createBlankTemplateContent()

  content = insertTemplateBlock(content, null, {
    id: SOURCE_ID,
    type: "checkbox_field",
    fieldKey: "include_details",
    label: "Include details",
    required: false,
    helpText: null,
    checkedByDefault: false
  })
  content = insertTemplateBlock(content, SOURCE_ID, {
    id: CONDITIONAL_ID,
    type: "text_field",
    fieldKey: "details",
    label: "Details",
    required: true,
    helpText: "Explain the approval details.",
    placeholder: null,
    multiline: true,
    visibleWhen: {
      sourceBlockId: SOURCE_ID,
      operator: "equals",
      value: true
    }
  })
  content = insertTemplateBlock(content, CONDITIONAL_ID, {
    id: FINAL_ID,
    type: "paragraph",
    text: "Thank you.",
    alignment: "left"
  })

  return {
    ...content,
    sections: [
      {
        id: SECTION_ID,
        label: "Approval details",
        startBlockId: SOURCE_ID,
        pageBreakBefore: true,
        keepTogether: true
      }
    ],
    fieldGroups: [
      {
        id: GROUP_ID,
        label: "Decision",
        startBlockId: SOURCE_ID,
        endBlockId: CONDITIONAL_ID,
        columns: 2,
        keepTogether: false
      }
    ],
    blockRules: [
      {
        blockId: SOURCE_ID,
        pageBreakBefore: false,
        keepWithNext: true
      }
    ]
  }
}

describe("clause numbering", () => {
  const id = (n: number): string => `30000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`
  const list = (n: number, items: number, levels?: number[]) => ({
    id: id(n),
    type: "numbered_list",
    items: Array.from({ length: items }, (_, index) => `Item ${index + 1}`),
    ...(levels ? { levels } : {}),
  })
  const numbered = (sectionNumbers: "clauses" | "numbers"): TemplateContentV3 => {
    const blank = createBlankTemplateContent()

    return templateContentV3Schema.parse({
      ...blank,
      layout: { ...blank.layout, sectionNumbers },
      blocks: [
        list(1, 2),
        { id: id(2), type: "paragraph", text: "Between the lists.", alignment: "left" },
        list(3, 7, [0, 1, 1, 2, 2, 0, 1]),
        list(4, 1),
        // A level can only go one deeper than the item above it, and a list starts at the top.
        list(5, 3, [2, 2, 1]),
      ],
      sections: [
        { id: id(11), label: "Services", startBlockId: id(1), pageBreakBefore: false, keepTogether: false },
        { id: id(12), label: "Fees", startBlockId: id(4), pageBreakBefore: false, keepTogether: false },
      ],
    }) as TemplateContentV3
  }
  const markers = (content: TemplateContentV3): Array<readonly string[] | null> =>
    createTemplateRenderPlan({ content, mode: "final", title: "Agreement" }).blocks.map((block) => block.listMarkers)

  it("numbers a section's lists on from its own number, 3.1 and 3.2, with (a) and (i) under them", () => {
    expect(markers(numbered("clauses"))).toEqual([
      ["1.1", "1.2"],
      null,
      ["1.3", "(a)", "(b)", "(i)", "(ii)", "1.4", "(a)"],
      ["2.1"],
      ["2.2", "(a)", "(b)"],
    ])
    expect(createTemplateRenderPlan({ content: numbered("clauses"), mode: "final", title: "Agreement" }).blocks[3]?.sectionNumber).toBe("2.")
  })

  it("prints the same numbers in the preview and thumbnails: each section's number, then its clauses", () => {
    const markup = renderToStaticMarkup(createElement(TemplatePreview, { renderPlan: createTemplateRenderPlan({ content: numbered("clauses"), mode: "final", title: "Agreement" }) }))

    for (const printed of [">1. Services<", ">2. Fees<", ">1.3<", ">(ii)<", ">2.2<"]) {
      expect(markup).toContain(printed)
    }
  })

  it("starts each list at 1 under other numbering, keeping the levels", () => {
    expect(markers(numbered("numbers"))).toEqual([["1.", "2."], null, ["1.", "(a)", "(b)", "(i)", "(ii)", "2.", "(a)"], ["1."], ["1.", "(a)", "(b)"]])
  })
})
