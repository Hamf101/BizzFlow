import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { GeneratedDocumentContent } from "@/components/documents/generated-document-content"
import {
  createBlankTemplateContent,
  type TemplateContentV3
} from "@/types/template"

const CONTROLLER_ID = "20000000-0000-4000-8000-000000000001"
const CONDITIONAL_ID = "20000000-0000-4000-8000-000000000002"
const CLOSING_ID = "20000000-0000-4000-8000-000000000003"
const SECTION_ID = "20000000-0000-4000-8000-000000000011"
const GROUP_ID = "20000000-0000-4000-8000-000000000021"

describe("GeneratedDocumentContent", () => {
  it("renders structured sections and two-column groups with print hints", () => {
    const content = createStructuredContent()
    content.branding = {
      ...content.branding,
      organizationName: "Northstar Operations"
    }
    content.layout = {
      ...content.layout,
      headerPolicy: "all_pages",
      footerPolicy: "all_pages",
      pageNumbering: "page_x_of_y"
    }

    const markup = renderToStaticMarkup(
      createElement(GeneratedDocumentContent, {
        answers: { include_details: true },
        content,
        editable: false,
        title: "Client approval"
      })
    )

    expect(markup.match(/data-template-printed-title="true"/g)).toHaveLength(1)
    expect(markup).toContain("Northstar Operations")
    expect(markup).toContain("data-template-brand-header=\"true\"")
    expect(markup).toContain("data-template-page-footer=\"true\"")
    expect(markup).toContain("Page 1 of 1")
    expect(markup).toContain(`data-template-section-id="${SECTION_ID}"`)
    expect(markup).toContain("Approval details")
    expect(markup).toContain(`data-template-field-group-id="${GROUP_ID}"`)
    expect(markup).toContain("data-template-field-group-columns=\"2\"")
    expect(markup).toContain("Decision")
    expect(markup).toContain(
      "sm:grid-cols-[repeat(2,minmax(0,1fr))]"
    )
    expect(markup).toContain("break-before:page")
    expect(markup).toContain("break-inside:avoid-page")
    expect(markup).toContain("break-after:avoid-page")
  })

  it("honors layout policies while retaining answer-aware visibility", () => {
    const content = createStructuredContent()
    content.branding = {
      ...content.branding,
      organizationName: "Hidden brand"
    }
    content.layout = {
      ...content.layout,
      orientation: "landscape",
      pageSize: "Legal",
      density: "comfortable",
      printedTitle: { mode: "custom", text: "Printable authorization" },
      headerPolicy: "none",
      footerPolicy: "all_pages",
      pageNumbering: "none"
    }

    const markup = renderToStaticMarkup(
      createElement(GeneratedDocumentContent, {
        answers: { include_details: false },
        content,
        editable: true,
        title: "Metadata title"
      })
    )

    expect(markup).toContain("Printable authorization")
    expect(markup).not.toContain("Metadata title")
    expect(markup).not.toContain("Hidden brand")
    expect(markup).not.toContain("Page 1 of 1")
    expect(markup).not.toContain("Explain the approval details.")
    expect(markup).toContain("data-template-orientation=\"landscape\"")
    expect(markup).toContain("data-template-page-size=\"Legal\"")
    expect(markup).toContain("data-template-density=\"comfortable\"")
    expect(markup).toContain("max-w-[68rem]")
    expect(markup).toContain("margin:3.968253968253968%")
    expect(markup).toContain("py-10")
  })
})

function createStructuredContent(): TemplateContentV3 {
  return {
    ...createBlankTemplateContent(),
    blocks: [
      {
        id: CONTROLLER_ID,
        type: "checkbox_field",
        fieldKey: "include_details",
        label: "Include details",
        required: false,
        helpText: null,
        checkedByDefault: false
      },
      {
        id: CONDITIONAL_ID,
        type: "text_field",
        fieldKey: "details",
        label: "Details",
        required: true,
        helpText: "Explain the approval details.",
        placeholder: null,
        multiline: true,
        visibleWhen: {
          sourceBlockId: CONTROLLER_ID,
          operator: "equals",
          value: true
        }
      },
      {
        id: CLOSING_ID,
        type: "paragraph",
        text: "Thank you.",
        alignment: "left"
      }
    ],
    sections: [
      {
        id: SECTION_ID,
        label: "Approval details",
        startBlockId: CONTROLLER_ID,
        pageBreakBefore: true,
        keepTogether: true
      }
    ],
    fieldGroups: [
      {
        id: GROUP_ID,
        label: "Decision",
        startBlockId: CONTROLLER_ID,
        endBlockId: CONDITIONAL_ID,
        columns: 2,
        keepTogether: true
      }
    ],
    blockRules: [
      {
        blockId: CONTROLLER_ID,
        pageBreakBefore: false,
        keepWithNext: true
      }
    ]
  }
}
