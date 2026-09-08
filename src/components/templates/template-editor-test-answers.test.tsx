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
const NAME_BLOCK_ID = "20000000-0000-4000-8000-000000000001"

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

describe("Template Studio test answers", () => {
  it("keeps test answers when the author returns to Build and back", async () => {
    await renderStudio()

    await click(getButton("Test"))
    type(getTestInput(), "Ada Lovelace")
    expect(getTestInput().value).toBe("Ada Lovelace")

    // Noticing a wording problem mid-test and fixing it must not discard the
    // answers the author already entered.
    await click(getButton("Build"))
    await click(getButton("Test"))

    expect(getTestInput().value).toBe("Ada Lovelace")
  })

  it("keeps test answers across a Preview detour", async () => {
    await renderStudio()

    await click(getButton("Test"))
    type(getTestInput(), "Grace Hopper")

    await click(getButton("Preview"))
    await click(getButton("Test"))

    expect(getTestInput().value).toBe("Grace Hopper")
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

  // The editor defers its local-draft probe to a macrotask.
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
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

function getTestInput(): HTMLInputElement {
  const element = document.getElementById(NAME_BLOCK_ID)

  if (!(element instanceof HTMLInputElement)) {
    throw new Error("Expected the editable test-mode field.")
  }

  return element
}

function type(element: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set

  act(() => {
    valueSetter?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
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
      blocks: [
        {
          id: NAME_BLOCK_ID,
          type: "text_field",
          fieldKey: "full_name",
          label: "Full name",
          required: false,
          helpText: null,
          placeholder: null,
          multiline: false
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
