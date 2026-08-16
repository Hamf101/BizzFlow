import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { TemplatePreview } from "@/components/templates/template-preview"
import {
  createTemplateRenderPlan,
  shouldRenderTemplateFooter,
  shouldRenderTemplateHeader
} from "@/services/templates/template-render-plan"
import {
  createBlankTemplateContent,
  type TemplateContentV2,
  type TemplateContentV3
} from "@/types/template"
import { insertTemplateBlock } from "@/types/template-structure"

const SOURCE_ID = "10000000-0000-4000-8000-000000000001"
const CONDITIONAL_ID = "10000000-0000-4000-8000-000000000002"
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
      contentWidthPoints: 896,
      contentHeightPoints: 500
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
      "sm:grid-cols-[repeat(2,minmax(0,1fr))]"
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

  it("keeps selection and toolbar buttons as sibling controls", () => {
    const plan = createTemplateRenderPlan({
      title: "Approval",
      content: createStructuredContent(),
      mode: "build"
    })
    const markup = renderToStaticMarkup(
      createElement(TemplatePreview, {
        renderPlan: plan,
        onBlockSelect: (): void => undefined,
        onDeleteBlock: (): void => undefined,
        onMoveBlock: (): void => undefined,
        selectedBlockId: SOURCE_ID
      })
    )
    const selectionStart = markup.indexOf('aria-label="Edit checkbox field"')
    const selectionEnd = markup.indexOf("</button>", selectionStart)
    const toolbarStart = markup.indexOf('aria-label="Edit block settings"')

    expect(selectionStart).toBeGreaterThanOrEqual(0)
    expect(selectionEnd).toBeGreaterThan(selectionStart)
    expect(toolbarStart).toBeGreaterThan(selectionEnd)
    expect(markup).not.toContain('role="button"')
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
