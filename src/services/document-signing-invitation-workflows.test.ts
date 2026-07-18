import { describe, expect, it, vi } from "vitest"

import {
  completePublicDocumentSigning,
  getPublicDocumentSigningView,
  resendDocumentSigningInvitation,
  sendDocumentForSigning,
} from "@/services/document-signing-service"
import {
  createBaseTables,
  createRecipientRow,
  DOCUMENT_ID,
  DRAWING_DATA_URL,
  FakeClient,
  type FakeRow,
  hashToken,
  MANAGER_ID,
  NOW,
  ORG_ID,
  RECIPIENT_ONE_ID,
  TOKEN_ONE,
} from "@/services/document-signing-service.test-support"

const RECIPIENT_TWO_ID = "40000000-0000-4000-8000-000000000002"
const TOKEN_TWO = "token_two_abcdefghijklmnopqrstuvwxyz123456"

describe("document signing invitation, token, and public workflows", () => {
  it("stores only token hashes and emails each raw private link token", async () => {
    const client = new FakeClient(createBaseTables())
    const sendDocumentSigningEmail = vi.fn(async (): Promise<void> => {})
    const ids = [RECIPIENT_ONE_ID, RECIPIENT_TWO_ID]
    const tokens = [TOKEN_ONE, TOKEN_TWO]

    const result = await sendDocumentForSigning(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        documentId: DOCUMENT_ID,
        recipients: [
          { name: "Avery Morgan", email: "AVERY@example.com" },
          { name: "Jordan Lee", email: "jordan@example.com" },
        ],
      },
      {
        client: client as never,
        createId: (): string => ids.shift()!,
        createToken: (): string => tokens.shift()!,
        now: (): Date => NOW,
        sendDocumentSigningEmail,
      }
    )

    expect(result.workflowStatus).toBe("awaiting_signatures")
    expect(result.recipients).toHaveLength(2)
    expect(client.tables.document_answers[0].workflow_status).toBe(
      "awaiting_signatures"
    )
    expect(
      client.tables.document_signing_recipients.map(
        (row: FakeRow): unknown => row.token_hash
      )
    ).toEqual([hashToken(TOKEN_ONE), hashToken(TOKEN_TWO)])
    expect(JSON.stringify(client.tables)).not.toContain(TOKEN_ONE)
    expect(JSON.stringify(client.tables)).not.toContain(TOKEN_TWO)
    expect(sendDocumentSigningEmail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        recipientEmail: "avery@example.com",
        token: TOKEN_ONE,
      })
    )
  })

  it("rotates and emails a pending recipient link without storing the raw token", async () => {
    const tables = createBaseTables()
    tables.document_signing_recipients.push(
      createRecipientRow(
        RECIPIENT_ONE_ID,
        TOKEN_ONE,
        "Avery Morgan",
        "avery@example.com"
      )
    )
    const client = new FakeClient(tables)
    const sendDocumentSigningEmail = vi.fn(async (): Promise<void> => {})

    const recipient = await resendDocumentSigningInvitation(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        documentId: DOCUMENT_ID,
        recipientId: RECIPIENT_ONE_ID,
      },
      {
        client: client as never,
        createToken: (): string => TOKEN_TWO,
        now: (): Date => NOW,
        sendDocumentSigningEmail,
      }
    )

    expect(recipient.status).toBe("pending")
    expect(tables.document_signing_recipients[0]).toMatchObject({
      token_hash: hashToken(TOKEN_TWO),
      token_expires_at: "2026-07-24T20:00:00.000Z",
      invited_at: NOW.toISOString(),
      status: "pending",
      viewed_at: null,
    })
    expect(JSON.stringify(tables)).not.toContain(TOKEN_TWO)
    expect(sendDocumentSigningEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: RECIPIENT_ONE_ID,
        token: TOKEN_TWO,
      })
    )
  })

  it("rejects an expired private recipient link with the stable gone error", async () => {
    const tables = createBaseTables()
    const recipient = createRecipientRow(
      RECIPIENT_ONE_ID,
      TOKEN_ONE,
      "Avery Morgan",
      "avery@example.com"
    )
    recipient.token_expires_at = "2026-07-17T19:59:59.000Z"
    tables.document_signing_recipients.push(recipient)
    const client = new FakeClient(tables)

    await expect(
      getPublicDocumentSigningView(
        { token: TOKEN_ONE },
        { client: client as never, now: (): Date => NOW }
      )
    ).rejects.toMatchObject({
      statusCode: 410,
      message: "This signing link has expired. Ask the sender for a new link.",
    })
  })

  it("requires every invited party to be a signer", async () => {
    const client = new FakeClient(createBaseTables())

    await expect(
      sendDocumentForSigning(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          documentId: DOCUMENT_ID,
          recipients: [
            {
              name: "Avery Morgan",
              email: "avery@example.com",
              requiresSignature: false,
            },
          ],
        },
        {
          client: client as never,
          createId: (): string => RECIPIENT_ONE_ID,
          createToken: (): string => TOKEN_ONE,
          now: (): Date => NOW,
          sendDocumentSigningEmail: async (): Promise<void> => {},
        }
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("marks a private link viewed without exposing token hashes or co-signer emails", async () => {
    const tables = createBaseTables()
    tables.document_signing_recipients.push(
      createRecipientRow(
        RECIPIENT_ONE_ID,
        TOKEN_ONE,
        "Avery Morgan",
        "avery@example.com"
      ),
      createRecipientRow(
        RECIPIENT_TWO_ID,
        TOKEN_TWO,
        "Jordan Lee",
        "jordan@example.com"
      )
    )
    tables.document_answers[0].workflow_status = "awaiting_signatures"
    const client = new FakeClient(tables)

    const view = await getPublicDocumentSigningView(
      { token: TOKEN_ONE },
      { client: client as never, now: (): Date => NOW }
    )

    expect(view.recipient.email).toBe("avery@example.com")
    expect(view.recipient.status).toBe("viewed")
    expect(view.signers).toEqual([
      expect.objectContaining({ id: RECIPIENT_ONE_ID, name: "Avery Morgan" }),
      expect.objectContaining({ id: RECIPIENT_TWO_ID, name: "Jordan Lee" }),
    ])
    expect(view.signers[1]).not.toHaveProperty("email")
    expect(view).not.toHaveProperty("tokenHash")
    expect(tables.document_signing_recipients[0].status).toBe("viewed")
  })

  it("accepts signatures in any order and completes only after the last required signer", async () => {
    const tables = createBaseTables()
    tables.document_signing_recipients.push(
      createRecipientRow(
        RECIPIENT_ONE_ID,
        TOKEN_ONE,
        "Avery Morgan",
        "avery@example.com"
      ),
      createRecipientRow(
        RECIPIENT_TWO_ID,
        TOKEN_TWO,
        "Jordan Lee",
        "jordan@example.com"
      )
    )
    tables.document_answers[0].workflow_status = "awaiting_signatures"
    const client = new FakeClient(tables)

    const firstView = await completePublicDocumentSigning(
      {
        token: TOKEN_TWO,
        values: { client_name: "Northstar Labs" },
        signatureDataUrl: DRAWING_DATA_URL,
      },
      { client: client as never, now: (): Date => NOW }
    )
    const completedView = await completePublicDocumentSigning(
      {
        token: TOKEN_ONE,
        values: {},
        signatureDataUrl: DRAWING_DATA_URL,
      },
      { client: client as never, now: (): Date => NOW }
    )

    expect(firstView.workflowStatus).toBe("awaiting_signatures")
    expect(completedView.workflowStatus).toBe("completed")
    expect(completedView.answers).toEqual({ client_name: "Northstar Labs" })
    expect(completedView.signers.every((signer) => signer.status === "signed")).toBe(
      true
    )
  })
})
