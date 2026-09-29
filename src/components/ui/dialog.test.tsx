// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

const mounted: Root[] = []

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

async function openDialog(): Promise<HTMLElement> {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mounted.push(root)

  await act(async () => {
    root.render(
      createElement(
        Dialog,
        { open: true },
        createElement(
          DialogContent,
          { showCloseButton: false },
          createElement(DialogTitle, null, "Pick one"),
          createElement("button", { id: "first", type: "button" }, "First"),
          createElement("button", { id: "last", type: "button" }, "Last"),
          createElement("button", { disabled: true, id: "skipped", type: "button" }, "Disabled")
        )
      )
    )
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })

  return document.querySelector('[data-slot="dialog-content"]') as HTMLElement
}

function press(target: HTMLElement, options: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab", ...options })

  act(() => {
    target.dispatchEvent(event)
  })

  return event
}

describe("Tab inside a dialog", () => {
  it("wraps from the last control to the first, so focus never reaches the page behind", async () => {
    const dialog = await openDialog()
    const last = dialog.querySelector("#last") as HTMLElement

    act(() => last.focus())
    const event = press(last, {})

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe("first")
  })

  it("wraps backwards from the first control to the last, skipping disabled ones", async () => {
    const dialog = await openDialog()
    const first = dialog.querySelector("#first") as HTMLElement

    act(() => first.focus())
    const event = press(first, { shiftKey: true })

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe("last")
  })

  it("leaves Tab alone between controls", async () => {
    const dialog = await openDialog()
    const first = dialog.querySelector("#first") as HTMLElement

    act(() => first.focus())

    expect(press(first, {}).defaultPrevented).toBe(false)
  })
})
