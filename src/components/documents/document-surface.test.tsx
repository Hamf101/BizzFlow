import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { GeneratedDocumentContent } from "@/components/documents/generated-document-content"
import { TemplatePreview } from "@/components/templates/template-preview"
import { createTemplateRenderPlan } from "@/services/templates/template-render-plan"
import { createBlankTemplateContent, type TemplateContentV3 } from "@/types/template"

const HEADING_ID = "20000000-0000-4000-8000-000000000001"
const BRAND_PRIMARY = "#252329"
const BRAND_ACCENT = "#635273"

describe("document surface", () => {
  it("shows the brand's ink where a document is worked on, lifted only as far as a dark page needs", () => {
    // The author sees the colours that will print. A dark page raises their
    // lightness to a floor the theme sets; a light page leaves them exact.
    const markup = renderToStaticMarkup(
      createElement(GeneratedDocumentContent, {
        answers: {},
        content: createBrandedContent(),
        editable: false,
        title: "Client agreement"
      })
    )

    expect(markup).toContain(`--document-primary:oklch(from ${BRAND_PRIMARY} `)
    expect(markup).toContain(`--document-accent:oklch(from ${BRAND_ACCENT} `)
  })

  it("renders the template canvas with the brand's ink by default", () => {
    const markup = renderToStaticMarkup(
      createElement(TemplatePreview, { renderPlan: createBrandedPlan() })
    )

    expect(markup).toContain('data-document-surface="screen"')
    expect(markup).toContain(`--template-primary:oklch(from ${BRAND_PRIMARY} `)
  })

  it("reproduces the real page on the paper surface", () => {
    // Paper takes the brand's colours exactly as they print, in either theme.
    const markup = renderToStaticMarkup(
      createElement(TemplatePreview, {
        renderPlan: createBrandedPlan(),
        surface: "paper"
      })
    )

    expect(markup).toContain('data-document-surface="paper"')
    expect(markup).toContain(`--template-primary:${BRAND_PRIMARY}`)
    expect(markup).toContain(`--template-accent:${BRAND_ACCENT}`)
  })

  it("keeps brand ink out of the paper surface when the author picked none", () => {
    const plan = createBrandedPlan({
      primaryColor: "#118844",
      accentColor: "#aa2266"
    })
    const markup = renderToStaticMarkup(
      createElement(TemplatePreview, { renderPlan: plan, surface: "paper" })
    )

    expect(markup).toContain("--template-primary:#118844")
    expect(markup).toContain("--template-accent:#aa2266")
  })
})

function createBrandedContent(): TemplateContentV3 {
  const blank = createBlankTemplateContent()

  return {
    ...blank,
    branding: {
      ...blank.branding,
      primaryColor: BRAND_PRIMARY,
      accentColor: BRAND_ACCENT
    },
    blocks: [
      {
        id: HEADING_ID,
        type: "heading",
        text: "Engagement details",
        level: 2,
        alignment: "left"
      }
    ]
  }
}

function createBrandedPlan(
  branding: { primaryColor?: string; accentColor?: string } = {}
): ReturnType<typeof createTemplateRenderPlan> {
  const content = createBrandedContent()

  return createTemplateRenderPlan({
    title: "Client agreement",
    content: {
      ...content,
      branding: { ...content.branding, ...branding }
    },
    mode: "preview"
  })
}
