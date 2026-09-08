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
  it("renders working surfaces with theme ink rather than brand ink", () => {
    // Brand colours are chosen for printed paper. On a themed surface they
    // cannot be trusted: in dark mode the paper moves and the ink does not.
    const markup = renderToStaticMarkup(
      createElement(GeneratedDocumentContent, {
        answers: {},
        content: createBrandedContent(),
        editable: false,
        title: "Client agreement"
      })
    )

    expect(markup).toContain("--document-primary:var(--foreground)")
    expect(markup).toContain("--document-accent:var(--primary)")
    expect(markup).not.toContain(BRAND_PRIMARY)
    expect(markup).not.toContain(BRAND_ACCENT)
  })

  it("renders the template canvas with theme ink by default", () => {
    const markup = renderToStaticMarkup(
      createElement(TemplatePreview, { renderPlan: createBrandedPlan() })
    )

    expect(markup).toContain('data-document-surface="screen"')
    expect(markup).toContain("--template-primary:var(--foreground)")
    expect(markup).not.toContain(BRAND_PRIMARY)
  })

  it("reproduces the real page on the paper surface", () => {
    // Preview is the one place an author asks to see the finished document,
    // so it is the one place brand ink belongs on screen.
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
