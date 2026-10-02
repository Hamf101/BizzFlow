import { describe, expect, it, vi } from "vitest"

import { hashToken } from "@/services/document-signing/token-security"
import { acceptDocumentGuestInvite, findGuestDocument, listGuestDocuments, readPersonName } from "@/services/documents/guest-service"
import { type FakeRow, SharingFakeClient } from "@/services/documents/sharing-service.test-support"

const ORG = "10000000-0000-4000-8000-000000000001"
const INVITER = "20000000-0000-4000-8000-000000000001"
const GUEST = "20000000-0000-4000-8000-000000000009"
const DOC = "40000000-0000-4000-8000-000000000001"
const TOKEN = "g".repeat(43)
const NOW = new Date("2026-10-02T12:00:00.000Z")

function setup(overrides: { document?: FakeRow; grant?: FakeRow } = {}) {
  const client = new SharingFakeClient({
    document_guest_grants: [
      {
        id: "70000000-0000-4000-8000-000000000001",
        org_id: ORG,
        document_id: DOC,
        email: "ana@outside.example",
        user_id: null,
        access_level: "viewer",
        invite_token_hash: hashToken(TOKEN),
        invite_expires_at: "2026-10-05T12:00:00.000Z",
        invited_by: INVITER,
        accepted_at: null,
        ...overrides.grant,
      },
    ],
    documents: [
      { id: DOC, org_id: ORG, title: "Lease", source_kind: "generated", lifecycle_state: "active", ...overrides.document },
    ],
    organizations: [{ id: ORG, name: "Harbor Realty" }],
  })
  const recordAuditLog = vi.fn(async () => undefined)
  const deps = { client: client as never, now: () => NOW, recordAuditLog }

  return { client, deps, recordAuditLog }
}

const accept = (userEmail: string, deps: ReturnType<typeof setup>["deps"]) =>
  acceptDocumentGuestInvite({ token: TOKEN, userEmail, userId: GUEST }, deps)

describe("accepting a document invite", () => {
  it("works once, for the invited address only, and then opens the document to that account", async () => {
    const { client, deps, recordAuditLog } = setup()

    await expect(accept("someone@else.example", deps)).rejects.toMatchObject({ statusCode: 403 })
    expect(client.tables.document_guest_grants[0].user_id).toBeNull()
    await expect(findGuestDocument({ documentId: DOC, userId: GUEST }, deps)).resolves.toBeNull()

    await expect(accept(" ANA@outside.example ", deps)).resolves.toEqual({ documentId: DOC })
    // A new account has no profile until now; the grant and the audit entry both point at one.
    expect(client.tables.profiles).toEqual([{ email: "ana@outside.example", id: GUEST }])
    expect(client.tables.document_guest_grants[0]).toMatchObject({
      accepted_at: NOW.toISOString(),
      invite_token_hash: null,
      user_id: GUEST,
    })
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "document.guest_joined", actorUserId: GUEST, organizationId: ORG, targetId: DOC })
    )
    await expect(findGuestDocument({ documentId: DOC, userId: GUEST }, deps)).resolves.toEqual({
      accessLevel: "viewer",
      organizationId: ORG,
      organizationName: "Harbor Realty",
      sourceKind: "generated",
      title: "Lease",
    })

    // The link is spent: the same token finds nothing.
    await expect(accept("ana@outside.example", deps)).rejects.toMatchObject({ statusCode: 404 })
  })

  it("refuses an expired link, and a link to a document in the trash, without joining", async () => {
    const expired = setup({ grant: { invite_expires_at: NOW.toISOString() } })
    await expect(accept("ana@outside.example", expired.deps)).rejects.toMatchObject({ statusCode: 410 })

    const trashed = setup({ document: { lifecycle_state: "trashed" } })
    await expect(accept("ana@outside.example", trashed.deps)).rejects.toMatchObject({ statusCode: 404 })
    expect(trashed.client.tables.document_guest_grants[0].user_id).toBeNull()
  })

  it("rejects a malformed token before looking anything up", async () => {
    const { client, deps } = setup()

    await expect(
      acceptDocumentGuestInvite({ token: "short", userEmail: "ana@outside.example", userId: GUEST }, deps)
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(client.writes).toEqual([])
  })

  it("stops showing a document to its guest once it is trashed or their access is removed", async () => {
    const joined = { accepted_at: NOW.toISOString(), invite_expires_at: null, invite_token_hash: null, user_id: GUEST }

    const trashed = setup({ document: { lifecycle_state: "trashed" }, grant: joined })
    await expect(findGuestDocument({ documentId: DOC, userId: GUEST }, trashed.deps)).resolves.toBeNull()

    const revoked = setup({ grant: joined })
    revoked.client.tables.document_guest_grants.length = 0
    await expect(findGuestDocument({ documentId: DOC, userId: GUEST }, revoked.deps)).resolves.toBeNull()
  })
})

describe("what a guest has", () => {
  it("lists the documents shared with them that still open, newest first, and nothing still waiting on a link", async () => {
    const joined = { accepted_at: "2026-10-01T09:00:00.000Z", invite_expires_at: null, invite_token_hash: null, user_id: GUEST }
    const { client, deps } = setup({ grant: joined })
    client.tables.documents.push(
      { id: "40000000-0000-4000-8000-000000000002", org_id: ORG, title: "Quote", source_kind: "upload", lifecycle_state: "archived" },
      { id: "40000000-0000-4000-8000-000000000003", org_id: ORG, title: "Old", source_kind: "generated", lifecycle_state: "trashed" },
      { id: "40000000-0000-4000-8000-000000000004", org_id: ORG, title: "Pending", source_kind: "generated", lifecycle_state: "active" }
    )
    client.tables.document_guest_grants.push(
      { ...client.tables.document_guest_grants[0], access_level: "viewer", accepted_at: "2026-10-02T09:00:00.000Z", document_id: "40000000-0000-4000-8000-000000000002", id: "g2" },
      { ...client.tables.document_guest_grants[0], document_id: "40000000-0000-4000-8000-000000000003", id: "g3" },
      { ...client.tables.document_guest_grants[0], accepted_at: null, document_id: "40000000-0000-4000-8000-000000000004", id: "g4", user_id: null }
    )

    await expect(listGuestDocuments(GUEST, deps)).resolves.toEqual([
      { accessLevel: "viewer", documentId: "40000000-0000-4000-8000-000000000002", organizationName: "Harbor Realty", sourceKind: "upload", title: "Quote" },
      { accessLevel: "viewer", documentId: DOC, organizationName: "Harbor Realty", sourceKind: "generated", title: "Lease" },
    ])
    await expect(listGuestDocuments(INVITER, deps)).resolves.toEqual([])
  })

  it("names them as they named themselves, or not at all", async () => {
    const { client, deps } = setup()
    client.tables.profiles = [{ email: "ana@outside.example", full_name: " Ana Silva ", id: GUEST }]

    await expect(readPersonName(GUEST, deps)).resolves.toBe("Ana Silva")
    await expect(readPersonName(INVITER, deps)).resolves.toBeNull()
  })
})
