import { describe, expect, it, vi } from "vitest"

import type { OrganizationRole } from "@/lib/permissions"
import type { SharingServiceDeps } from "@/services/documents/sharing-contracts"
import {
  getSharingMany,
  setSharingAccessMany,
  setSharingInheritanceMany,
} from "@/services/documents/sharing-many"
import { SharingFakeClient, type FakeRow } from "@/services/documents/sharing-service.test-support"
import type { OrganizationMember } from "@/types/organization"

const ORG = "10000000-0000-4000-8000-000000000001"
const CREATOR = "20000000-0000-4000-8000-000000000003"
const STAFF = "20000000-0000-4000-8000-000000000004"
const MANAGER = "20000000-0000-4000-8000-000000000002"
const CLIENTS = "30000000-0000-4000-8000-000000000002"
const ELSEWHERE = "30000000-0000-4000-8000-000000000003"
const A = "40000000-0000-4000-8000-000000000001"
const B = "40000000-0000-4000-8000-000000000002"
const C = "40000000-0000-4000-8000-000000000003"

const PEOPLE: ReadonlyArray<readonly [string, OrganizationRole, string]> = [
  [MANAGER, "manager", "Maya Manager"],
  [CREATOR, "staff", "Cara Creator"],
  [STAFF, "staff", "Sam Staff"],
]

const members = (): OrganizationMember[] =>
  PEOPLE.map(([userId, role, fullName]) => ({
    createdAt: "2026-01-01T00:00:00.000Z",
    email: `${fullName.split(" ")[0]?.toLowerCase()}@example.test`,
    fullName,
    id: `m-${userId}`,
    role,
    status: "active",
    userId,
  }))

const doc = (id: string, title: string, folder: string, maker = CREATOR): FakeRow => ({
  created_by: maker,
  folder_id: folder,
  id,
  lifecycle_state: "active",
  org_id: ORG,
  share_inherit: true,
  title,
})

function setup(access: Record<string, "contributor" | "viewer"> = {}) {
  const client = new SharingFakeClient(
    {
      document_access_grants: [
        { access_level: "viewer", document_id: A, id: "g1", org_id: ORG, organization_role: null, user_id: STAFF },
        { access_level: "contributor", document_id: B, id: "g2", org_id: ORG, organization_role: null, user_id: STAFF },
        { access_level: "viewer", document_id: A, id: "g3", org_id: ORG, organization_role: "manager", user_id: null },
      ],
      documents: [doc(A, "Lease", CLIENTS), doc(B, "Invoice", CLIENTS), doc(C, "Memo", ELSEWHERE)],
      folder_access_grants: [],
      folders: [
        { created_by: CREATOR, id: CLIENTS, name: "Clients", org_id: ORG, parent_folder_id: null, share_inherit: true },
        { created_by: CREATOR, id: ELSEWHERE, name: "Other", org_id: ORG, parent_folder_id: null, share_inherit: true },
      ],
      organization_memberships: PEOPLE.map(([user_id, role]) => ({ id: `m-${user_id}`, org_id: ORG, role, status: "active", user_id })),
    },
    { [`${STAFF}:${A}`]: "viewer", ...access }
  )
  const notify = vi.fn<NonNullable<SharingServiceDeps["notify"]>>(async () => undefined)
  const deps = {
    client: client as never,
    createId: () => "50000000-0000-4000-8000-000000000001",
    listMembers: async () => members(),
    notify,
    recordAuditLog: async () => undefined,
  }
  const many = (actorUserId: string, ...ids: string[]) => ({
    actorUserId,
    organizationId: ORG,
    resources: ids.map((id) => ({ id, kind: "document" as const })),
  })

  return { client, deps, many, notify }
}

describe("what several items have in common", () => {
  it("lists only who has access to all of them, and says when the level differs", async () => {
    const { deps, many } = setup()
    const view = await getSharingMany(many(CREATOR, A, B), deps)

    expect(view.name).toBe("2 items")
    expect(view.owner).toBeNull()
    expect(view.grants).toEqual([
      { kind: "person", level: "viewer", mixed: true, person: expect.objectContaining({ userId: STAFF }) },
    ])
  })

  it("shows the folder they share, and nothing when they sit in different folders", async () => {
    const { deps, many } = setup()

    expect((await getSharingMany(many(CREATOR, A, B), deps)).parent).toEqual({ id: CLIENTS, name: "Clients" })
    expect((await getSharingMany(many(CREATOR, A, C), deps)).parent).toBeNull()
  })

  it("is the item's own sharing when there is only one", async () => {
    const { deps, many } = setup()

    expect((await getSharingMany(many(CREATOR, A), deps)).owner).toMatchObject({ userId: CREATOR })
  })

  it("refuses the whole selection when one item is not theirs to share", async () => {
    const { deps, many } = setup()

    await expect(getSharingMany(many(STAFF, A, B), deps)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("changing several at once", () => {
  it("shares every item with the person, and tells them once", async () => {
    const { client, deps, many, notify } = setup()

    await setSharingAccessMany({ ...many(CREATOR, A, B), level: "viewer", principal: { userId: MANAGER } }, deps)

    const granted = client.tables.document_access_grants.filter((row) => row.user_id === MANAGER)
    expect(granted.map((row) => row.document_id).sort()).toEqual([A, B])
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ count: 2, recipientUserId: MANAGER }))
  })

  it("changes nothing when one item may not be shared by them", async () => {
    // They can edit the first and only view the second: neither may change.
    const { client, deps, many } = setup({ [`${STAFF}:${A}`]: "contributor", [`${STAFF}:${B}`]: "viewer" })

    await expect(
      setSharingAccessMany({ ...many(STAFF, A, B), level: "viewer", principal: { userId: MANAGER } }, deps)
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(client.writes).toEqual([])
  })

  it("takes the access away from all of them", async () => {
    const { client, deps, many } = setup()

    await setSharingAccessMany({ ...many(CREATOR, A, B), level: null, principal: { userId: STAFF } }, deps)

    expect(client.tables.document_access_grants.some((row) => row.user_id === STAFF)).toBe(false)
  })

  it("chooses whether all of them take in their folder's sharing", async () => {
    const { client, deps, many } = setup()

    const view = await setSharingInheritanceMany({ ...many(CREATOR, A, B), inherit: false }, deps)

    expect(view.inherit).toBe(false)
    expect(client.tables.documents.filter((row) => row.share_inherit === false).map((row) => row.id).sort()).toEqual([A, B])
  })
})
