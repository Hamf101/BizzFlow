import { describe, expect, it } from "vitest"

import { updateGeneratedDocumentContent } from "@/services/document-signing-service"
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
import { createEmptyDocumentContent } from "@/types/template"

// The base document's `updated_at`, as the editor loaded it.
const LOADED_AT = "2026-07-17T19:00:00.000Z"

function createInput(
  overrides: Partial<Parameters<typeof updateGeneratedDocumentContent>[0]> = {}
): Parameters<typeof updateGeneratedDocumentContent>[0] {
  const content = createEmptyDocumentContent()
  content.blocks = [
    {
      id: "60000000-0000-4000-8000-000000000001",
      type: "paragraph",
      text: "Rent is due on the first day of each month.",
      alignment: "left",
    },
  ]

  return {
    actorUserId: MANAGER_ID,
    organizationId: ORG_ID,
    documentId: DOCUMENT_ID,
    expectedUpdatedAt: LOADED_AT,
    title: "Flat 3 lease",
    content,
    ...overrides,
  }
}

describe("generated document content", () => {
  it("saves a draft's title and page, and returns the version to save from next", async () => {
    const tables = createBaseTables()

    const saved = await updateGeneratedDocumentContent(createInput(), {
      client: new FakeClient(tables) as never,
    })

    expect(saved).toEqual({ title: "Flat 3 lease", updatedAt: "2026-07-17T20:00:00.000Z" })
    expect(tables.documents[0]).toMatchObject({ title: "Flat 3 lease", updated_by: MANAGER_ID })
    expect(tables.documents[0].template_snapshot).toMatchObject({
      blocks: [{ text: "Rent is due on the first day of each month." }],
      layout: { printedTitle: { mode: "none" } },
    })
  })

  it("keeps what signers were sent", async () => {
    const tables = createBaseTables()
    const sent = tables.documents[0].template_snapshot
    tables.document_answers[0].workflow_status = "awaiting_signatures"
    tables.document_signing_recipients.push(
      createRecipientRow(RECIPIENT_ONE_ID, TOKEN_ONE, "Avery Morgan", "avery@example.com")
    )

    await expect(
      updateGeneratedDocumentContent(createInput(), { client: new FakeClient(tables) as never })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(tables.documents[0].template_snapshot).toBe(sent)
  })

  it("refuses a save made from an older copy, so another person's work stays", async () => {
    const tables = createBaseTables()

    await expect(
      updateGeneratedDocumentContent(createInput({ expectedUpdatedAt: "2026-07-17T18:00:00.000Z" }), {
        client: new FakeClient(tables) as never,
      })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(tables.documents[0].title).toBe("Professional services agreement")
  })

  it("lets only contributors edit, and only with valid content", async () => {
    const viewer = createBaseTables()
    viewer.document_effective_access[0].access_level = "viewer"

    await expect(
      updateGeneratedDocumentContent(createInput(), { client: new FakeClient(viewer) as never })
    ).rejects.toMatchObject({ statusCode: 403 })

    const contributor = createBaseTables()

    await expect(
      updateGeneratedDocumentContent(createInput({ content: { schemaVersion: 3, blocks: "none" } }), {
        client: new FakeClient(contributor) as never,
      })
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(contributor.documents[0].title).toBe("Professional services agreement")
  })
})
