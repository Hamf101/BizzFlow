// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

import { BizFlowMark } from "./bizflow-mark"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it("parts under the pointer, settles on leave, and respects reduced motion", () => {
  let reduced = false
  vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener: () => undefined, removeEventListener: () => undefined }))
  // jsdom has no SVG layout; a facet sits off-centre in the 600-unit viewBox.
  Object.defineProperty(SVGElement.prototype, "getBBox", { configurable: true, value: () => ({ x: 50, y: 20, width: 80, height: 100 }) })
  const host = document.createElement("a")
  document.body.append(host)
  const root = createRoot(host)
  try {
    act(() => root.render(<BizFlowMark />))
    const svg = host.querySelector("svg")!
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 44, height: 44 } as DOMRect)
    const pieces = [...svg.querySelectorAll("[data-piece]")]
    expect(pieces.length).toBeGreaterThan(1)
    const morph = svg.querySelector('animate[attributeName="points"]')
    expect(morph).not.toBeNull()
    const shapes = morph!.getAttribute("values")!.split(";")
    expect(shapes[2]).not.toBe(shapes[0])
    expect(shapes[4]).toBe(shapes[0])
    expect(svg.querySelector('animateTransform[type="translate"]')).not.toBeNull()
    expect(svg.querySelector('animateTransform[type="rotate"]')).not.toBeNull()
    expect(Number.parseFloat(morph!.getAttribute("dur")!)).toBeGreaterThan(12)
    host.dispatchEvent(new MouseEvent("pointermove", { clientX: 22, clientY: 22 }))
    expect(pieces.some((piece) => piece.getAttribute("transform")?.includes("translate"))).toBe(true)
    host.dispatchEvent(new MouseEvent("pointerleave"))
    expect(pieces.every((piece) => !piece.getAttribute("transform"))).toBe(true)
    act(() => root.unmount())
    reduced = true
    const stillRoot = createRoot(host)
    act(() => stillRoot.render(<BizFlowMark />))
    expect(host.querySelector("animate, animateTransform")).toBeNull()
    host.dispatchEvent(new MouseEvent("pointermove", { clientX: 22, clientY: 22 }))
    expect([...host.querySelectorAll("[data-piece]")].every((piece) => !piece.getAttribute("transform"))).toBe(true)
    act(() => stillRoot.unmount())
  } finally {
    host.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(SVGElement.prototype, "getBBox")
  }
})
