// @vitest-environment jsdom

import { act } from "react"
import { createPortal } from "react-dom"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"

import { FloatingTool } from "./floating-tool"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
})

// A press on the element, dragged well past a click, then let go.
function drag(target: Element): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 60, clientY: 40 }))
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 60, clientY: 40 }))
  })
}

it("moves when the tool is dragged, but not when the drag starts in a panel it opened", async () => {
  const onMove = vi.fn()
  const host = document.createElement("div")
  document.body.append(host)
  // A panel opens in its own layer at the end of the page, as the dock's do.
  const layer = document.createElement("div")
  document.body.append(layer)

  await act(async () =>
    createRoot(host).render(
      <FloatingTool menu={null} onMove={onMove} spot={{ x: 0, y: 0 }}>
        <button type="button">Brand</button>
        {createPortal(<div aria-valuenow={0} role="slider">Colour wheel</div>, layer)}
      </FloatingTool>
    )
  )

  drag(document.querySelector('[role="slider"]')!)
  expect(onMove).not.toHaveBeenCalled()

  drag(document.querySelector("button")!)
  expect(onMove).toHaveBeenCalledOnce()
})
