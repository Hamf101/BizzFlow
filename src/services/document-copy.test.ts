import { describe, expect, it } from "vitest"

import { createDocumentCopy } from "@/services/template-service"
import {
  createBaseTables,
  createRecipientRow,
  createTemplateContent,
  DOCUMENT_ID,
  DRAWING_DATA_URL,
  FakeClient,
  type FakeRow,
  type FakeTables,
  MANAGER_ID,
  ORG_ID,
  RECIPIENT_ONE_ID,
  TOKEN_ONE,
} from "@/services/document-signing-service.test-support"

const COPY_ID = "30000000-0000-4000-8000-000000000099"

// Signed and done: a client name, the sender's own signature, and Avery's.
function completedTables(): FakeTables {
  const tables = createBaseTables()
  const content = createTemplateContent({ requiredInitials: true })
  content.blocks.push({
    id: "50000000-0000-4000-8000-000000000003",
    type: "signature_field",
    fieldKey: "sender_signature",
    label: "Sender signature",
    required: false,
    helpText: null,
    signer: "sender",
  })
  tables.documents[0].template_snapshot = content
  // As the database grants whoever makes a document.
  tables.document_effective_access.push({ ...tables.document_effective_access[0], document_id: COPY_ID })
  tables.document_answers[0].workflow_status = "completed"
  tables.document_answers[0].values = { client_name: "Acme Ltd", sender_signature: DRAWING_DATA_URL }
  tables.document_signing_recipients.push({
    ...createRecipientRow(RECIPIENT_ONE_ID, TOKEN_ONE, "Avery Morgan", "avery@example.com"),
    status: "signed",
    viewed_at: "2026-07-17T19:10:00.000Z",
    signed_at: "2026-07-17T19:20:00.000Z",
    signature_data: { dataUrl: DRAWING_DATA_URL },
    initials_data: { dataUrl: DRAWING_DATA_URL },
  })
  return tables
}

const copy = (tables: FakeTables) =>
  createDocumentCopy(
    { actorUserId: MANAGER_ID, organizationId: ORG_ID, documentId: DOCUMENT_ID },
    { client: new FakeClient(tables) as never, createId: (): string => COPY_ID }
  )

describe("createDocumentCopy", () => {
  it("makes an unsigned draft of a completed document, with its answers but none of its signatures", async () => {
    const tables = completedTables()
    const original = structuredClone(tables)

    await expect(copy(tables)).resolves.toEqual({ documentId: COPY_ID })

    const made = tables.documents.find((row: FakeRow): boolean => row.id === COPY_ID)
    expect(made).toMatchObject({
      folder_id: null,
      source_kind: "generated",
      template_snapshot: original.documents[0].template_snapshot,
      title: "Professional services agreement (copy)",
    })
    const answers = tables.document_answers.find((row: FakeRow): boolean => row.document_id === COPY_ID)
    expect(answers?.values).toEqual({ client_name: "Acme Ltd" })
    expect(answers?.workflow_status).toBe("draft")
    expect(tables.document_signing_recipients.filter((row: FakeRow): boolean => row.document_id === COPY_ID)).toEqual([])

    // The original is exactly as it was.
    expect(tables.documents[0]).toEqual(original.documents[0])
    expect(tables.document_answers[0]).toEqual(original.document_answers[0])
    expect(tables.document_signing_recipients).toEqual(original.document_signing_recipients)
  })

  it.each([
    ["a member who cannot create documents", 403, (tables: FakeTables) => {
      tables.organization_memberships[0].role = "external_reviewer"
    }],
    ["a member who cannot open the original", 404, (tables: FakeTables) => {
      tables.document_effective_access.shift()
    }],
  ])("makes nothing for %s", async (_case, statusCode, arrange) => {
    const tables = completedTables()
    arrange(tables)

    await expect(copy(tables)).rejects.toMatchObject({ statusCode })
    expect(tables.documents.map((row: FakeRow): unknown => row.id)).toEqual([DOCUMENT_ID])
  })
})
