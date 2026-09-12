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
  it("duplicates from both the canvas and inspector and selects the new block", async () => {
    await renderStudio()
    const select = document.querySelector<HTMLButtonElement>('[aria-label="Edit heading"]')!
    await click(select)
    await click(document.querySelector<HTMLButtonElement>('[aria-label="Duplicate block"]')!)
    let blocks = JSON.parse(document.querySelector<HTMLInputElement>('input[name="content"]')!.value).blocks
    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toMatchObject({ text: "Engagement details", type: "heading" })
    expect(blocks[1].id).not.toBe(HEADING_ID)
    expect(document.activeElement?.closest("[data-template-block-id]")?.getAttribute("data-template-block-id"))
      .toBe(blocks[1].id)
    expect(document.querySelector('[aria-label="Edit heading"][aria-pressed="true"]')).not.toBeNull()

    await click(document.querySelector<HTMLButtonElement>('[aria-label="Duplicate Heading"]')!)
    blocks = JSON.parse(document.querySelector<HTMLInputElement>('input[name="content"]')!.value).blocks
    expect(blocks).toHaveLength(3)
    expect(new Set(blocks.map((block: { id: string }) => block.id)).size).toBe(3)
    expect(blocks[0].id).toBe(HEADING_ID)
    await click(getButton("Preview"))
    expect(document.querySelector('[aria-label="Duplicate block"]')).toBeNull()
  })

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

  it("updates paper contrast without blocking save or changing preview ink", async () => {
    await renderStudio()
    await click(getButton("Brand"))

    const status = document.getElementById("branding-paper-contrast")
    expect(status?.getAttribute("role")).toBe("status")
    expect(status?.textContent).toContain("Primary")
    expect(status?.textContent).not.toContain("Low paper contrast")

    await changeColor("branding-primary-color", "#ffffff")
    await changeColor("branding-accent-color", "#eeeeee")
    expect(status?.textContent).toContain("Primary 1.00:1")
    expect(status?.textContent).toContain("Accent 1.16:1")
    expect(status?.textContent).toContain("Low paper contrast")
    expect(status?.textContent).toContain("You can still save")
    expect(getButton("Save draft").disabled).toBe(false)
    expect(document.getElementById("branding-primary-color")?.getAttribute("aria-describedby"))
      .toBe("branding-paper-contrast")

    const content = document.querySelector<HTMLInputElement>('input[name="content"]')
    expect(JSON.parse(content!.value).branding).toMatchObject({
      primaryColor: "#ffffff",
      accentColor: "#eeeeee",
    })
    await click(getButton("Preview"))
    expect(requireCanvas().style.getPropertyValue("--template-primary")).toBe("#ffffff")
    expect(requireCanvas().style.getPropertyValue("--template-accent")).toBe("#eeeeee")

    await click(getButton("Build"))
    await click(getButton("Brand"))
    await changeColor("branding-primary-color", "#000000")
    await changeColor("branding-accent-color", "#000000")
    expect(document.getElementById("branding-paper-contrast")?.textContent)
      .not.toContain("Low paper contrast")
  })
})

async function changeColor(id: string, value: string): Promise<void> {
  const input = document.getElementById(id)
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing color ${id}`)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

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
