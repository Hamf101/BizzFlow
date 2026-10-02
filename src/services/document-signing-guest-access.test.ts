import { describe, expect, it, vi } from "vitest"

import {
  getGeneratedDocumentSigningView,
  saveGeneratedDocumentAnswers,
  sendDocumentForSigning,
} from "@/services/document-signing-service"
import {
  createBaseTables,
  createRecipientRow,
  DOCUMENT_ID,
  FakeClient,
  MANAGER_ID,
  ORG_ID,
  RECIPIENT_ONE_ID,
  TOKEN_ONE,
} from "@/services/document-signing-service.test-support"

const GUEST = "20000000-0000-4000-8000-000000000009"
const OTHER_DOCUMENT = "30000000-0000-4000-8000-000000000002"
const OTHER_ORG = "10000000-0000-4000-8000-000000000002"
const FOLDER = "60000000-0000-4000-8000-000000000001"

// Someone outside the workspace who accepted a link to DOCUMENT_ID.
function guestTables(level: "contributor" | "viewer" = "viewer") {
  const tables = createBaseTables()
  tables.documents[0].folder_id = FOLDER
  tables.documents.push({ ...tables.documents[0], id: OTHER_DOCUMENT, title: "Payroll" })
  tables.document_signing_recipients.push({
    ...createRecipientRow(RECIPIENT_ONE_ID, TOKEN_ONE, "Avery Morgan", "avery@example.com"),
    user_id: MANAGER_ID,
    viewed_at: "2026-07-17T19:30:00.000Z",
  })
  tables.document_guest_grants = [
    {
      org_id: ORG_ID,
      document_id: DOCUMENT_ID,
      email: "ana@outside.example",
      user_id: GUEST,
      access_level: level,
      accepted_at: "2026-07-17T19:00:00.000Z",
    },
  ]

  return tables
}

const asGuest = (documentId = DOCUMENT_ID, organizationId = ORG_ID) => ({ actorUserId: GUEST, documentId, organizationId })

describe("a guest outside the workspace", () => {
  it("reads only the document they were given, without the workspace's own details", async () => {
    const client = new FakeClient(guestTables())

    const view = await getGeneratedDocumentSigningView(asGuest(), { client: client as never })

    expect(view).toMatchObject({ accessLevel: "viewer", guest: true, organizationName: "BizFlow Studio" })
    expect(view.document).toMatchObject({ createdBy: null, folderId: null, title: "Professional services agreement", updatedBy: null })
    // Signers stay on the page as the paper shows them; who opened their link does not.
    expect(view.recipients).toEqual([expect.objectContaining({ name: "Avery Morgan", userId: null, viewedAt: null })])

    await expect(getGeneratedDocumentSigningView(asGuest(OTHER_DOCUMENT), { client: client as never })).rejects.toMatchObject({
      statusCode: 404,
    })
    await expect(getGeneratedDocumentSigningView(asGuest(DOCUMENT_ID, OTHER_ORG), { client: client as never })).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it("cannot send, fill, or keep reading once the access is removed or the document is trashed", async () => {
    const tables = guestTables("contributor")
    const client = new FakeClient(tables)
    const sendDocumentSigningEmail = vi.fn(async (): Promise<void> => {})

    await expect(
      sendDocumentForSigning(
        { ...asGuest(), recipients: [{ email: "x@example.com", name: "X" }] },
        { client: client as never, sendDocumentSigningEmail }
      )
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(sendDocumentSigningEmail).not.toHaveBeenCalled()
    await expect(
      saveGeneratedDocumentAnswers({ ...asGuest(), values: { client_name: "Guest" } }, { client: client as never })
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(tables.document_answers[0].values).toEqual({})

    tables.documents[0].lifecycle_state = "trashed"
    await expect(getGeneratedDocumentSigningView(asGuest(), { client: client as never })).rejects.toMatchObject({ statusCode: 404 })

    tables.documents[0].lifecycle_state = "active"
    tables.document_guest_grants.length = 0
    await expect(getGeneratedDocumentSigningView(asGuest(), { client: client as never })).rejects.toMatchObject({ statusCode: 404 })
  })

  it("is not a guest until they accept the link", async () => {
    const tables = guestTables()
    Object.assign(tables.document_guest_grants[0], { accepted_at: null, user_id: null })

    await expect(
      getGeneratedDocumentSigningView(asGuest(), { client: new FakeClient(tables) as never })
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
