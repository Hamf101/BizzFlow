// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

import ThemedFavicon from "./themed-favicon"

vi.mock("./bizflow-mark", () => ({ BizFlowMark: () => <svg><polygon points="0,0 10,0 0,10" /></svg> }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LIGHT = "rgb(255, 253, 252)"
const DARK = "rgb(34, 30, 43)"

it("plays the logo's turns from frames drawn once, finishes a turn before the browser can keep it, and follows the theme", async () => {
  vi.useFakeTimers()
  // jsdom has no SVG clock or canvas rasterizer: each frame records the moment it was drawn at and its fill.
  let time = 0
  let hidden = false
  let reduced = false
  const context = {
    fillStyle: "",
    resetTransform: () => undefined,
    clearRect: () => undefined,
    setTransform: () => undefined,
    beginPath: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
  }
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never)
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => `data:image/png,${time}|${context.fillStyle}`)
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden)
  vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({
    fill: document.documentElement.classList.contains("dark") ? DARK : LIGHT,
    opacity: "1",
    stroke: "rgb(99, 82, 115)",
    strokeWidth: "5",
  }) as never)
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }))
  vi.stubGlobal("SVGPolygonElement", SVGElement)
  Object.defineProperties(SVGSVGElement.prototype, {
    pauseAnimations: { configurable: true, value: () => undefined },
    setCurrentTime: { configurable: true, value: (seconds: number) => { time = seconds } },
  })
  Object.defineProperties(SVGElement.prototype, {
    getBBox: { configurable: true, value: () => ({ x: -180, y: -230, width: 360, height: 460 }) },
    getCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
    animatedPoints: { configurable: true, get: () => [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] },
  })
  const frame = (seconds: number, fill = LIGHT): string => `data:image/png,${seconds}|${fill}`
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  try {
    act(() => root.render(<ThemedFavicon />))
    act(() => vi.advanceTimersByTime(0))
    const icons = document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')
    expect(icons).toHaveLength(1)
    const icon = icons[0]
    const shown = (): string | null => icon.getAttribute("href")
    // The page rests, turns into the folder in five quick frames, and the folder rests.
    expect(shown()).toBe(frame(4))
    act(() => vi.advanceTimersByTime(7_999))
    expect(shown()).toBe(frame(4))
    act(() => vi.advanceTimersByTime(1))
    expect(shown()).toBe(frame(8 + 2 / 6))
    act(() => vi.advanceTimersByTime(110 * 5))
    expect(shown()).toBe(frame(14))
    // A click mid-turn finishes the turn at once, before any link it opens can change the address.
    act(() => vi.advanceTimersByTime(8_000))
    expect(shown()).toBe(frame(18 + 2 / 6))
    act(() => document.dispatchEvent(new Event("pointerdown")))
    expect(shown()).toBe(frame(4))
    // So does hiding the tab, and nothing runs while it is hidden.
    act(() => vi.advanceTimersByTime(8_000 + 110))
    expect(shown()).toBe(frame(8 + 4 / 6))
    hidden = true
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    expect(shown()).toBe(frame(14))
    expect(vi.getTimerCount()).toBe(0)
    hidden = false
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    await act(async () => document.documentElement.classList.add("dark"))
    expect(shown()).toBe(frame(14, DARK))
    act(() => vi.advanceTimersByTime(8_000))
    expect(shown()).toBe(frame(18 + 2 / 6, DARK))
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1)
    act(() => root.unmount())
    expect(document.head.querySelector('link[rel="icon"]')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    // With reduced motion the page rests for good.
    reduced = true
    const stillRoot = createRoot(host)
    act(() => stillRoot.render(<ThemedFavicon />))
    act(() => vi.advanceTimersByTime(60_000))
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe(frame(4, DARK))
    expect(vi.getTimerCount()).toBe(0)
    act(() => stillRoot.unmount())
  } finally {
    host.remove()
    document.documentElement.classList.remove("dark")
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    for (const name of ["pauseAnimations", "setCurrentTime"]) Reflect.deleteProperty(SVGSVGElement.prototype, name)
    for (const name of ["getBBox", "getCTM", "animatedPoints"]) Reflect.deleteProperty(SVGElement.prototype, name)
  }
})
