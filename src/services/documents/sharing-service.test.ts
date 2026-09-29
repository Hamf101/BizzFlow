import { describe, expect, it, vi } from "vitest"

import type { SharingServiceDeps } from "@/services/documents/sharing-contracts"

import type { OrganizationRole } from "@/lib/permissions"
import { SharingFakeClient, type FakeRow } from "@/services/documents/sharing-service.test-support"
import {
  getSharing,
  setSharingAccess,
  setSharingInheritance,
} from "@/services/documents/sharing-service"
import type { OrganizationMember } from "@/types/organization"

const ORG = "10000000-0000-4000-8000-000000000001"
const OTHER_ORG = "10000000-0000-4000-8000-000000000002"
const OWNER = "20000000-0000-4000-8000-000000000001"
const MANAGER = "20000000-0000-4000-8000-000000000002"
const CREATOR = "20000000-0000-4000-8000-000000000003"
const STAFF = "20000000-0000-4000-8000-000000000004"
const REVIEWER = "20000000-0000-4000-8000-000000000005"
const OUTSIDER = "20000000-0000-4000-8000-000000000006"
const ROOT = "30000000-0000-4000-8000-000000000001"
const CLIENTS = "30000000-0000-4000-8000-000000000002"
const PRIVATE_FOLDER = "30000000-0000-4000-8000-000000000003"
const DOC = "40000000-0000-4000-8000-000000000001"

const PEOPLE: ReadonlyArray<readonly [string, OrganizationRole, string]> = [
  [OWNER, "owner_admin", "Olu Owner"],
  [MANAGER, "manager", "Maya Manager"],
  [CREATOR, "staff", "Cara Creator"],
  [STAFF, "staff", "Sam Staff"],
  [REVIEWER, "external_reviewer", "Rae Reviewer"],
]

function members(): OrganizationMember[] {
  return PEOPLE.map(([userId, role, fullName]) => ({
    createdAt: "2026-01-01T00:00:00.000Z",
    email: `${fullName.split(" ")[0]?.toLowerCase()}@example.test`,
    fullName,
    id: `m-${userId}`,
    role,
    status: "active",
    userId,
  }))
}

function tables(): Record<string, FakeRow[]> {
  return {
    document_access_grants: [
      { access_level: "viewer", document_id: DOC, id: "g1", org_id: ORG, organization_role: null, user_id: STAFF },
    ],
    documents: [
      { created_by: CREATOR, folder_id: CLIENTS, id: DOC, org_id: ORG, share_inherit: true, title: "Lease", lifecycle_state: "active" },
    ],
    folder_access_grants: [
      { access_level: "contributor", folder_id: CLIENTS, id: "f1", org_id: ORG, organization_role: "manager", user_id: null },
      { access_level: "viewer", folder_id: ROOT, id: "f2", org_id: ORG, organization_role: null, user_id: REVIEWER },
    ],
    folders: [
      { created_by: OWNER, id: ROOT, name: "Company", org_id: ORG, parent_folder_id: null, share_inherit: true },
      { created_by: OWNER, id: CLIENTS, name: "Clients", org_id: ORG, parent_folder_id: ROOT, share_inherit: true },
      { created_by: OWNER, id: PRIVATE_FOLDER, name: "Private", org_id: ORG, parent_folder_id: ROOT, share_inherit: false },
    ],
    organization_memberships: [
      ...PEOPLE.map(([user_id, role]) => ({ id: `m-${user_id}`, org_id: ORG, role, status: "active", user_id })),
      { id: "m-out", org_id: OTHER_ORG, role: "manager", status: "active", user_id: OUTSIDER },
    ],
  }
}

type Notify = NonNullable<SharingServiceDeps["notify"]>
type Audit = NonNullable<SharingServiceDeps["recordAuditLog"]>

function setup(options: { access?: Record<string, "contributor" | "viewer">; notify?: Notify; audit?: Audit } = {}) {
  const client = new SharingFakeClient(tables(), {
    [`${MANAGER}:${DOC}`]: "contributor",
    [`${STAFF}:${DOC}`]: "viewer",
    ...options.access,
  })
  const notify = options.notify ? vi.fn<Notify>(options.notify) : vi.fn<Notify>(async () => undefined)
  const audit = options.audit ? vi.fn<Audit>(options.audit) : vi.fn<Audit>(async () => undefined)
  const deps = {
    client: client as never,
    createId: () => "50000000-0000-4000-8000-000000000001",
    listMembers: async () => members(),
    notify,
    recordAuditLog: audit,
  }

  return { audit, client, deps, notify }
}

const document = (actorUserId: string) => ({ actorUserId, organizationId: ORG, resource: { id: DOC, kind: "document" as const } })

describe("who may open the Share dialog", () => {
  it("lets the person who made it, a manager and an owner admin", async () => {
    const { deps } = setup()

    for (const actor of [CREATOR, MANAGER, OWNER]) {
      await expect(getSharing(document(actor), deps), actor).resolves.toMatchObject({ name: "Lease" })
    }
  })

  it("refuses someone who can only view it and is not a manager", async () => {
    const { deps } = setup()

    await expect(getSharing(document(STAFF), deps)).rejects.toMatchObject({ statusCode: 403 })
  })

  it("lets anyone who can edit it, even if they did not make it", async () => {
    const { deps } = setup({ access: { [`${STAFF}:${DOC}`]: "contributor" } })

    await expect(getSharing(document(STAFF), deps)).resolves.toMatchObject({ name: "Lease" })
  })

  it("does not admit that it exists to someone who cannot open it, or to another organization", async () => {
    const { deps } = setup()

    await expect(getSharing(document(REVIEWER), deps)).rejects.toMatchObject({ statusCode: 404 })
    await expect(getSharing({ ...document(OUTSIDER), organizationId: ORG }, deps)).rejects.toMatchObject({ statusCode: 404 })
    await expect(getSharing({ ...document(OWNER), organizationId: OTHER_ORG }, deps)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("what the dialog shows", () => {
  it("names the maker, the people and roles it was shared with, and the folder above", async () => {
    const view = await getSharing(document(CREATOR), setup().deps)

    expect(view.owner).toMatchObject({ name: "Cara Creator", userId: CREATOR })
    expect(view.grants).toEqual([{ kind: "person", level: "viewer", person: expect.objectContaining({ name: "Sam Staff", userId: STAFF }) }])
    expect(view.parent).toEqual({ id: CLIENTS, name: "Clients" })
    expect(view.inherit).toBe(true)
    expect(view.members.map((person) => person.name)).toContain("Rae Reviewer")
  })

  it("lists what arrives from the folders above, each with the folder it comes from", async () => {
    const view = await getSharing(document(CREATOR), setup().deps)

    expect(view.inherited).toEqual([
      { from: "Clients", label: "Everyone who is a manager", level: "contributor" },
      { from: "Company", label: "Rae Reviewer", level: "viewer" },
    ])
  })

  it("shows nothing inherited when the document does not take in its folder's sharing", async () => {
    const { deps, client } = setup()
    client.tables.documents[0].share_inherit = false

    const view = await getSharing(document(CREATOR), deps)

    expect(view.inherit).toBe(false)
    expect(view.inherited).toEqual([])
  })

  it("stops at a folder that does not take in what is above it", async () => {
    const { deps, client } = setup()
    client.tables.documents[0].folder_id = PRIVATE_FOLDER
    client.tables.folder_access_grants.push({ access_level: "viewer", folder_id: PRIVATE_FOLDER, id: "f3", org_id: ORG, organization_role: null, user_id: STAFF })

    const view = await getSharing(document(CREATOR), deps)

    expect(view.inherited).toEqual([{ from: "Private", label: "Sam Staff", level: "viewer" }])
  })
})

describe("sharing with a person", () => {
  it("adds them, tells them, and keeps a record", async () => {
    const { audit, client, deps, notify } = setup()

    await setSharingAccess({ ...document(CREATOR), level: "viewer", principal: { userId: MANAGER } }, deps)

    const row = client.tables.document_access_grants.find((grant) => grant.user_id === MANAGER)

    expect(row).toMatchObject({ access_level: "viewer", document_id: DOC, granted_by: CREATOR, org_id: ORG, organization_role: null })
    expect(notify).toHaveBeenCalledWith({
      actorName: "Cara Creator",
      level: "viewer",
      recipientUserId: MANAGER,
      resource: { id: DOC, kind: "document" },
      resourceName: "Lease",
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "document.access_granted", actorUserId: CREATOR, organizationId: ORG, targetId: DOC, targetType: "document" })
    )
  })

  it("changes their level without telling them again", async () => {
    const { client, deps, notify } = setup()

    await setSharingAccess({ ...document(CREATOR), level: "contributor", principal: { userId: STAFF } }, deps)

    expect(client.tables.document_access_grants.filter((grant) => grant.user_id === STAFF)).toHaveLength(1)
    expect(client.tables.document_access_grants.find((grant) => grant.user_id === STAFF)?.access_level).toBe("contributor")
    expect(notify).not.toHaveBeenCalled()
  })

  it("takes the access away and keeps a record", async () => {
    const { audit, client, deps } = setup()

    await setSharingAccess({ ...document(CREATOR), level: null, principal: { userId: STAFF } }, deps)

    expect(client.tables.document_access_grants.some((grant) => grant.user_id === STAFF)).toBe(false)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "document.access_revoked" }))
  })

  it("does not fail the share when the notice cannot be sent", async () => {
    const { client, deps } = setup({ notify: async () => { throw new Error("channel down") } })

    await expect(
      setSharingAccess({ ...document(CREATOR), level: "viewer", principal: { userId: MANAGER } }, deps)
    ).resolves.toBeDefined()
    expect(client.tables.document_access_grants.some((grant) => grant.user_id === MANAGER)).toBe(true)
  })

  it("fails when the record cannot be kept", async () => {
    const { deps } = setup({ audit: async () => { throw new Error("audit down") } })

    await expect(
      setSharingAccess({ ...document(CREATOR), level: "viewer", principal: { userId: MANAGER } }, deps)
    ).rejects.toMatchObject({ statusCode: 500 })
  })

  it("refuses people who are not in the workspace, and people who always have access", async () => {
    const { client, deps } = setup()
    const before = JSON.stringify(client.tables.document_access_grants)

    for (const userId of [OUTSIDER, CREATOR, OWNER]) {
      await expect(setSharingAccess({ ...document(OWNER), level: "viewer", principal: { userId } }, deps), userId).rejects.toMatchObject({ statusCode: 400 })
    }

    expect(JSON.stringify(client.tables.document_access_grants)).toBe(before)
  })

  it("lets an external reviewer view only", async () => {
    const { client, deps } = setup()

    await expect(
      setSharingAccess({ ...document(CREATOR), level: "contributor", principal: { userId: REVIEWER } }, deps)
    ).rejects.toMatchObject({ message: "External reviewers can only view.", statusCode: 400 })
    expect(client.tables.document_access_grants.some((grant) => grant.user_id === REVIEWER)).toBe(false)
  })

  it("refuses everyone who may not share", async () => {
    const { client, deps } = setup()

    await expect(
      setSharingAccess({ ...document(STAFF), level: "contributor", principal: { userId: MANAGER } }, deps)
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(client.writes).toEqual([])
  })
})

describe("sharing with a role", () => {
  it("shares with everyone who holds it, and can take that back", async () => {
    const { client, deps, notify } = setup()

    await setSharingAccess({ ...document(CREATOR), level: "viewer", principal: { role: "staff" } }, deps)
    expect(client.tables.document_access_grants).toContainEqual(expect.objectContaining({ organization_role: "staff", user_id: null, access_level: "viewer" }))
    expect(notify).not.toHaveBeenCalled()

    await setSharingAccess({ ...document(CREATOR), level: null, principal: { role: "staff" } }, deps)
    expect(client.tables.document_access_grants.some((grant) => grant.organization_role === "staff")).toBe(false)
  })

  it("never lets a role above viewer reach external reviewers, or hand out owner access", async () => {
    const { deps } = setup()

    await expect(
      setSharingAccess({ ...document(CREATOR), level: "contributor", principal: { role: "external_reviewer" } }, deps)
    ).rejects.toMatchObject({ statusCode: 400 })
    await expect(
      setSharingAccess({ ...document(CREATOR), level: "viewer", principal: { role: "owner_admin" } }, deps)
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe("whether it takes in the folder's sharing", () => {
  it("turns it off and on, with a record", async () => {
    const { audit, client, deps } = setup()

    const off = await setSharingInheritance({ ...document(CREATOR), inherit: false }, deps)

    expect(client.tables.documents[0].share_inherit).toBe(false)
    expect(off.inherit).toBe(false)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "document.sharing_inheritance_changed", metadata: expect.objectContaining({ inherit: false }) }))

    const on = await setSharingInheritance({ ...document(CREATOR), inherit: true }, deps)
    expect(on.inherit).toBe(true)
  })

  it("is for the people who may share, and no one else", async () => {
    const { client, deps } = setup()

    await expect(setSharingInheritance({ ...document(STAFF), inherit: false }, deps)).rejects.toMatchObject({ statusCode: 403 })
    expect(client.tables.documents[0].share_inherit).toBe(true)
  })
})

describe("a folder is shared the same way", () => {
  const folder = (actorUserId: string) => ({ actorUserId, organizationId: ORG, resource: { id: CLIENTS, kind: "folder" as const } })

  it("adds a person to the folder's own list and reads what it takes in from above", async () => {
    const { audit, client, deps } = setup({ access: { [`${MANAGER}:${CLIENTS}`]: "contributor" } })

    const before = await getSharing(folder(MANAGER), deps)
    expect(before.parent).toEqual({ id: ROOT, name: "Company" })
    expect(before.inherited.map((entry) => entry.label)).toContain("Rae Reviewer")

    await setSharingAccess({ ...folder(MANAGER), level: "viewer", principal: { userId: STAFF } }, deps)

    expect(client.tables.folder_access_grants).toContainEqual(expect.objectContaining({ access_level: "viewer", folder_id: CLIENTS, user_id: STAFF }))
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "folder.access_granted", targetType: "folder" }))
  })
})
