import { describe, expect, it, vi } from "vitest"

import {
  cancelDocumentSigning,
  completePublicDocumentSigning,
  getGeneratedDocumentSigningView,
  getPublicDocumentSigningView,
  sendDocumentForSigning,
  updateGeneratedDocumentContent,
} from "@/services/document-signing-service"
import {
  createBaseTables,
  createRecipientRow,
  createTemplateContent,
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
const RECIPIENT_THREE_ID = "40000000-0000-4000-8000-000000000003"
const TOKEN_TWO = "token_two_abcdefghijklmnopqrstuvwxyz123456"
const TOKEN_THREE = "token_three_abcdefghijklmnopqrstuvwxyz1234"
const OTHER_ORG_ID = "10000000-0000-4000-8000-000000000002"
const ACTOR = { actorUserId: MANAGER_ID, organizationId: ORG_ID, documentId: DOCUMENT_ID }

// Sent to two: Avery has signed, Jordan has opened the link.
function awaitingTables(): FakeTables {
  const tables = createBaseTables()
  tables.document_answers[0].workflow_status = "awaiting_signatures"
  tables.document_answers[0].values = { client_name: "Acme Ltd" }
  tables.document_signing_recipients.push(
    {
      ...createRecipientRow(RECIPIENT_ONE_ID, TOKEN_ONE, "Avery Morgan", "avery@example.com"),
      status: "signed",
      viewed_at: "2026-07-17T19:10:00.000Z",
      signed_at: "2026-07-17T19:20:00.000Z",
      signature_data: { dataUrl: DRAWING_DATA_URL },
    },
    {
      ...createRecipientRow(RECIPIENT_TWO_ID, TOKEN_TWO, "Jordan Lee", "jordan@example.com"),
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
    sendDocumentSigningEmail: vi.fn(async (): Promise<void> => {}),
  }
}

describe("cancelDocumentSigning", () => {
  it("takes a sent document back to an editable draft, dropping every signature but keeping the answers", async () => {
    const tables = awaitingTables()
    const deps = createDeps(tables)

    await expect(cancelDocumentSigning(ACTOR, deps)).resolves.toEqual({ cancelledSignatures: 1 })

    expect(tables.document_answers[0]).toMatchObject({ workflow_status: "draft", values: { client_name: "Acme Ltd" } })
    expect(tables.document_signing_recipients.every((row) => row.revoked_at === NOW.toISOString())).toBe(true)

    // The signers, and the drawing Avery made, are gone from the document.
    const view = await getGeneratedDocumentSigningView(ACTOR, deps)
    expect(view.workflowStatus).toBe("draft")
    expect(view.recipients).toEqual([])
    expect(JSON.stringify(view)).not.toContain(DRAWING_DATA_URL)

    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "document.signing_cancelled", organizationId: ORG_ID, targetId: DOCUMENT_ID, targetType: "document" })
    )
    expect(deps.sendDocumentSigningCancelledEmail).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: "avery@example.com", documentTitle: "Professional services agreement" })
    )
    expect(deps.sendDocumentSigningCancelledEmail).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: "jordan@example.com" }))

    // Its words can change again.
    await expect(
      updateGeneratedDocumentContent(
        { ...ACTOR, expectedUpdatedAt: "2026-07-17T19:00:00.000Z", title: "Revised agreement", content: createTemplateContent() },
        deps
      )
    ).resolves.toMatchObject({ title: "Revised agreement" })
  })

  it("stays cancelled when an email fails to go out", async () => {
    const tables = awaitingTables()
    const deps = createDeps(tables)
    deps.sendDocumentSigningCancelledEmail.mockRejectedValueOnce(new Error("EmailJS is down"))

    await expect(cancelDocumentSigning(ACTOR, deps)).resolves.toEqual({ cancelledSignatures: 1 })
    expect(tables.document_answers[0].workflow_status).toBe("draft")
  })

  it.each([
    ["a completed document", 409, (tables: FakeTables) => {
      tables.document_answers[0].workflow_status = "completed"
    }],
    ["a draft that was never sent", 409, (tables: FakeTables) => {
      tables.document_answers[0].workflow_status = "draft"
      tables.document_signing_recipients.length = 0
    }],
    ["a member without send rights", 403, (tables: FakeTables) => {
      tables.organization_memberships[0].role = "external_reviewer"
    }],
    ["a member who only views the document", 403, (tables: FakeTables) => {
      tables.document_effective_access[0].access_level = "viewer"
    }],
  ])("refuses %s and changes nothing", async (_case, statusCode, arrange) => {
    const tables = awaitingTables()
    arrange(tables)
    const before = structuredClone(tables)
    const deps = createDeps(tables)

    await expect(cancelDocumentSigning(ACTOR, deps)).rejects.toMatchObject({ statusCode })
    expect(tables).toEqual(before)
    expect(deps.sendDocumentSigningCancelledEmail).not.toHaveBeenCalled()
    expect(deps.recordAuditLog).not.toHaveBeenCalled()
  })

  it("does not find another organization's document", async () => {
    const tables = awaitingTables()
    tables.organization_memberships.push({ org_id: OTHER_ORG_ID, user_id: MANAGER_ID, role: "owner_admin", status: "active" })
    const before = structuredClone(tables)

    await expect(cancelDocumentSigning({ ...ACTOR, organizationId: OTHER_ORG_ID }, createDeps(tables))).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(tables).toEqual(before)
  })

  it("refuses a cancelled link everywhere, even after the same signer is sent the document again", async () => {
    const tables = awaitingTables()
    const deps = createDeps(tables)
    await cancelDocumentSigning(ACTOR, deps)

    await expect(getPublicDocumentSigningView({ token: TOKEN_TWO }, deps)).rejects.toMatchObject({ statusCode: 404 })
    expect(tables.document_signing_recipients[1].status).toBe("viewed")

    await sendDocumentForSigning(
      { ...ACTOR, recipients: [{ name: "Jordan Lee", email: "jordan@example.com" }] },
      { ...deps, createId: (): string => RECIPIENT_THREE_ID, createToken: (): string => TOKEN_THREE }
    )
    const sign = (token: string) =>
      completePublicDocumentSigning({ token, values: {}, signatureDataUrl: DRAWING_DATA_URL }, deps)

    await expect(sign(TOKEN_TWO)).rejects.toMatchObject({ statusCode: 404 })
    await expect(sign(TOKEN_THREE)).resolves.toMatchObject({ workflowStatus: "completed", signers: [{ id: RECIPIENT_THREE_ID }] })
  })
})
