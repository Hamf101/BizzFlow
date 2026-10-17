import { describe, expect, it, vi } from "vitest"

import type { SendSignedCopyEmailInput } from "@/services/document-signing-email-service"
import { openSignedCopy, sendSignedCopies } from "@/services/document-signing-service"
import {
  createBaseTables,
  createRecipientRow,
  DOCUMENT_ID,
  FakeClient,
  type FakeTables,
  hashToken,
  MANAGER_ID,
  NOW,
  ORG_ID,
  RECIPIENT_ONE_ID,
  TOKEN_ONE,
} from "@/services/document-signing-service.test-support"

const RECIPIENT_TWO_ID = "40000000-0000-4000-8000-000000000002"
const TOKEN_TWO = "token_two_abcdefghijklmnopqrstuvwxyz123456"
const COPY_TOKEN = "copy_token_abcdefghijklmnopqrstuvwxyz12345"
const DOCUMENT = { organizationId: ORG_ID, documentId: DOCUMENT_ID }

// Signed by both; sent by the manager.
function completedTables(): FakeTables {
  const tables = createBaseTables()
  tables.document_answers[0].workflow_status = "completed"
  tables.profiles = [{ id: MANAGER_ID, email: "Manager@Example.com", full_name: "Morgan" }]
  tables.document_signed_copy_links = []
  tables.document_signing_recipients.push(
    { ...createRecipientRow(RECIPIENT_ONE_ID, TOKEN_ONE, "Avery Morgan", "avery@example.com"), status: "signed", sent_by: MANAGER_ID },
    { ...createRecipientRow(RECIPIENT_TWO_ID, TOKEN_TWO, "Jordan Lee", "AVERY@example.com"), status: "signed", sent_by: MANAGER_ID }
  )
  return tables
}

function createDeps(tables: FakeTables, finalized = true) {
  let tokens = 0
  return {
    client: new FakeClient(tables) as never,
    now: (): Date => NOW,
    createToken: (): string => `${COPY_TOKEN}${tokens++}`,
    sendSignedCopyEmail: vi.fn<(input: SendSignedCopyEmailInput) => Promise<void>>(async () => {}),
    recordAuditLog: vi.fn(async (): Promise<void> => {}),
    findFinalizedVersion: vi.fn(async () => (finalized ? { originalFilename: "agreement.pdf", storageKey: "orgs/x/final.pdf" } : null)),
    createSignedDocumentDownloadUrl: vi.fn(async () => ({ downloadUrl: "https://r2.example/signed", expiresInSeconds: 300 })),
  }
}

describe("sendSignedCopies", () => {
  it("emails each address once, the sender included, keeping only hashes, and never twice", async () => {
    const tables = completedTables()
    const deps = createDeps(tables)

    await expect(sendSignedCopies(DOCUMENT, deps)).resolves.toBe(2)

    // Avery's address was given twice in different case: one email.
    const sentTo = deps.sendSignedCopyEmail.mock.calls.map(([input]) => input.recipientEmail)
    expect(sentTo.sort()).toEqual(["avery@example.com", "manager@example.com"])
    const links = tables.document_signed_copy_links
    expect(links).toHaveLength(2)
    expect(JSON.stringify(links)).not.toContain(COPY_TOKEN)
    const [first] = deps.sendSignedCopyEmail.mock.calls[0]
    expect(links.map((link) => link.token_hash)).toContain(hashToken(first.token))

    await expect(sendSignedCopies(DOCUMENT, deps)).resolves.toBe(0)
    expect(deps.sendSignedCopyEmail).toHaveBeenCalledTimes(2)
  })
})

describe("openSignedCopy", () => {
  it("opens the signed copy by its emailed link, or by a signer's own link while it works", async () => {
    const tables = completedTables()
    const deps = createDeps(tables)
    await sendSignedCopies(DOCUMENT, deps)
    const [{ token }] = deps.sendSignedCopyEmail.mock.calls[0]

    await expect(openSignedCopy({ token }, deps)).resolves.toEqual({ downloadUrl: "https://r2.example/signed" })
    await expect(openSignedCopy({ token: TOKEN_TWO }, deps)).resolves.toEqual({ downloadUrl: "https://r2.example/signed" })
    expect(deps.createSignedDocumentDownloadUrl).toHaveBeenCalledWith({ downloadFilename: "agreement.pdf", storageKey: "orgs/x/final.pdf" })
  })

  it("refuses an unknown, expired or spent link, and a copy not ready yet", async () => {
    const tables = completedTables()
    const deps = createDeps(tables)
    await sendSignedCopies(DOCUMENT, deps)
    const [{ token }] = deps.sendSignedCopyEmail.mock.calls[0]

    await expect(openSignedCopy({ token: "no_such_token_abcdefghijklmnopqrstuvwxyz" }, deps)).rejects.toMatchObject({ statusCode: 404 })

    await expect(openSignedCopy({ token }, createDeps(tables, false))).rejects.toMatchObject({ statusCode: 409 })

    tables.document_signed_copy_links.forEach((link) => (link.expires_at = NOW.toISOString()))
    await expect(openSignedCopy({ token }, deps)).rejects.toMatchObject({ statusCode: 410 })

    tables.document_signing_recipients.forEach((row) => (row.revoked_at = NOW.toISOString()))
    await expect(openSignedCopy({ token: TOKEN_TWO }, deps)).rejects.toMatchObject({ statusCode: 404 })

    // A trashed document opens nothing, whichever link.
    const trashed = completedTables()
    trashed.documents[0].lifecycle_state = "trashed"
    await expect(openSignedCopy({ token: TOKEN_TWO }, createDeps(trashed))).rejects.toMatchObject({ statusCode: 404 })

    // A signer whose document is not complete has no copy to open.
    const awaiting = completedTables()
    awaiting.document_answers[0].workflow_status = "awaiting_signatures"
    await expect(openSignedCopy({ token: TOKEN_TWO }, createDeps(awaiting))).rejects.toMatchObject({ statusCode: 409 })
    expect(deps.createSignedDocumentDownloadUrl).not.toHaveBeenCalled()
  })
})
