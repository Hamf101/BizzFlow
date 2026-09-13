// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import type {
  OrganizationInvite,
  OrganizationMember,
  OrganizationRoleDefinition,
} from "@/types/organization"

import { PeopleWorkspace } from "./people-workspace"

const NOW_ISO = "2026-09-02T12:00:00.000Z"
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"
const OWNER_ROLE_ID = "50000000-0000-4000-8000-000000000001"
const MANAGER_ROLE_ID = "50000000-0000-4000-8000-000000000002"
const STAFF_ROLE_ID = "50000000-0000-4000-8000-000000000003"
const REVIEWER_ROLE_ID = "50000000-0000-4000-8000-000000000004"
const mountedRoots: Root[] = []

const roles: OrganizationRoleDefinition[] = [
  {
    id: OWNER_ROLE_ID,
    organizationId: ORGANIZATION_ID,
    systemKey: "owner_admin",
    name: "Owner",
    permissions: null,
    archivedAt: null,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
  },
  {
    id: MANAGER_ROLE_ID,
    organizationId: ORGANIZATION_ID,
    systemKey: "manager",
    name: "Operations lead",
    permissions: ["people:view", "members:invite"],
    archivedAt: null,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
  },
  {
    id: STAFF_ROLE_ID,
    organizationId: ORGANIZATION_ID,
    systemKey: "staff",
    name: "Staff",
    permissions: ["people:view"],
    archivedAt: null,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
  },
  {
    id: REVIEWER_ROLE_ID,
    organizationId: ORGANIZATION_ID,
    systemKey: "external_reviewer",
    name: "External reviewer",
    permissions: ["people:view"],
    archivedAt: null,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
  },
]

const members: OrganizationMember[] = [
  {
    id: "membership-owner",
    userId: "user-owner",
    email: "avery@acme.test",
    fullName: "Avery Hart",
    role: "owner_admin",
    roleDefinitionId: OWNER_ROLE_ID,
    roleName: "Owner",
    status: "active",
    createdAt: "2026-07-08T12:00:00.000Z",
  },
  {
    id: "membership-manager",
    userId: "user-manager",
    email: "mara@acme.test",
    fullName: "Mara Bell",
    role: "manager",
    roleDefinitionId: MANAGER_ROLE_ID,
    roleName: "Operations lead",
    status: "active",
    createdAt: "2026-08-14T12:00:00.000Z",
  },
  {
    id: "membership-staff",
    userId: "user-staff",
    email: "theo@acme.test",
    fullName: "Theo Miles",
    role: "staff",
    roleDefinitionId: STAFF_ROLE_ID,
    roleName: "Staff",
    status: "active",
    createdAt: "2026-08-22T12:00:00.000Z",
  },
]

const invites: OrganizationInvite[] = [
  {
    id: "invite-active",
    organizationId: ORGANIZATION_ID,
    email: "reviewer@acme.test",
    role: "external_reviewer",
    roleDefinitionId: REVIEWER_ROLE_ID,
    roleName: "External reviewer",
    token: "active-token",
    status: "pending",
    expiresAt: "2026-09-08T12:00:00.000Z",
    createdAt: "2026-09-01T12:00:00.000Z",
  },
  {
    id: "invite-expired",
    organizationId: ORGANIZATION_ID,
    email: "ops@acme.test",
    role: "staff",
    roleDefinitionId: STAFF_ROLE_ID,
    roleName: "Staff",
    token: "expired-token",
    status: "pending",
    expiresAt: "2026-08-24T12:00:00.000Z",
    createdAt: "2026-08-17T12:00:00.000Z",
  },
]

beforeAll(() => {
  ;(
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean
    }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
})

function renderWorkspace(
  overrides: Partial<Parameters<typeof PeopleWorkspace>[0]> = {}
): void {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mountedRoots.push(root)

  act(() =>
    root.render(
      <PeopleWorkspace
        actorRole="owner_admin"
        createInviteAction={vi.fn()}
        currentTime={NOW_ISO}
        invites={invites}
        members={members}
        organizationId={ORGANIZATION_ID}
        roles={roles}
        revokeInviteAction={vi.fn()}
        updateMemberAccessAction={vi.fn()}
        {...overrides}
      />
    )
  )
}

function getButton(name: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name
  )

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected a button named "${name}".`)
  }

  return button
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

async function enterSearch(value: string): Promise<void> {
  const input = document.querySelector('input[aria-label="Search people"]')

  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Expected the people search input.")
  }

  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("PeopleWorkspace", () => {
  it("renders the searchable directory without the old explanatory cards", () => {
    renderWorkspace()

    // A real space keeps the accessible name "People 3 members", not "People3".
    expect(document.querySelector("h1")?.textContent).toBe("People 3")
    expect(document.querySelector('[role="table"]')?.getAttribute("aria-label")).toBe(
      "Organization members"
    )
    expect(document.querySelectorAll('[role="columnheader"]')).toHaveLength(3)
    expect(document.body.textContent).not.toContain(
      "Manage members and pending invites"
    )
    expect(document.body.textContent).not.toContain("SMS Phone Number")
    expect(
      [...document.querySelectorAll("button")].filter(
        (button) => button.textContent?.trim() === "Invite"
      )
    ).toHaveLength(1)
    expect(document.querySelector('[data-slot="people-directory"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="card"]')).toBeNull()
    expect(document.querySelector("h1")?.className).not.toMatch(/font-(?:bold|semibold)/)
    expect(
      document.querySelector('a[href="/settings#roles-and-access"]')?.textContent
    ).toContain("Edit roles and access")
    expect(
      [...document.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("Manage roles")
      )
    ).toBe(false)
    expect(document.body.textContent).toContain("Operations lead")
  })

  it("keeps member details behind a deliberate name-first profile preview", async () => {
    renderWorkspace()

    const trigger = document.querySelector(
      '[data-slot="member-profile-trigger"][data-hover-delay="900"]'
    )
    expect(trigger).toBeInstanceOf(HTMLButtonElement)
    expect(trigger?.textContent).toBe("Avery Hart")
    expect(document.body.textContent).not.toContain("avery@acme.test")

    await act(async () => {
      ;(trigger as HTMLButtonElement).click()
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

    const preview = document.querySelector('[data-slot="member-profile-content"]')
    expect(preview?.textContent).toContain("Avery Hart")
    expect(preview?.textContent).toContain("avery@acme.test")
    expect(preview?.textContent).toContain("Owner")
    expect(preview?.textContent).toContain("Jul 8, 2026")

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
      )
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    expect(
      document.querySelector('[data-slot="member-profile-content"]')
    ).toBeNull()

    await act(async () => {
      ;(trigger as HTMLButtonElement).click()
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    expect(
      document.querySelector('[data-slot="member-profile-content"]')?.textContent
    ).toContain("avery@acme.test")
  })

  it("derives a readable name when a member has not set one yet", () => {
    renderWorkspace({
      members: [
        {
          ...members[0],
          email: "hamisufai@gmail.com",
          fullName: null,
          workspaceDisplayName: null,
        },
      ],
    })

    const trigger = document.querySelector('[data-slot="member-profile-trigger"]')
    expect(trigger?.textContent).toBe("Hamisufai")
    expect(trigger?.textContent).not.toContain("@")
    expect(document.body.textContent).not.toContain("Unnamed member")
  })

  it("uses a compact role selector on mobile without duplicating the desktop filters", () => {
    renderWorkspace()

    const desktopFilters = document.querySelector('[data-slot="desktop-role-filters"]')
    const mobileFilter = document.querySelector('[data-slot="mobile-role-filter"]')

    expect(desktopFilters?.className).toContain("max-md:hidden")
    expect(mobileFilter).toBeInstanceOf(HTMLSelectElement)
    expect(mobileFilter?.className).toContain("md:hidden")
    expect(
      document.querySelector('a[href="/settings#roles-and-access"]')?.className
    ).toContain("whitespace-nowrap")
    expect(
      [...(mobileFilter as HTMLSelectElement).options].map((option) =>
        option.textContent?.trim()
      )
    ).toEqual([
      "All roles · 3",
      "Owner · 1",
      "Operations lead · 1",
      "Staff · 1",
      "External reviewer · 0",
    ])
  })

  it("filters the visible directory by search and role", async () => {
    renderWorkspace()

    await enterSearch("mara")

    expect(document.body.textContent).toContain("Mara Bell")
    expect(document.body.textContent).not.toContain("Avery Hart")
    expect(document.body.textContent).not.toContain("Theo Miles")

    await enterSearch("")
    await click(getButton("Staff1"))

    expect(document.body.textContent).toContain("Theo Miles")
    expect(document.body.textContent).not.toContain("Mara Bell")
  })

  it("searches by an owner-assigned workspace display name", async () => {
    renderWorkspace({
      members: [
        {
          ...members[1],
          workspaceDisplayName: "Client success",
        },
        members[2],
      ],
    })

    await enterSearch("client success")

    expect(document.body.textContent).toContain("Client success")
    expect(document.body.textContent).not.toContain("Theo Miles")
  })

  it("reveals workspace name and role controls only from a member action", async () => {
    renderWorkspace()

    const trigger = document.querySelector('button[aria-label="Manage Mara Bell"]')
    if (!(trigger instanceof HTMLButtonElement)) {
      throw new Error("Expected Mara's member action.")
    }
    await click(trigger)

    const displayName = document.querySelector('input[name="workspaceDisplayName"]')
    const role = document.querySelector('select[name="roleDefinitionId"]')
    expect(displayName).toBeInstanceOf(HTMLInputElement)
    expect((displayName as HTMLInputElement).value).toBe("Mara Bell")
    expect(role).toBeInstanceOf(HTMLSelectElement)
    expect((role as HTMLSelectElement).value).toBe(MANAGER_ROLE_ID)
    expect(document.body.textContent).toContain("Operations lead")
  })

  it("opens one centered invite workspace and progressively reveals expired links", async () => {
    renderWorkspace()

    await click(getButton("Invite"))

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.className).toContain("max-w-xl")
    expect(dialog?.className.split(/\s+/)).toContain("aspect-square")
    expect(document.body.textContent).toContain("Invite people")
    expect(getButton("Phone").disabled).toBe(true)
    expect(getButton("Phone").getAttribute("title")).toContain(
      "SMS invitation delivery"
    )

    await click(getButton("Manage invites1"))

    const activeInvite = document.querySelector('[data-invite-state="active"]')
    const expiredInvites = document.querySelector("details")
    expect(activeInvite?.className).toContain("border-success")
    expect(expiredInvites?.open).toBe(false)
    expect(
      expiredInvites?.querySelector('[data-invite-state="expired"]')?.className
    ).toContain("border-border")

    const summary = expiredInvites?.querySelector("summary")
    if (!(summary instanceof HTMLElement)) {
      throw new Error("Expected an expired invitation disclosure.")
    }
    await click(summary as HTMLButtonElement)
    expect(expiredInvites?.open).toBe(true)

    expect(
      document.querySelector('button[aria-label="Delete invite for reviewer@acme.test"]')
    ).not.toBeNull()
    expect(
      document.querySelector('button[aria-label="Delete expired invite for ops@acme.test"]')
    ).not.toBeNull()
  })

  it("does not expose invitation controls to roles without permission", () => {
    renderWorkspace({ actorRole: "staff", invites: [] })

    expect(document.body.textContent).toContain("People 3")
    expect(
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Invite"
      )
    ).toBe(false)
    expect(document.body.textContent).not.toContain("Manage invites")
    expect(document.querySelector('a[href="/settings#roles-and-access"]')).toBeNull()
  })

  it("offers only roles within the inviter's own access", async () => {
    renderWorkspace({
      actorRole: {
        role: "staff",
        customPermissions: ["people:view", "members:invite"],
      },
    })

    await click(getButton("Invite"))

    const picker = document.querySelector(
      '[role="dialog"] select[name="roleDefinitionId"]'
    )
    expect(picker).toBeInstanceOf(HTMLSelectElement)
    expect(
      [...(picker as HTMLSelectElement).options].map((option) => option.value)
    ).toEqual([STAFF_ROLE_ID])
  })

  it("explains when no role fits within the inviter's access", async () => {
    renderWorkspace({
      actorRole: { role: "external_reviewer", customPermissions: ["members:invite"] },
    })

    await click(getButton("Invite"))

    expect(
      document.querySelector('[role="dialog"] select[name="roleDefinitionId"]')
    ).toBeNull()
    expect(document.body.textContent).toContain(
      "No role fits within your access yet."
    )
  })
})
