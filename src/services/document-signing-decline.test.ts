import { describe, expect, it, vi } from "vitest"

import {
  completePublicDocumentSigning,
  declinePublicDocumentSigning,
  getGeneratedDocumentSigningView,
  getPublicDocumentSigningView,
} from "@/services/document-signing-service"
import {
  createBaseTables,
  createRecipientRow,
  DOCUMENT_ID,
  DRAWING_DATA_URL,
  FakeClient,
  type FakeTables,
  MANAGER_ID,
  NOW,
  ORG_ID,
  RECIPIENT_ONE_ID,
  TOKEN_ONE,
} from "@/services/document-signing-service.test-support"

const RECIPIENT_TWO_ID = "40000000-0000-4000-8000-000000000002"
const TOKEN_TWO = "token_two_abcdefghijklmnopqrstuvwxyz123456"
const SENDER_ID = "20000000-0000-4000-8000-000000000009"
const ACTOR = { actorUserId: MANAGER_ID, organizationId: ORG_ID, documentId: DOCUMENT_ID }

// Sent by Sam to two: Avery has signed, Jordan has opened the link.
function awaitingTables(): FakeTables {
  const tables = createBaseTables()
  tables.document_answers[0].workflow_status = "awaiting_signatures"
  tables.profiles = [{ id: SENDER_ID, email: "sam@example.com", full_name: "Sam Rivera" }]
  tables.document_signing_recipients.push(
    {
      ...createRecipientRow(RECIPIENT_ONE_ID, TOKEN_ONE, "Avery Morgan", "avery@example.com"),
      sent_by: SENDER_ID,
      status: "signed",
      signed_at: "2026-07-17T19:20:00.000Z",
      signature_data: { dataUrl: DRAWING_DATA_URL },
    },
    {
      ...createRecipientRow(RECIPIENT_TWO_ID, TOKEN_TWO, "Jordan Lee", "jordan@example.com"),
      sent_by: SENDER_ID,
      status: "viewed",
      viewed_at: "2026-07-17T19:30:00.000Z",
    }
  )
  return tables
}

function createDeps(tables: FakeTables) {
  return {
    client: new FakeClient(tables) as never,
    now: (): Date => NOW,
    recordAuditLog: vi.fn(async (): Promise<void> => {}),
    sendDocumentSigningCancelledEmail: vi.fn(async (): Promise<void> => {}),
    sendDocumentSigningDeclinedEmail: vi.fn(async (): Promise<void> => {}),
  }
}

describe("declinePublicDocumentSigning", () => {
  it("returns the document to its sender with the reason, and stops every link", async () => {
    const tables = awaitingTables()
    const deps = createDeps(tables)

    await expect(
      declinePublicDocumentSigning({ token: TOKEN_TWO, reason: "  The price is wrong.  " }, deps)
    ).resolves.toEqual({ documentTitle: "Professional services agreement", organizationName: "BizFlow Studio" })

    expect(tables.document_answers[0].workflow_status).toBe("draft")
    expect(tables.document_signing_recipients.every((row) => row.revoked_at === NOW.toISOString())).toBe(true)

    // The sender hears who declined and why; the other signer hears their link stopped.
    expect(deps.sendDocumentSigningDeclinedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: "sam@example.com", declinerName: "Jordan Lee", reason: "The price is wrong." })
    )
    expect(deps.sendDocumentSigningCancelledEmail).toHaveBeenCalledTimes(1)
    expect(deps.sendDocumentSigningCancelledEmail).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: "avery@example.com", signed: true })
    )
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "document.signing_declined", actorUserId: null, targetId: DOCUMENT_ID })
    )

    // The sender sees it on the document too, until it is sent again.
    const view = await getGeneratedDocumentSigningView(ACTOR, deps)
    expect(view.workflowStatus).toBe("draft")
    expect("declined" in view && view.declined).toEqual({
      name: "Jordan Lee",
      reason: "The price is wrong.",
      declinedAt: NOW.toISOString(),
    })

    // The link that declined, and the other one, sign nothing now.
    await expect(getPublicDocumentSigningView({ token: TOKEN_TWO }, deps)).rejects.toMatchObject({ statusCode: 404 })
    await expect(
      completePublicDocumentSigning({ consented: true, token: TOKEN_ONE, values: {}, signatureDataUrl: DRAWING_DATA_URL }, deps)
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("keeps a decline that has no reason, or comes from a signer who signed, from changing anything", async () => {
    const tables = awaitingTables()
    const deps = createDeps(tables)
    const before = JSON.stringify(tables)

    await expect(declinePublicDocumentSigning({ token: TOKEN_TWO, reason: "   " }, deps)).rejects.toMatchObject({ statusCode: 400 })
    await expect(declinePublicDocumentSigning({ token: TOKEN_TWO, reason: "x".repeat(501) }, deps)).rejects.toMatchObject({ statusCode: 400 })
    await expect(declinePublicDocumentSigning({ token: TOKEN_ONE, reason: "Changed my mind" }, deps)).rejects.toMatchObject({ statusCode: 409 })
    await expect(declinePublicDocumentSigning({ token: "not-a-real-token-at-all-0000000000000", reason: "No" }, deps)).rejects.toMatchObject({ statusCode: 404 })

    expect(JSON.stringify(tables)).toBe(before)
    expect(deps.sendDocumentSigningDeclinedEmail).not.toHaveBeenCalled()
  })

  it("still declines when an email cannot be sent", async () => {
    const tables = awaitingTables()
    const deps = createDeps(tables)
    deps.sendDocumentSigningDeclinedEmail.mockRejectedValueOnce(new Error("EmailJS down"))
    vi.spyOn(console, "warn").mockImplementation(() => undefined)

    await declinePublicDocumentSigning({ token: TOKEN_TWO, reason: "Wrong address" }, deps)

    expect(tables.document_answers[0].workflow_status).toBe("draft")
  })
})
