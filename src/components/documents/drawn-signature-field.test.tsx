// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { DrawnSignatureField } from "./drawn-signature-field"

const mounted: Root[] = []
const PNG = "data:image/png;base64,AAAA"
const context = { clearRect: vi.fn(), fillText: vi.fn(), font: "", textBaseline: "", fillStyle: "" }

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never)
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(PNG)
  context.clearRect.mockClear()
  context.fillText.mockClear()
})

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function mount(): { hidden: HTMLInputElement; typed: HTMLInputElement } {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mounted.push(root)
  act(() => root.render(createElement(DrawnSignatureField, { label: "Signature", name: "signature", required: true })))
  return {
    hidden: container.querySelector('input[name="signature"]') as HTMLInputElement,
    typed: container.querySelector('input:not([type="hidden"])') as HTMLInputElement,
  }
}

function type(input: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set

  act(() => {
    set?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("a signature that can be typed instead of drawn", () => {
  it("offers a labelled text field, so a keyboard alone can sign", () => {
    const { typed } = mount()

    expect(typed.labels?.[0]?.textContent).toBe("Or type your signature")
  })

  it("writes the typed name onto the canvas and submits it as the same kind of picture", () => {
    const { hidden, typed } = mount()

    type(typed, "Ada Lovelace")

    expect(context.fillText).toHaveBeenCalledWith("Ada Lovelace", expect.any(Number), expect.any(Number), expect.any(Number))
    expect(hidden.value).toBe(PNG)
  })

  it("submits nothing when the typed name is emptied or only spaces", () => {
    const { hidden, typed } = mount()

    type(typed, "Ada")
    type(typed, "   ")

    expect(hidden.value).toBe("")
  })

  it("clears the typed name along with the picture", () => {
    const { hidden, typed } = mount()

    type(typed, "Ada")
    act(() => {
      ;[...document.querySelectorAll("button")].find((button) => button.textContent === "Clear")?.click()
    })

    expect(typed.value).toBe("")
    expect(hidden.value).toBe("")
  })
})
