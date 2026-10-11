// @vitest-environment jsdom

import { act } from "react"
import { describe, expect, it } from "vitest"

import { GeneratedDocumentContent } from "@/components/documents/generated-document-content"
import { createBlankTemplateContent, parseTemplateContent, type TemplateContentV3 } from "@/types/template"
import { mount } from "@/test/render"

const CONTROLLER_ID = "20000000-0000-4000-8000-000000000001"
const CONDITIONAL_ID = "20000000-0000-4000-8000-000000000002"
const NAME_ID = "20000000-0000-4000-8000-000000000003"

describe("GeneratedDocumentContent answer ownership", () => {
  it("keeps owning its answers when no control is supplied", () => {
    // Guards the server-rendered call sites, which post answers through
    // FormData and cannot own React state.
    const root = mount()
    act(() =>
      root.render(
        <GeneratedDocumentContent
          answers={{ full_name: "Ada" }}
          content={createAnswerableContent()}
          editable
          title="Uncontrolled document"
        />
      )
    )

    type(getInput("full_name"), "Ada Lovelace")
    expect(getInput("full_name").value).toBe("Ada Lovelace")

    act(() =>
      root.render(
        <GeneratedDocumentContent
          answers={{ full_name: "Grace" }}
          content={createAnswerableContent()}
          editable
          title="Uncontrolled document"
        />
      )
    )

    expect(getInput("full_name").value).toBe("Ada Lovelace")
  })

  it("shows a worked-out answer, never a box for it, and keeps an answer its figure reveals", async () => {
    const root = mount()
    act(() => root.render(<GeneratedDocumentContent content={createDoubledContent()} editable title="Worked out" />))
    // The arithmetic loads only once a document with a formula is drawn.
    await act(async () => {
      await import("@/types/template-calculation")
    })

    type(byId(BASE_ID), "60")

    expect(document.getElementById(DOUBLED_ID)).toBeNull()
    expect(document.body.textContent).toContain("120")

    type(byId(DETAILS_ID), "Gate code 4512")
    expect(byId(DETAILS_ID).value).toBe("Gate code 4512")
  })
})

const BASE_ID = "20000000-0000-4000-8000-000000000011"
const DOUBLED_ID = "20000000-0000-4000-8000-000000000012"
const DETAILS_ID = "20000000-0000-4000-8000-000000000013"

function byId(id: string): HTMLInputElement {
  const element = document.getElementById(id)

  if (!(element instanceof HTMLInputElement)) throw new Error(`Expected an input for ${id}.`)

  return element
}

// Details shows once Doubled, twice Base, is over 100.
function createDoubledContent(): TemplateContentV3 {
  const field = (id: string, label: string, extra: object = {}) => ({ id, type: "text_field", fieldKey: label.toLowerCase(), label, required: false, helpText: null, placeholder: null, multiline: false, ...extra })

  return parseTemplateContent({
    ...createBlankTemplateContent(),
    sections: [],
    blocks: [
      field(BASE_ID, "Base", { format: "number" }),
      field(DOUBLED_ID, "Doubled", { format: "number", formula: "{Base} * 2" }),
      field(DETAILS_ID, "Details", { visibleWhen: { sourceBlockId: DOUBLED_ID, operator: "greater_than", value: "100" } }),
    ],
  }) as TemplateContentV3
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
