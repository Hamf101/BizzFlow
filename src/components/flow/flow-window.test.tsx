// @vitest-environment jsdom

import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, expect, it, vi } from "vitest"

import { FlowWindow } from "@/components/flow/flow-window"

const roots: Root[] = []
let phone = false
let moving = false

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // Motion is off unless a test turns it on, so every fold and unfold lands on the next frame.
  vi.stubGlobal("matchMedia", (query: string) => ({
    addEventListener() {},
    matches: (!moving && query.includes("reduced-motion")) || (phone && query.includes("48rem")),
    media: query,
    removeEventListener() {},
  }))
})

function unmount(): void {
  for (const root of roots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
}

afterEach(() => {
  unmount()
  localStorage.clear()
  phone = false
  moving = false
  delete (HTMLElement.prototype as { animate?: unknown }).animate
})

function Flow(): React.ReactElement {
  const [open, setOpen] = useState(false)

  return (
    <FlowWindow onOpenChange={setOpen} open={open}>
      <label>
        Ask Flow
        <textarea />
      </label>
    </FlowWindow>
  )
}

async function render(): Promise<void> {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  await act(async () => root.render(<Flow />))
  await frames()
}

// Lets the animation's frames run.
async function frames(): Promise<void> {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 60)))
}

const launcher = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('[data-slot="flow-launcher"]')!
const flow = (): HTMLElement => document.querySelector<HTMLElement>('[role="dialog"]')!
const spot = (): string => launcher().style.transform
// Where the folded page itself is drawn: the top left of all its pieces.
const page = (): [number, number] => {
  const points = [...document.querySelectorAll("polygon")].flatMap((piece) =>
    (piece.getAttribute("points") ?? "").split(" ").map((pair) => pair.split(",").map(Number))
  )

  return [Math.min(...points.map(([x]) => x!)), Math.min(...points.map(([, y]) => y!))]
}

it("opens as the Flow window, and Escape folds it back and hands focus to the button", async () => {
  await render()
  await act(async () => launcher().click())
  await frames()

  expect(flow().hidden).toBe(false)
  expect(document.getElementById(flow().getAttribute("aria-labelledby")!)?.textContent).toBe("Flow")
  expect(document.activeElement).toBe(flow().querySelector("textarea"))

  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })))
  await frames()

  expect(flow().hidden).toBe(true)
  expect(document.activeElement).toBe(launcher())
})

it("comes back where it was left, on the next visit and after the window closes", async () => {
  localStorage.setItem("bizflow:flow:place", JSON.stringify({ side: "left", top: 300 }))
  await render()
  const left = spot()

  expect(left).toBe("translate(15px, 293px)")

  await act(async () => launcher().click())
  await frames()
  await act(async () => flow().querySelector<HTMLButtonElement>('[aria-label="Close Flow"]')!.click())
  await frames()

  // Folded back to the same spot, not to the window's corner.
  expect(spot()).toBe(left)
  expect(page()).toEqual([24, 300])
})

it("on a phone, pulls taller or shorter from a grab bar that a tap or the arrow keys also work", async () => {
  phone = true
  await render()
  await act(async () => launcher().click())
  await frames()
  const grab = flow().querySelector<HTMLButtonElement>('[aria-label="Resize Flow"]')!
  const height = (): number => parseFloat(flow().style.height)
  const opened = height()

  await act(async () => grab.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })))
  await frames()
  const switched = height()

  await act(async () => grab.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })))
  await frames()

  expect(switched).not.toBe(opened)
  expect(height()).toBe(switched - 48)
  expect(JSON.parse(localStorage.getItem("bizflow:flow:phone-height")!)).toBe(Math.round(height()))
})

it("rests as a swarm of dots that never stop orbiting, each at its own pace, and holds still when motion is turned down", async () => {
  // jsdom has no Web Animations; this keeps what each dot is asked to do.
  const orbits: Array<KeyframeAnimationOptions | undefined> = []
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(_: Keyframe[], timing?: KeyframeAnimationOptions) {
      orbits.push(timing)
      return { cancel() {}, effect: { getComputedTiming: () => ({ progress: 0 }) }, updatePlaybackRate() {} }
    },
  })
  await render()
  const dots = document.querySelectorAll('[data-slot="flow-swarm"] > *').length

  expect(dots).toBeGreaterThan(60)
  expect(orbits).toHaveLength(0)

  unmount()
  moving = true
  await render()

  // Two sways per dot, across and down, both endless and sharing that dot's pace alone.
  expect(orbits).toHaveLength(dots * 2)
  expect(orbits.every((timing) => timing?.iterations === Infinity)).toBe(true)
  expect(new Set(orbits.map((timing) => timing?.duration)).size).toBe(dots)
})
