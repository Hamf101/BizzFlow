// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { WorkspaceSearch } from "./workspace-search"

const push = vi.fn()

// Searching from the Files list, on page 3 of a 25-a-page view.
vi.mock("next/navigation", () => ({
  usePathname: () => "/documents",
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams("size=25&page=3"),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
  vi.stubGlobal("fetch", fetchMock)
  // jsdom lays nothing out, so there is nothing to scroll, and says nothing
  // of the screen: a wide one, where the bar can be carried about.
  Element.prototype.scrollIntoView = () => undefined
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  // Where the bar opens on a 1024 by 768 screen: centred, its bottom edge
  // 13% up, with room above for results.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ height: 120, width: 736, x: 144, y: 548 })
  )
  localStorage.clear()
  const host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<WorkspaceSearch role="owner_admin" />))
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
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
  await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))
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

it("narrows to one section, whose whole list opens with the same words in the view it was in", async () => {
  await open()
  await type("lease")

  const files = [...document.querySelectorAll("button[aria-pressed]")].find((pill) => pill.textContent?.startsWith("Files"))!
  expect(files.textContent).toBe("Files3")
  await act(async () => (files as HTMLButtonElement).click())
  await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))

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
  // Bare until something is asked, as Spotlight is.
  expect(document.querySelector('[role="listbox"]')).toBeNull()

  const tasks = [...document.querySelectorAll("button[aria-pressed]")].find((pill) => pill.textContent === "Tasks")!
  await act(async () => (tasks as HTMLButtonElement).click())
  await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))

  expect(fetchMock).toHaveBeenLastCalledWith("/api/search?kind=tasks", expect.anything())
  expect(document.querySelector('[role="listbox"]')?.textContent).toContain("Due soon")
  expect(options()).toEqual([expect.stringContaining("Chase the signed Harbour St lease"), "Go to Tasks →"])
  expect(document.querySelectorAll('[role="option"]')[1]?.getAttribute("href")).toBe("/tasks")
})

it("moves when carried by anything but its controls, and opens where it was left", async () => {
  await open()
  const bar = document.querySelector<HTMLElement>('[data-slot="workspace-search"]')!
  const carry = async (from: Element): Promise<void> =>
    act(async () => {
      from.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, cancelable: true, clientX: 10, clientY: 10 }))
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 70, clientY: 50 }))
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 70, clientY: 50 }))
    })

  // Pressing in the box selects its words; the bar stays.
  await carry(document.querySelector('[role="combobox"]')!)
  expect([bar.style.getPropertyValue("--search-x"), bar.style.getPropertyValue("--search-y")]).toEqual(["0px", "0px"])

  await carry([...bar.querySelectorAll("span")].find((span) => span.textContent === "Only what you can open")!)
  expect([bar.style.getPropertyValue("--search-x"), bar.style.getPropertyValue("--search-y")]).toEqual(["60px", "40px"])
  expect(JSON.parse(localStorage.getItem("bizflow.search.place") ?? "null")).toEqual({ x: 60, y: 40 })
})
