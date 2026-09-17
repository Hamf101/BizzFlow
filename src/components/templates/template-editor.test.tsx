// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, expect, it, vi } from "vitest"

import { TemplateEditor } from "@/components/templates/template-editor"
import { createBlankTemplateContent, type DocumentTemplate } from "@/types/template"

const NAME_BLOCK_ID = "20000000-0000-4000-8000-000000000001"
const roots: Root[] = []

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= ((query: string) =>
    ({ addEventListener() {}, matches: false, media: query, removeEventListener() {} }) as unknown as MediaQueryList)
  globalThis.ResizeObserver ??= class {
    disconnect(): void {}
    observe(): void {}
    unobserve(): void {}
  }
})

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
  window.localStorage.clear()
})

it("keeps a trial run's answers when the author edits or previews and comes back", async () => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <TemplateEditor
        archiveAction={vi.fn()}
        initialFlowMessages={[]}
        publishAction={vi.fn()}
        saveDraftAction={vi.fn(async () => ({ ok: true as const, version: "1" }))}
        template={createTemplate()}
      />
    )
  })

  await chooseMode("Test")
  typeInto(nameInput(), "Ada Lovelace")

  // Fixing wording mid-test, or checking the printed page, must not lose what was typed.
  await chooseMode("Edit")
  await chooseMode("Test")
  expect(nameInput().value).toBe("Ada Lovelace")

  await chooseMode("Preview")
  await chooseMode("Test")
  expect(nameInput().value).toBe("Ada Lovelace")
})

async function chooseMode(name: string): Promise<void> {
  const radio = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (candidate) => candidate.textContent?.trim() === name
  )

  if (!radio) {
    throw new Error(`Expected a "${name}" mode.`)
  }

  await act(async () => radio.click())
}

function nameInput(): HTMLInputElement {
  const input = document.getElementById(NAME_BLOCK_ID)

  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Expected the field to take an answer.")
  }

  return input
}

function typeInto(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function createTemplate(): DocumentTemplate {
  return {
    archivedAt: null,
    archivedBy: null,
    category: "Agreements",
    content: {
      ...createBlankTemplateContent(),
      blocks: [
        {
          fieldKey: "full_name",
          helpText: null,
          id: NAME_BLOCK_ID,
          label: "Full name",
          multiline: false,
          placeholder: null,
          required: false,
          type: "text_field",
        },
      ],
    },
    createdAt: "2026-09-01T09:00:00.000Z",
    createdBy: null,
    description: "Standard engagement terms",
    id: "10000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000002",
    publishedAt: null,
    publishedBy: null,
    revision: 1,
    status: "draft",
    title: "Client agreement",
    updatedAt: "2026-09-01T09:00:00.000Z",
    updatedBy: null,
  }
}
