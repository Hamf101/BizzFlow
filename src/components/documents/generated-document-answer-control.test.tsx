// @vitest-environment jsdom

import type { ReactElement } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { GeneratedDocumentContent } from "@/components/documents/generated-document-content"
import { createBlankTemplateContent, type TemplateContentV3 } from "@/types/template"

const CONTROLLER_ID = "20000000-0000-4000-8000-000000000001"
const CONDITIONAL_ID = "20000000-0000-4000-8000-000000000002"
const NAME_ID = "20000000-0000-4000-8000-000000000003"

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
})

describe("GeneratedDocumentContent answer ownership", () => {
  it("renders the owner's answers on every update, not only at mount", () => {
    const render = mount(
      <GeneratedDocumentContent
        answerControl={{ answers: { full_name: "Ada" }, onChange: vi.fn() }}
        content={createAnswerableContent()}
        editable
        title="Controlled document"
      />
    )

    expect(getInput("full_name").value).toBe("Ada")

    render(
      <GeneratedDocumentContent
        answerControl={{ answers: { full_name: "Grace" }, onChange: vi.fn() }}
        content={createAnswerableContent()}
        editable
        title="Controlled document"
      />
    )

    expect(getInput("full_name").value).toBe("Grace")
  })

  it("hands each edit to the owner instead of storing it internally", () => {
    const onChange = vi.fn()

    mount(
      <GeneratedDocumentContent
        answerControl={{ answers: { full_name: "Ada" }, onChange }}
        content={createAnswerableContent()}
        editable
        title="Controlled document"
      />
    )

    type(getInput("full_name"), "Ada Lovelace")

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ full_name: "Ada Lovelace" })
    // The owner did not re-render with the new value, so a component that had
    // silently kept its own copy would show it here.
    expect(getInput("full_name").value).toBe("Ada")
  })

  it("prunes answers hidden by conditional visibility before the owner stores them", () => {
    const onChange = vi.fn()

    mount(
      <GeneratedDocumentContent
        answerControl={{
          answers: { include_details: true, details: "Prior detail" },
          onChange
        }}
        content={createAnswerableContent()}
        editable
        title="Controlled document"
      />
    )

    expect(getInput("details")).toBeInstanceOf(HTMLTextAreaElement)

    const controller = getInput("include_details")
    act(() => {
      controller.click()
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]?.[0]).not.toHaveProperty("details")
  })

  it("reports the owner's own object back when nothing is hidden", () => {
    // An owner may both control answers and observe them. Handing back an equal
    // but freshly built object would make that pairing re-render forever.
    const onAnswersChange = vi.fn()
    const owned = { full_name: "Ada" }

    mount(
      <GeneratedDocumentContent
        answerControl={{ answers: owned, onChange: vi.fn() }}
        content={createAnswerableContent()}
        editable
        onAnswersChange={onAnswersChange}
        title="Controlled document"
      />
    )

    expect(onAnswersChange).toHaveBeenCalledTimes(1)
    expect(onAnswersChange.mock.calls[0]?.[0]).toBe(owned)
  })

  it("keeps owning its answers when no control is supplied", () => {
    // Guards the server-rendered call sites, which post answers through
    // FormData and cannot own React state.
    const render = mount(
      <GeneratedDocumentContent
        answers={{ full_name: "Ada" }}
        content={createAnswerableContent()}
        editable
        title="Uncontrolled document"
      />
    )

    type(getInput("full_name"), "Ada Lovelace")
    expect(getInput("full_name").value).toBe("Ada Lovelace")

    render(
      <GeneratedDocumentContent
        answers={{ full_name: "Grace" }}
        content={createAnswerableContent()}
        editable
        title="Uncontrolled document"
      />
    )

    expect(getInput("full_name").value).toBe("Ada Lovelace")
  })

  it("prefers the supplied control over the uncontrolled seed answers", () => {
    mount(
      <GeneratedDocumentContent
        answerControl={{ answers: { full_name: "Grace" }, onChange: vi.fn() }}
        answers={{ full_name: "Ada" }}
        content={createAnswerableContent()}
        editable
        title="Controlled document"
      />
    )

    expect(getInput("full_name").value).toBe("Grace")
  })
})

function mount(ui: ReactElement): (next: ReactElement) => void {
  const container = document.createElement("div")
  document.body.append(container)

  const root = createRoot(container)
  mountedRoots.push(root)
  act(() => root.render(ui))

  return (next: ReactElement): void => {
    act(() => root.render(next))
  }
}

function getInput(fieldKey: string): HTMLInputElement | HTMLTextAreaElement {
  const blockId = BLOCK_ID_BY_FIELD_KEY[fieldKey]
  const element = document.getElementById(blockId ?? "")

  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLTextAreaElement)
  ) {
    throw new Error(`Expected an editable control for "${fieldKey}".`)
  }

  return element
}

function type(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set

  act(() => {
    valueSetter?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

const BLOCK_ID_BY_FIELD_KEY: Readonly<Record<string, string>> = {
  include_details: CONTROLLER_ID,
  details: CONDITIONAL_ID,
  full_name: NAME_ID
}

function createAnswerableContent(): TemplateContentV3 {
  return {
    ...createBlankTemplateContent(),
    blocks: [
      {
        id: NAME_ID,
        type: "text_field",
        fieldKey: "full_name",
        label: "Full name",
        required: false,
        helpText: null,
        placeholder: null,
        multiline: false
      },
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
        required: false,
        helpText: null,
        placeholder: null,
        multiline: true,
        visibleWhen: {
          sourceBlockId: CONTROLLER_ID,
          operator: "equals",
          value: true
        }
      }
    ]
  }
}
