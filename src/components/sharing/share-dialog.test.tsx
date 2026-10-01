// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import {
  loadSharingAction,
  setSharingAccessAction,
  setSharingInheritanceAction,
} from "@/app/(dashboard)/documents/sharing-actions"
import type { SharingPerson, SharingView } from "@/services/document-service"

import { ShareDialog } from "./share-dialog"

vi.mock("@/app/(dashboard)/documents/sharing-actions", () => ({
  loadSharingAction: vi.fn(),
  setSharingAccessAction: vi.fn(),
  setSharingInheritanceAction: vi.fn(),
}))

const resource = { id: "d1", kind: "document" } as const
const templateResource = { id: "t1", kind: "template" } as const
const person = (userId: string, name: string, role: SharingPerson["role"]): SharingPerson => ({
  email: `${name.toLowerCase()}@example.com`,
  name,
  role,
  userId,
})
const maya = person("u-maya", "Maya", "staff")
const sam = person("u-sam", "Sam", "staff")
const erin = person("u-erin", "Erin", "external_reviewer")
const admin = person("u-admin", "Ada", "owner_admin")

const view = (changes: Partial<SharingView> = {}): SharingView => ({
  grants: [],
  inherit: true,
  inherited: [],
  members: [maya, sam, erin, admin],
  name: "Lease",
  owner: maya,
  parent: null,
  ...changes,
})

const mounted: Root[] = []

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  vi.mocked(setSharingAccessAction).mockReset()
  vi.mocked(setSharingInheritanceAction).mockReset()
})

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

async function open(shown: SharingView, shared: typeof resource | typeof templateResource = resource): Promise<void> {
  vi.mocked(loadSharingAction).mockResolvedValue({ ok: true, view: shown })
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mounted.push(root)
  await act(async () => {
    root.render(createElement(ShareDialog, { name: "Lease", onOpenChange: vi.fn(), open: true, resources: [shared] }))
  })
}

const text = (): string => document.body.textContent ?? ""
const button = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(label)) as HTMLButtonElement

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

describe("ShareDialog", () => {
  it("names the item, its owner, and who always has access", async () => {
    await open(view())

    expect(text()).toContain("Share “Lease”")
    expect(text()).toContain("Maya")
    expect(text()).toContain("Owner, can always edit")
    expect(text()).toContain("Owner admins always have access")
    expect(document.body.textContent).not.toMatch(/\bgrant|ACL|principal/i)
  })

  it("shares with the person who is picked, as a viewer", async () => {
    await open(view())
    vi.mocked(setSharingAccessAction).mockResolvedValue({
      ok: true,
      view: view({ grants: [{ kind: "person", level: "viewer", person: sam }] }),
    })

    await click(button("Sam"))

    expect(setSharingAccessAction).toHaveBeenCalledWith({ level: "viewer", principal: { userId: "u-sam" }, resources: [resource] })
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="Access for Sam"]')?.value).toBe("viewer")
  })

  it("offers neither the owner nor an owner admin, who already have access", async () => {
    await open(view())
    const offered = [...document.querySelectorAll('[aria-label="People you can add"] button')].map((item) => item.textContent)

    expect(offered.some((label) => label?.includes("Maya"))).toBe(false)
    expect(offered.some((label) => label?.includes("Ada"))).toBe(false)
    expect(offered.some((label) => label?.includes("Sam"))).toBe(true)
  })

  it("changes a person to editor and removes them", async () => {
    await open(view({ grants: [{ kind: "person", level: "viewer", person: sam }] }))
    vi.mocked(setSharingAccessAction).mockResolvedValue({
      ok: true,
      view: view({ grants: [{ kind: "person", level: "contributor", person: sam }] }),
    })
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Access for Sam"]') as HTMLSelectElement

    await choose(select, "contributor")
    expect(setSharingAccessAction).toHaveBeenLastCalledWith({ level: "contributor", principal: { userId: "u-sam" }, resources: [resource] })

    await choose(select, "remove")
    expect(setSharingAccessAction).toHaveBeenLastCalledWith({ level: null, principal: { userId: "u-sam" }, resources: [resource] })
  })

  it("lets an external reviewer only view", async () => {
    await open(view({ grants: [{ kind: "person", level: "viewer", person: erin }] }))
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Access for Erin"]') as HTMLSelectElement

    expect([...select.options].map((option) => option.textContent)).toEqual(["Can view only", "Remove access"])
  })

  it("shares with everyone who holds a role", async () => {
    await open(view())
    vi.mocked(setSharingAccessAction).mockResolvedValue({
      ok: true,
      view: view({ grants: [{ kind: "role", level: "viewer", role: "manager" }] }),
    })

    await click(button("Everyone who is a manager"))

    expect(setSharingAccessAction).toHaveBeenCalledWith({ level: "viewer", principal: { role: "manager" }, resources: [resource] })
    expect(text()).toContain("Everyone who is a manager")
  })

  it("turns off what the folder gives, in plain words", async () => {
    await open(
      view({
        inherited: [{ from: "Clients", label: "Everyone who is a manager", level: "contributor" }],
        parent: { id: "f1", name: "Clients" },
      })
    )
    vi.mocked(setSharingInheritanceAction).mockResolvedValue({ ok: true, view: view({ inherit: false, parent: { id: "f1", name: "Clients" } }) })

    expect(text()).toContain("Everyone who is a manager")
    await click(document.querySelector('[role="switch"]') as Element)

    expect(setSharingInheritanceAction).toHaveBeenCalledWith({ inherit: false, resources: [resource] })
    expect(document.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false")
    expect(text()).toContain("Also share with everyone who can open “Clients”")
  })

  it("says why when the change is refused, and keeps what it showed", async () => {
    await open(view())
    vi.mocked(setSharingAccessAction).mockResolvedValue({ message: "You cannot share this.", ok: false })

    await click(button("Sam"))

    expect(document.querySelector('[role="alert"]')?.textContent).toBe("You cannot share this.")
    expect(document.querySelector('select[aria-label="Access for Sam"]')).toBeNull()
  })

  it("titles several items together, and marks a person whose level differs between them", async () => {
    await open(
      view({
        grants: [{ kind: "person", level: "viewer", mixed: true, person: sam }],
        name: "3 items",
        owner: null,
      })
    )

    expect(text()).toContain("Share “3 items”")
    expect(text()).toContain("Only people who can open all of them are listed")
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Access for Sam"]') as HTMLSelectElement
    expect(select.value).toBe("mixed")
    expect(select.selectedOptions[0]?.textContent).toBe("Different on each")
  })

  it("says so when it cannot be opened", async () => {
    vi.mocked(loadSharingAction).mockResolvedValue({ message: "You cannot share this.", ok: false })
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    mounted.push(root)
    await act(async () => {
      root.render(createElement(ShareDialog, { name: "Lease", onOpenChange: vi.fn(), open: true, resources: [resource] }))
    })

    expect(document.querySelector('[role="alert"]')?.textContent).toBe("You cannot share this.")
  })
})

describe("ShareDialog for a template", () => {
  it("offers view, use and edit, and view only to an external reviewer", async () => {
    await open(
      view({ grants: [{ kind: "person", level: "user", person: sam }, { kind: "person", level: "viewer", person: erin }] }),
      templateResource
    )
    const select = (name: string) => document.querySelector<HTMLSelectElement>(`select[aria-label="Access for ${name}"]`) as HTMLSelectElement

    expect([...select("Sam").options].map((option) => option.textContent)).toEqual(["Can view", "Can use", "Can edit", "Remove access"])
    expect(select("Sam").value).toBe("user")
    expect([...select("Erin").options].map((option) => option.textContent)).toEqual(["Can view only", "Remove access"])
  })

  it("changes a person to the level chosen", async () => {
    await open(view({ grants: [{ kind: "person", level: "viewer", person: sam }] }), templateResource)
    vi.mocked(setSharingAccessAction).mockResolvedValue({ ok: true, view: view({ grants: [{ kind: "person", level: "editor", person: sam }] }) })

    await choose(document.querySelector('select[aria-label="Access for Sam"]') as HTMLSelectElement, "editor")

    expect(setSharingAccessAction).toHaveBeenCalledWith({ level: "editor", principal: { userId: "u-sam" }, resources: [templateResource] })
  })

  it("keeps it to chosen people when the switch is on, and says who can open it", async () => {
    await open(view(), templateResource)
    vi.mocked(setSharingInheritanceAction).mockResolvedValue({ ok: true, view: view({ inherit: false }) })

    expect(text()).toContain("Everyone who can see templates can use it")
    expect(text()).not.toContain("From the folder")
    const restrict = document.querySelector('[role="switch"]') as Element
    expect(restrict.getAttribute("aria-checked")).toBe("false")

    await click(restrict)

    expect(setSharingInheritanceAction).toHaveBeenCalledWith({ inherit: false, resources: [templateResource] })
    expect(document.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true")
    expect(text()).toContain("Only you, owner admins and the people below can open it")
  })
})
