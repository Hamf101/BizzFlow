// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { createBlankTemplateContent, type TemplateContentV3 } from "@/types/template"

import { PublicFormFieldList } from "./public-form-fields"

const FIELD_ID = "70000000-0000-4000-8000-0000000000a1"
const mounted: Root[] = []

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

function requiredTextContent(): TemplateContentV3 {
  const content = createBlankTemplateContent()
  content.blocks = [
    {
      fieldKey: "client_reference",
      helpText: null,
      id: FIELD_ID,
      label: "Client reference",
      multiline: false,
      placeholder: null,
      required: true,
      type: "text_field",
    },
  ]
  return content
}

function mount(): HTMLInputElement {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mounted.push(root)
  act(() =>
    root.render(
      createElement(PublicFormFieldList, {
        answers: {},
        content: requiredTextContent(),
        onAnswerChange: () => undefined,
        token: "public-token",
      })
    )
  )
  return container.querySelector("input") as HTMLInputElement
}

describe("a required public form field that was left empty", () => {
  it("shows its error beside it and ties the error to the field", () => {
    const input = mount()

    act(() => {
      input.checkValidity()
    })

    const error = document.getElementById(`${FIELD_ID}-error`)

    expect(error?.textContent).toBe("Client reference is required.")
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("aria-describedby")).toContain(`${FIELD_ID}-error`)
  })

  it("takes the error away as soon as the person types", () => {
    const input = mount()

    act(() => {
      input.checkValidity()
    })
    act(() => {
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(document.getElementById(`${FIELD_ID}-error`)).toBeNull()
    expect(input.getAttribute("aria-invalid")).toBeNull()
    expect(input.getAttribute("aria-describedby")).toBeNull()
  })

  it("keeps the asterisk out of what a screen reader reads", () => {
    mount()

    const asterisk = [...document.querySelectorAll("label span")].find((span) => span.textContent === "*")

    expect(asterisk?.getAttribute("aria-hidden")).toBe("true")
  })
})
