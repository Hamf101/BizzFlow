// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

import AnimatedFavicon from "./animated-favicon"

vi.mock("./bizflow-mark", () => ({ BizFlowMark: () => <svg><polygon points="0,0 10,0 0,10"><animate dur="20s" keyTimes="0;0.4;0.5;0.9;1" /><animateTransform dur="20s" keyTimes="0;0.412;0.457;0.5;0.912;0.957;1" /></polygon></svg> }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it("enlarges tab pixels, updates on the next animation frame, pauses when hidden, and cleans up", () => {
  vi.useFakeTimers()
  // jsdom has no SVG geometry or canvas rasterizer. Record the drawn geometry as the frame.
  let x = 10
  let drawing: number[] = []
  let hidden = false
  let transform = [1, 0, 0, 1, 0, 0]
  const context = {
    resetTransform: () => undefined,
    clearRect: () => { drawing = [] },
    setTransform: (...values: number[]) => { transform = values },
    beginPath: () => undefined,
    lineTo: (px: number, py: number) => drawing.push(
      Number((px * transform[0] + py * transform[2] + transform[4]).toFixed(2)),
      Number((px * transform[1] + py * transform[3] + transform[5]).toFixed(2)),
    ),
    closePath: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
  }
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never)
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => `data:image/png,${drawing.join(",")}`)
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden)
  vi.stubGlobal("SVGPolygonElement", SVGElement)
  Object.defineProperties(SVGElement.prototype, {
    getBBox: { configurable: true, value: () => ({ x: -180, y: -230, width: 360, height: 460 }) },
    getCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
    animatedPoints: { configurable: true, get: () => [{ x: 0, y: 0 }, { x, y: 0 }, { x: 0, y: 10 }] },
  })
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  try {
    act(() => root.render(<AnimatedFavicon />))
    const morph = host.querySelector("animate")!
    const duration = Number.parseFloat(morph.getAttribute("dur")!)
    const times = morph.getAttribute("keyTimes")!.split(";").map(Number)
    expect(times[1] * duration).toBeCloseTo(8)
    expect((times[2] - times[1]) * duration).toBeCloseTo(0.65)
    expect((times[3] - times[2]) * duration).toBeCloseTo(8)
    expect((times[4] - times[3]) * duration).toBeCloseTo(0.65)
    const pieces = host.querySelector("animateTransform")!
    expect(pieces.getAttribute("dur")).toBe(morph.getAttribute("dur"))
    expect(Number(pieces.getAttribute("keyTimes")!.split(";")[2]) * duration).toBeCloseTo(8.3705)
    const icon = document.head.querySelector<HTMLLinkElement>('link[type="image/png"]')!
    expect(icon.getAttribute("href")).toBe("data:image/png,-3.2,-3.2,8.8,-3.2,-3.2,8.8")
    x = 20
    act(() => vi.advanceTimersToNextFrame())
    expect(icon.getAttribute("href")).toBe("data:image/png,-3.2,-3.2,20.8,-3.2,-3.2,8.8")
    hidden = true
    document.dispatchEvent(new Event("visibilitychange"))
    x = 30
    act(() => vi.advanceTimersByTime(1000))
    expect(icon.getAttribute("href")).toBe("data:image/png,-3.2,-3.2,20.8,-3.2,-3.2,8.8")
    hidden = false
    document.dispatchEvent(new Event("visibilitychange"))
    expect(icon.getAttribute("href")).toBe("data:image/png,-3.2,-3.2,32.8,-3.2,-3.2,8.8")
  } finally {
    act(() => root.unmount())
    host.remove()
    expect(document.head.querySelector('link[type="image/png"]')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(SVGElement.prototype, "getCTM")
    Reflect.deleteProperty(SVGElement.prototype, "getBBox")
    Reflect.deleteProperty(SVGElement.prototype, "animatedPoints")
  }
})
