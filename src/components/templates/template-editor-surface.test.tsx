// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { TemplateEditor } from "@/components/templates/template-editor"
import {
  createBlankTemplateContent,
  type DocumentTemplate
} from "@/types/template"

const TEMPLATE_ID = "10000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000002"
const HEADING_ID = "20000000-0000-4000-8000-000000000001"
const BRAND_PRIMARY = "#1d4ed8"

const mountedRoots: Root[] = []

beforeAll(() => {
  ;(
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean
    }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
  window.localStorage.clear()
})

describe("Template Studio surfaces", () => {
  it("builds against the theme rather than against brand ink", async () => {
    await renderStudio()

    const canvas = requireCanvas()
    expect(canvas.getAttribute("data-document-surface")).toBe("screen")
    expect(canvas.style.getPropertyValue("--template-primary")).toBe(
      "var(--foreground)"
    )
  })

  it("shows the real page with brand ink in Preview", async () => {
    await renderStudio()

    await click(getButton("Preview"))

    const canvas = requireCanvas()
    expect(canvas.getAttribute("data-document-surface")).toBe("paper")
    expect(canvas.style.getPropertyValue("--template-primary")).toBe(
      BRAND_PRIMARY
    )
  })

  it("returns to the theme surface when the author resumes editing", async () => {
    await renderStudio()

    await click(getButton("Preview"))
    await click(getButton("Build"))

    expect(requireCanvas().getAttribute("data-document-surface")).toBe("screen")
  })
})

async function renderStudio(): Promise<void> {
  const container = document.createElement("div")
  document.body.append(container)

  const root = createRoot(container)
  mountedRoots.push(root)

  await act(async () => {
    root.render(
      <TemplateEditor
        archiveAction={vi.fn()}
        initialFlowMessages={[]}
        publishAction={vi.fn()}
        saveAction={vi.fn()}
        template={createTemplate()}
      />
    )
  })

  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

function requireCanvas(): HTMLElement {
  const canvas = document.querySelector('[aria-label="Template preview"]')

  if (!(canvas instanceof HTMLElement)) {
    throw new Error("Expected the template canvas.")
  }

  return canvas
}

function getButton(name: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name
  )

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected a button named "${name}".`)
  }

  return button
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

function createTemplate(): DocumentTemplate {
  const blank = createBlankTemplateContent()

  return {
    id: TEMPLATE_ID,
    organizationId: ORGANIZATION_ID,
    title: "Client agreement",
    description: "Standard engagement terms",
    category: "Agreements",
    status: "draft",
    revision: 1,
    content: {
      ...blank,
      branding: { ...blank.branding, primaryColor: BRAND_PRIMARY },
      blocks: [
        {
          id: HEADING_ID,
          type: "heading",
          text: "Engagement details",
          level: 2,
          alignment: "left"
        }
      ]
    },
    createdBy: null,
    updatedBy: null,
    publishedBy: null,
    archivedBy: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
    publishedAt: null,
    archivedAt: null
  }
}
