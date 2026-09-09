// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { TemplateEditor } from "@/components/templates/template-editor"
import {
  createBlankTemplateContent,
  type DocumentTemplate
} from "@/types/template"

const TEMPLATE_ID = "10000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000002"
const HEADING_ID = "20000000-0000-4000-8000-000000000001"
const PARAGRAPH_ID = "20000000-0000-4000-8000-000000000002"

const toastInfo = vi.fn()

vi.mock("@/components/ui/toaster", () => ({
  bizflowToast: {
    error: vi.fn(),
    info: (...args: unknown[]) => toastInfo(...args),
    loading: vi.fn(),
    success: vi.fn()
  },
  BizFlowToaster: (): null => null
}))

const mountedRoots: Root[] = []

beforeAll(() => {
  ;(
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean
    }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  toastInfo.mockClear()
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
  window.localStorage.clear()
})

describe("Template Studio element deletion", () => {
  it("asks before removing an element", async () => {
    await renderStudio()
    await selectHeading()

    await click(getByAriaLabel("Delete block"))

    // Nothing is destroyed on the strength of one click.
    expect(headingIsPresent()).toBe(true)
    expect(document.body.textContent).toContain("Delete this heading?")
  })

  it("keeps the element when the author backs out", async () => {
    await renderStudio()
    await selectHeading()

    await click(getByAriaLabel("Delete block"))
    await click(getButton("Keep element"))

    expect(headingIsPresent()).toBe(true)
  })

  it("removes the element once the author confirms", async () => {
    await renderStudio()
    await selectHeading()

    await click(getByAriaLabel("Delete block"))
    await click(getButton("Delete element"))

    expect(headingIsPresent()).toBe(false)
  })

  it("refuses a protected deletion without asking first", async () => {
    // A block other fields depend on cannot be deleted at all, so prompting
    // for confirmation would only ask the author to approve a refusal.
    await renderStudio({ withDependentField: true })
    await selectHeading()

    await click(getByAriaLabel("Delete block"))

    expect(document.body.textContent).not.toContain("Delete this heading?")
    expect(document.body.textContent).toContain(
      "Conditional visibility protects this change"
    )
    expect(headingIsPresent()).toBe(true)
  })

  it("offers an undo that restores the deleted element", async () => {
    // A confirmation stops the accident; undo is what makes a considered
    // deletion reversible, since nothing else in the Studio can bring a block
    // back once it is gone.
    await renderStudio()
    await selectHeading()

    await click(getByAriaLabel("Delete block"))
    await click(getButton("Delete element"))
    expect(headingIsPresent()).toBe(false)

    const [, options] = toastInfo.mock.calls[0] ?? []
    const action = (options as { action?: { label?: string; onClick?: () => void } })
      ?.action

    expect(action?.label).toBe("Undo")

    await act(async () => {
      action?.onClick?.()
    })

    expect(headingIsPresent()).toBe(true)
  })
})

async function renderStudio({
  withDependentField = false
}: { withDependentField?: boolean } = {}): Promise<void> {
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
        template={createTemplate(withDependentField)}
      />
    )
  })

  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

async function selectHeading(): Promise<void> {
  const heading = document.querySelector('button[aria-label="Edit heading"]')
  await click(
    heading instanceof HTMLButtonElement
      ? heading
      : getByAriaLabel("Edit checkbox field")
  )
}

function headingIsPresent(): boolean {
  return document.querySelector(`[data-template-block-id="${HEADING_ID}"]`) !== null
}

function getByAriaLabel(label: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label="${label}"]`)

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected a control labelled "${label}".`)
  }

  return button
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

function createTemplate(withDependentField = false): DocumentTemplate {
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
      blocks: withDependentField
        ? [
            {
              id: HEADING_ID,
              type: "checkbox_field",
              fieldKey: "include_scope",
              label: "Include scope",
              required: false,
              helpText: null,
              checkedByDefault: false
            },
            {
              id: PARAGRAPH_ID,
              type: "text_field",
              fieldKey: "scope_notes",
              label: "Scope notes",
              required: false,
              helpText: null,
              placeholder: null,
              multiline: true,
              visibleWhen: {
                sourceBlockId: HEADING_ID,
                operator: "equals",
                value: true
              }
            }
          ]
        : [
            {
              id: HEADING_ID,
              type: "heading",
              text: "Engagement details",
              level: 2,
              alignment: "left"
            },
            {
              id: PARAGRAPH_ID,
              type: "paragraph",
              text: "Agreed scope and milestones.",
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
