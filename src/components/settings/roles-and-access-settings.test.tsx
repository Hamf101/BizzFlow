// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import type {
  OrganizationMember,
  OrganizationRoleDefinition,
} from "@/types/organization"

import { RolesAndAccessSettings } from "./roles-and-access-settings"

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"
const OWNER_ROLE_ID = "50000000-0000-4000-8000-000000000001"
const MANAGER_ROLE_ID = "50000000-0000-4000-8000-000000000002"
const mountedRoots: Root[] = []

const roles: OrganizationRoleDefinition[] = [
  {
    id: MANAGER_ROLE_ID,
    organizationId: ORGANIZATION_ID,
    systemKey: "manager",
    name: "Manager",
    permissions: ["people:view", "members:invite"],
    archivedAt: null,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
  },
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
]

const members: OrganizationMember[] = [
  {
    id: "membership-owner",
    userId: "user-owner",
    email: "owner@example.com",
    fullName: "Owner Person",
    role: "owner_admin",
    roleDefinitionId: OWNER_ROLE_ID,
    roleName: "Owner",
    status: "active",
    createdAt: "2026-07-01T12:00:00.000Z",
  },
  {
    id: "membership-manager",
    userId: "user-manager",
    email: "manager@example.com",
    fullName: "Manager Person",
    role: "manager",
    roleDefinitionId: MANAGER_ROLE_ID,
    roleName: "Manager",
    status: "active",
    createdAt: "2026-07-01T12:00:00.000Z",
  },
]

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
})

function renderSettings(): void {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mountedRoots.push(root)

  act(() =>
    root.render(
      <RolesAndAccessSettings
        archiveRoleAction={vi.fn()}
        createRoleAction={vi.fn()}
        members={members}
        organizationId={ORGANIZATION_ID}
        roles={roles}
        updateRoleAction={vi.fn()}
      />
    )
  )
}

async function clickByName(name: string): Promise<void> {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name
  )
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected button ${name}.`)
  }
  await act(async () => {
    button.click()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

describe("RolesAndAccessSettings", () => {
  it("shows roles as quiet rows without implementation descriptions", () => {
    renderSettings()

    expect(document.querySelector("#roles-and-access")).not.toBeNull()
    expect(document.body.textContent).toContain("Owner")
    expect(document.body.textContent).toContain("Manager")
    expect(document.body.textContent).toContain("1 person")
    expect(document.body.textContent).not.toContain("Permanent · full access")
    expect(document.body.textContent).not.toContain("Starter role")
    expect(document.body.textContent).not.toContain("actions")
    expect(document.querySelector('[data-slot="card"]')).toBeNull()
    expect(
      [...document.querySelectorAll('[role="list"] > button')].map((button) =>
        button.textContent?.trim()
      )
    ).toEqual(["Owner1 person", "Manager1 person"])
  })

  it("keeps Owner permissions and removal unavailable while allowing its name to change", async () => {
    renderSettings()
    await clickByName("Owner1 person")

    expect(document.querySelector('input[name="name"]')).toBeInstanceOf(HTMLInputElement)
    expect(document.querySelector('input[name="permissionsLocked"]')).not.toBeNull()
    expect(document.querySelector('button[aria-label="Remove Owner role"]')).toBeNull()
    expect(
      [...document.querySelectorAll('[data-slot="switch"]')].every((control) =>
        control.hasAttribute("data-disabled") || control.getAttribute("aria-disabled") === "true"
      )
    ).toBe(true)
  })

  it("lets the owner edit or remove a non-owner starter role", async () => {
    renderSettings()
    await clickByName("Manager1 person")

    expect(document.querySelector('input[name="roleId"]')?.getAttribute("value")).toBe(
      MANAGER_ROLE_ID
    )
    expect(document.querySelector('button[aria-label="Remove Manager role"]')).not.toBeNull()
    expect(document.querySelectorAll('[data-slot="switch"]')).not.toHaveLength(0)
    expect(document.body.textContent).not.toContain(
      "Starter roles can be renamed, edited, or removed."
    )
    expect(document.body.textContent).not.toContain(
      "Reassign active members and invitations before removing this role."
    )
  })

  it("does not offer the member-access permission only an Owner can use", async () => {
    renderSettings()
    await clickByName("Manager1 person")

    expect(document.body.textContent).toContain("Invite people")
    expect(document.body.textContent).not.toContain("Update member access")
  })

  it("starts a new custom role with no permissions selected", async () => {
    renderSettings()
    await clickByName("New role")

    expect(document.body.textContent).toContain("Create role")
    expect(document.querySelector('input[name="name"]')).toBeInstanceOf(HTMLInputElement)
    expect(document.querySelectorAll('[data-slot="switch"][data-checked]')).toHaveLength(0)
  })
})
