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

it("lets an author try the form by typing into its boxes while editing, and clear the try-out", async () => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <TemplateEditor
        archiveAction={vi.fn()}
        initialFlowMessages={[]}
        me={{ id: "20000000-0000-4000-8000-000000000001", name: "Test editor" }}
        loadVersionAction={vi.fn()}
        publishAction={vi.fn()}
        saveDraftAction={vi.fn(async () => ({ ok: true as const, version: "1" }))}
        template={createTemplate()}
      />
    )
  })

  typeInto(nameInput(), "Ada Lovelace")
  expect(nameInput().value).toBe("Ada Lovelace")

  const clear = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Clear")
  await act(async () => clear?.click())
  expect(nameInput().value).toBe("")
})

it("asks Flow with only the title, description and content its request accepts", async () => {
  const fetchFlow = vi.fn(async () => ({ json: async () => ({ error: "Stop here." }), ok: false }))
  vi.stubGlobal("fetch", fetchFlow)
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <TemplateEditor
        archiveAction={vi.fn()}
        initialFlowMessages={[]}
        me={{ id: "20000000-0000-4000-8000-000000000001", name: "Test editor" }}
        loadVersionAction={vi.fn()}
        publishAction={vi.fn()}
        saveDraftAction={vi.fn(async () => ({ ok: true as const, version: "1" }))}
        template={createTemplate()}
      />
    )
  })

  // A busy machine can take a moment to show the prompts and send the request.
  const prompt = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Explain the structure of this document"
    )
    expect(found).toBeDefined()
    return found!
  })
  await act(async () => prompt.click())

  // The room opens with its own request; this is the one to Flow.
  const [, request] = await vi.waitFor(() => {
    const call = (fetchFlow.mock.calls as unknown as Array<[string, { body: string }]>).find(([url]) => url.includes("/flow"))
    expect(call).toBeDefined()
    return call!
  })
  expect(Object.keys(JSON.parse(request.body).draft).sort()).toEqual(["content", "description", "title"])
  vi.unstubAllGlobals()
})

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
    publishedRevision: null,
    revision: 1,
    status: "draft",
    title: "Client agreement",
    updatedAt: "2026-09-01T09:00:00.000Z",
    updatedBy: null,
  }
}
