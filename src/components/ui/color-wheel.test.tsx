// @vitest-environment jsdom

import { act, type ReactElement, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it } from "vitest"

import { ColorWheel } from "./color-wheel"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
})

function Harness(): ReactElement {
  const [value, setValue] = useState("#ff0000")

  return (
    <>
      <ColorWheel label="Accent" onChange={setValue} value={value} />
      <output>{value}</output>
    </>
  )
}

it("turns, fades and darkens a colour from the keyboard, keeping its hue through black", async () => {
  await act(async () => createRoot(document.body.appendChild(document.createElement("div"))).render(<Harness />))
  const wheel = document.querySelector('[role="slider"][aria-label="Accent hue and saturation"]') as HTMLElement
  const brightness = document.querySelector('input[aria-label="Accent brightness"]') as HTMLInputElement
  const chosen = (): string | null | undefined => document.querySelector("output")?.textContent

  // Four large steps turn red a sixth of the way round, to yellow.
  for (let step = 0; step < 4; step += 1) {
    press(wheel, "ArrowRight", true)
  }
  expect(chosen()).toBe("#ffff00")

  // Black has no hue of its own; the wheel keeps yellow for when it brightens again.
  slide(brightness, "0")
  expect(chosen()).toBe("#000000")
  slide(brightness, "100")
  expect(chosen()).toBe("#ffff00")

  // Toward the centre, every colour fades to white.
  for (let step = 0; step < 7; step += 1) {
    press(wheel, "ArrowDown", true)
  }
  expect(chosen()).toBe("#ffffff")
})

function press(target: HTMLElement, key: string, shiftKey: boolean): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, shiftKey }))
  })
}

function slide(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
