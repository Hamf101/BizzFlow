// @vitest-environment jsdom
import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { DashboardNavigation } from "./dashboard-navigation"
import { NavigationPreferencesProvider } from "./navigation-preferences-provider"

const actions = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock("@/app/(dashboard)/navigation-actions", () => ({ updateNavigationAction: actions.save }))
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ prefetch: vi.fn() }) }))
vi.mock("next/link", async () => {
  const { createElement } = await import("react")
  return { default: ({ prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean }) => { void prefetch; return createElement("a", props) } }
})
let root: Root | undefined
beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true })
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.resetAllMocks() })
function mount(canRename = true, order: string[] = [], labels = {}) {
  const container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<NavigationPreferencesProvider organizationId="org-1" initialPreferences={{ labels, order, revision: 0, canRename }}><DashboardNavigation role={canRename ? "owner_admin" : "staff"} /></NavigationPreferencesProvider>))
}
function links(): HTMLAnchorElement[] { return [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Primary navigation"] a')] }
async function contextMenu(href: string): Promise<void> {
  await act(async () => { document.querySelector(`a[href="${href}"]`)?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) })
}
async function clickText(text: string): Promise<void> {
  const element = [...document.querySelectorAll<HTMLElement>('button,[role="menuitem"]')].find((el) => el.textContent?.trim() === text)
  expect(element, `Missing control ${text}`).toBeTruthy()
  await act(async () => element?.click())
}
/** Lays the tabs out 48px apart, since jsdom has no layout of its own. */
function layOutTabs(): Map<string, number> {
  const tops = new Map<string, number>()
  const nav = document.querySelector<HTMLElement>('nav[aria-label="Primary navigation"]')!
  nav.getBoundingClientRect = () => ({ bottom: 400, height: 400, left: 0, right: 200, top: 0, width: 200, x: 0, y: 0, toJSON: () => ({}) })
  document.querySelectorAll<HTMLElement>("[data-navigation-href]").forEach((tab, index) => {
    Object.defineProperty(tab, "offsetTop", { configurable: true, value: index * 48 })
    Object.defineProperty(tab, "offsetHeight", { configurable: true, value: 44 })
    tops.set(tab.dataset.navigationHref ?? "", index * 48)
  })
  return tops
}
function pointer(type: string, clientY: number): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, button: 0, cancelable: true, clientX: 20, clientY })
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "mouse" } })
  return event
}
/** Presses a tab and drops it where another sits, as a mouse would. */
async function drag(from: string, to: string): Promise<void> {
  const tops = layOutTabs()
  const tab = document.querySelector(`a[href="${from}"]`)!
  const startY = (tops.get(from) ?? 0) + 22
  const endY = (tops.get(to) ?? 0) + 22
  for (const [type, y] of [["pointerdown", startY], ["pointermove", endY], ["pointerup", endY]] as const) {
    await act(async () => { tab.dispatchEvent(pointer(type, y)) })
  }
}

describe("sidebar customization interactions", () => {
  it("renders saved order and custom labels while preserving destinations and access filtering", () => {
    mount(false, ["/settings", "/audit-log", "/documents"], { "/documents": "Client files" })
    expect(links()[0].getAttribute("href")).toBe("/settings")
    expect(links()[1].textContent).toBe("Client files")
    expect(links()[1].getAttribute("href")).toBe("/documents")
    expect(links().some((link) => link.getAttribute("href") === "/audit-log")).toBe(false)
  })
  it("offers Rename only to the owner on right-click", async () => {
    mount(false)
    await contextMenu("/documents")
    expect([...document.querySelectorAll('[role="menuitem"]')].some((el) => el.textContent === "Rename")).toBe(false)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it("renames through the owner dialog and retains the destination", async () => {
    mount()
    actions.save.mockResolvedValue({ preferences: { labels: { "/documents": "Client files" }, order: [], revision: 1, canRename: true } })
    await contextMenu("/documents")
    await clickText("Rename")
    const input = document.querySelector<HTMLInputElement>('input[name="label"]')!
    expect(input).toBeTruthy()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Client files")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(document.querySelector('a[href="/documents"]')?.textContent).toBe("Client files")
    expect(actions.save).toHaveBeenCalledWith({ organizationId: "org-1", change: { href: "/documents", label: "Client files", expectedRevision: 0 } })
  })
  it("lets a non-owner drag a tab and restore its saved position after remount", async () => {
    const order = ["/settings", "/dashboard", "/people", "/documents", "/templates", "/submissions", "/tasks"]
    actions.save.mockResolvedValue({ preferences: { labels: {}, order, revision: 0, canRename: false } })
    mount(false)
    await drag("/settings", "/dashboard")
    expect(links()[0].getAttribute("href")).toBe("/settings")
    expect(actions.save.mock.calls[0]?.[0].change).toEqual(order)
    act(() => root?.unmount()); root = undefined; document.body.replaceChildren()
    mount(false, order)
    expect(links()[0].getAttribute("href")).toBe("/settings")
  })
  it("supports keyboard ordering without navigating away", async () => {
    const order = ["/settings", "/dashboard", "/people", "/documents", "/templates", "/submissions", "/tasks"]
    actions.save.mockResolvedValue({ preferences: { labels: {}, order, revision: 0, canRename: false } })
    mount(false, ["/dashboard", "/settings"])
    const settings = document.querySelector<HTMLAnchorElement>('a[href="/settings"]')!
    act(() => settings.focus())
    await act(async () => settings.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true, cancelable: true })))
    expect(links()[0].getAttribute("href")).toBe("/settings")
    expect(document.activeElement).toBe(settings)
    expect(document.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe("/dashboard")
  })

  it("keeps the name and dialog intact when the server rejects a rename", async () => {
    actions.save.mockResolvedValue({ error: "Only the workspace owner can rename tabs." })
    mount()
    await contextMenu("/documents")
    await clickText("Rename")
    await act(async () => document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(document.querySelector('a[href="/documents"]')?.textContent).toBe("Files")
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("Only the workspace owner")
  })

  it("restores the original order and shows an error when saving fails", async () => {
    actions.save.mockResolvedValue({ error: "Unable to save tab order." })
    mount(false)
    await drag("/settings", "/dashboard")
    expect(links()[0].getAttribute("href")).toBe("/dashboard")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Unable to save tab order.")
  })
})
