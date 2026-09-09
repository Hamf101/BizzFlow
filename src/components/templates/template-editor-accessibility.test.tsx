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

describe("Template Studio accessibility", () => {
  it("names the mode and tool switchers to assistive technology", async () => {
    // `aria-label` on a role-less div is dropped by accessibility APIs, so both
    // switchers previously announced nothing at all.
    await renderStudio()

    expect(requireGroup("Studio mode")).toBeInstanceOf(HTMLElement)
    expect(requireGroup("Studio tools")).toBeInstanceOf(HTMLElement)
  })

  it("announces each switcher as one choice out of a set", async () => {
    await renderStudio()

    const modes = [...requireGroup("Studio mode").querySelectorAll("button")]

    expect(modes).toHaveLength(3)
    expect(modes.map((button) => button.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false"
    ])

    await click(getButton("Preview"))

    expect(
      [...requireGroup("Studio mode").querySelectorAll("button")].map((button) =>
        button.getAttribute("aria-checked")
      )
    ).toEqual(["false", "true", "false"])
  })

  it("carries the critical count in the Checks control's own name", async () => {
    // The count previously lived in an aria-label on a bare span, where it is
    // ignored: a screen reader announced the digit and nothing else.
    await renderStudio()

    const checks = requireGroup("Studio tools").querySelectorAll("button")[2]

    if (!(checks instanceof HTMLButtonElement)) {
      throw new Error("Expected the Checks control.")
    }

    expect(checks.getAttribute("aria-label")).toBe("Checks, 1 critical")

    const badge = checks.querySelector("[data-critical-count]")
    expect(badge?.getAttribute("aria-hidden")).toBe("true")
    expect(badge?.textContent).toBe("1")
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

/** A switcher is one choice out of a set, which is what radiogroup conveys. */
function requireGroup(name: string): HTMLElement {
  const group = document.querySelector(
    `[role="radiogroup"][aria-label="${name}"]`
  )

  if (!(group instanceof HTMLElement)) {
    throw new Error(`Expected a named radiogroup "${name}".`)
  }

  return group
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
  return {
    id: TEMPLATE_ID,
    organizationId: ORGANIZATION_ID,
    title: "Client agreement",
    description: "Standard engagement terms",
    category: "Agreements",
    status: "draft",
    revision: 1,
    content: {
      ...createBlankTemplateContent(),
      // A blank heading is one critical quality issue, which is what puts the
      // count badge on the Checks control.
      blocks: [
        { id: HEADING_ID, type: "heading", text: "", level: 2, alignment: "left" }
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
