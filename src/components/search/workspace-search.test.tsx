// @vitest-environment jsdom

import { act } from "react"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { WorkspaceSearch } from "./workspace-search"
import { mount } from "@/test/render"

const push = vi.fn()

// Searching from the Files list, on page 3 of a 25-a-page view.
vi.mock("next/navigation", () => ({
  usePathname: () => "/documents",
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams("size=25&page=3"),
}))

const WHEN = "2026-09-20T10:00:00.000Z"
const LEASE_FILE = { createdAt: WHEN, description: null, id: "file-1", lifecycleState: "active", sourceKind: "upload", title: "Lease — 14 Harbour St", updatedAt: WHEN }
// As the server sends it: a template ahead of a file, although Files is the earlier tab.
const EVERYWHERE = {
  hits: [
    { item: { category: "Leasing", createdAt: WHEN, id: "template-1", status: "published", title: "Lease agreement", updatedAt: WHEN }, kind: "templates" },
    { item: LEASE_FILE, kind: "files" },
  ],
  totals: { files: 3, people: 0, submissions: 0, tasks: 0, templates: 1 },
}
const FILES_ONLY = {
  hits: [
    { item: LEASE_FILE, kind: "files" },
    { item: { ...LEASE_FILE, id: "file-2", title: "Unit 4B lease draft" }, kind: "files" },
  ],
  totals: EVERYWHERE.totals,
}

// Tasks chosen before any words: open ones, soonest due first.
const DUE_SOON = {
  hits: [
    {
      item: { description: null, dueAt: "2026-10-02T17:00:00.000Z", id: "task-1", status: "open", title: "Chase the signed Harbour St lease", updatedAt: WHEN },
      kind: "tasks",
    },
  ],
  totals: { tasks: 1 },
}

let root: Root
const fetchMock = vi.fn(async (url: string) => ({
  json: async () => (url.endsWith("kind=tasks") ? DUE_SOON : url.includes("kind=files") ? FILES_ONLY : EVERYWHERE),
  ok: true,
}))

beforeEach(() => {
  // The box waits for typing to pause; the tests step past that wait.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.stubGlobal("fetch", fetchMock)
  // jsdom lays nothing out, so there is nothing to scroll, and says nothing
  // of the screen: a wide one, where the bar can be carried about.
  Element.prototype.scrollIntoView = () => undefined
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  // Where the bar opens on a 1024 by 768 screen, centred and 13% down, and
  // wherever it is carried from there, as a browser would lay it out: its box
  // and filters 100 high, and the whole bar taller once results show.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const bar = this.closest<HTMLElement>('[data-slot="workspace-search"]')
    const carried = (axis: string): number => Number.parseFloat(bar?.style.getPropertyValue(`--carried-${axis}`) || "0")
    const height = this.dataset.slot === "workspace-search-head" ? 100 : bar?.querySelector('[role="listbox"]') ? 537 : 140

    return DOMRect.fromRect({ height, width: 736, x: 144 + carried("x"), y: 100 + carried("y") })
  })
  localStorage.clear()
  const host = document.createElement("div")
  document.body.append(host)
  root = mount(host)
  act(() => root.render(<WorkspaceSearch role="owner_admin" />))
})

afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fetchMock.mockClear()
  push.mockClear()
})

async function open(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "k", metaKey: true }))
  })
}

async function type(words: string): Promise<void> {
  const box = document.querySelector<HTMLInputElement>('[role="combobox"]')!

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(box, words)
    box.dispatchEvent(new Event("input", { bubbles: true }))
  })
  // Past the pause for typing, and the answer.
  await act(() => vi.advanceTimersByTimeAsync(200))
}

async function press(key: string): Promise<void> {
  await act(async () => {
    document.querySelector('[role="combobox"]')!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }))
  })
}

const options = (): string[] => [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent ?? "")
const preview = (): string => document.querySelector('[data-slot="workspace-search-preview"]')?.textContent ?? ""

it("opens from the keyboard, lists what it finds in the order of the member's tabs, and opens the one chosen", async () => {
  expect(document.querySelector('[role="dialog"]')).toBeNull()

  await open()
  await type("lease")

  expect(fetchMock).toHaveBeenCalledWith("/api/search?q=lease", expect.anything())
  expect(options()).toEqual([expect.stringContaining("Lease — 14 Harbour St"), expect.stringContaining("Lease agreement")])
  expect(preview()).toContain("Uploaded file")

  await press("ArrowDown")
  expect(preview()).toContain("Leasing")

  await press("Enter")
  expect(push).toHaveBeenCalledWith("/templates/template-1/edit")
})

it("shows what the member had lately the moment it opens, and searches from the first letter", async () => {
  await open()
  await act(() => vi.advanceTimersByTimeAsync(200))

  // Nothing typed yet: the recent things, not an empty panel.
  expect(fetchMock).toHaveBeenCalledWith("/api/search?", expect.anything())
  expect(options()).toEqual([expect.stringContaining("Lease — 14 Harbour St"), expect.stringContaining("Lease agreement")])

  await type("l")
  expect(fetchMock).toHaveBeenLastCalledWith("/api/search?q=l", expect.anything())
  // One letter looks only through recent files, so it claims no totals it didn't count.
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toMatch(/Show all \d/)
  expect([...document.querySelectorAll("button[aria-pressed]")].map((pill) => pill.textContent)).toEqual(
    [...document.querySelectorAll("button[aria-pressed]")].map((pill) => pill.textContent?.replace(/\d+$/, ""))
  )
})

it("narrows to one section, whose whole list opens with the same words in the view it was in", async () => {
  await open()
  await type("lease")

  const files = [...document.querySelectorAll("button[aria-pressed]")].find((pill) => pill.textContent?.startsWith("Files"))!
  expect(files.textContent).toBe("Files3")
  await act(async () => (files as HTMLButtonElement).click())
  await act(() => vi.advanceTimersByTimeAsync(200))

  expect(fetchMock).toHaveBeenLastCalledWith("/api/search?kind=files&q=lease", expect.anything())
  expect(options()).toEqual([
    expect.stringContaining("Lease — 14 Harbour St"),
    expect.stringContaining("Unit 4B lease draft"),
    "Show all 3 in Files →",
  ])
  // The page starts again, and the rest of the list's view carries over.
  expect(document.querySelectorAll('[role="option"]')[2]?.getAttribute("href")).toBe("/documents?size=25&q=lease")
})

it("opens a section's own list when it is chosen before any words", async () => {
  await open()

  const tasks = [...document.querySelectorAll("button[aria-pressed]")].find((pill) => pill.textContent === "Tasks")!
  await act(async () => (tasks as HTMLButtonElement).click())
  await act(() => vi.advanceTimersByTimeAsync(200))

  expect(fetchMock).toHaveBeenLastCalledWith("/api/search?kind=tasks", expect.anything())
  expect(document.querySelector('[role="listbox"]')?.textContent).toContain("Due soon")
  expect(options()).toEqual([expect.stringContaining("Chase the signed Harbour St lease"), "Go to Tasks →"])
  expect(document.querySelectorAll('[role="option"]')[1]?.getAttribute("href")).toBe("/tasks")
})

// Pressed, carried by (x, y), drawn there, and let go.
async function carry(from: Element, x: number, y: number): Promise<void> {
  await act(async () => {
    from.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, cancelable: true, clientX: 10, clientY: 10 }))
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10 + x, clientY: 10 + y }))
  })
  await act(async () => {
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 10 + x, clientY: 10 + y }))
  })
}

const hints = (bar: HTMLElement): Element => [...bar.querySelectorAll("span")].find((span) => span.textContent === "Only what you can open")!
const stored = (): unknown => JSON.parse(localStorage.getItem("bizflow.search.place") ?? "null")

it("remembers where it is carried by anything but its controls", async () => {
  await open()
  const bar = document.querySelector<HTMLElement>('[data-slot="workspace-search"]')!

  // Pressing in the box selects its words; the bar stays.
  await carry(document.querySelector('[role="combobox"]')!, 60, 40)
  expect(stored()).toBeNull()

  // Left in the top half, it still opens underneath, held by its top edge.
  await carry(hints(bar), 60, 40)
  expect(stored()).toEqual({ edge: 140, up: false, x: 60 })
})
