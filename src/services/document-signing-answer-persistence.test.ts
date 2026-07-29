import { describe, expect, it } from "vitest"

import {
  completePublicDocumentSigning,
  DocumentSigningServiceError,
  getGeneratedDocumentSigningView,
  saveGeneratedDocumentAnswers,
} from "@/services/document-signing-service"
import { DocumentSigningServiceError as InternalDocumentSigningServiceError } from "@/services/document-signing/errors"
import {
  createBaseTables,
  createRecipientRow,
  DOCUMENT_ID,
  DRAWING_DATA_URL,
  FakeClient,
  MANAGER_ID,
  NOW,
  ORG_ID,
  RECIPIENT_ONE_ID,
  TOKEN_ONE,
} from "@/services/document-signing-service.test-support"

describe("document signing answer persistence", () => {
  it("keeps the facade error class identical for instanceof checks", () => {
    expect(DocumentSigningServiceError).toBe(InternalDocumentSigningServiceError)
    expect(new DocumentSigningServiceError("Stable error", 400)).toBeInstanceOf(
      InternalDocumentSigningServiceError
    )
  })

  it("preserves the guided-editor error for uploaded document rows", async () => {
    const tables = createBaseTables()
    tables.documents[0].source_kind = "upload"
    const client = new FakeClient(tables)

    await expect(
      getGeneratedDocumentSigningView(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          documentId: DOCUMENT_ID,
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Uploaded files cannot use the guided signing editor.",
    })
  })

  it("preserves the invalid stored snapshot error", async () => {
    const tables = createBaseTables()
    tables.documents[0].template_snapshot = {}
    const client = new FakeClient(tables)

    await expect(
      getGeneratedDocumentSigningView(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          documentId: DOCUMENT_ID,
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      statusCode: 500,
      message: "Generated document snapshot is invalid.",
    })
  })

  it("allows Viewer access to the generated signing view", async () => {
    const tables = createBaseTables()
    tables.document_effective_access[0].access_level = "viewer"
    const client = new FakeClient(tables)

    const view = await getGeneratedDocumentSigningView(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        documentId: DOCUMENT_ID,
      },
      { client: client as never }
    )

    expect(view.document.id).toBe(DOCUMENT_ID)
    expect(view.accessLevel).toBe("viewer")
  })

  it("allows read-only access to an archived generated document", async () => {
    const tables = createBaseTables()
    tables.documents[0].lifecycle_state = "archived"
    tables.documents[0].archived_at = "2026-07-18T12:00:00.000Z"
    const client = new FakeClient(tables)

    const view = await getGeneratedDocumentSigningView(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        documentId: DOCUMENT_ID,
      },
      { client: client as never }
    )

    expect(view.document.lifecycleState).toBe("archived")
    expect(view.accessLevel).toBe("contributor")
  })

  it("requires Contributor access before saving generated answers", async () => {
    const tables = createBaseTables()
    tables.document_effective_access[0].access_level = "viewer"
    const client = new FakeClient(tables)

    await expect(
      saveGeneratedDocumentAnswers(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          documentId: DOCUMENT_ID,
          values: { client_name: "Denied update" },
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      message: "You cannot fill this document.",
    })

    expect(tables.document_answers[0].values).toEqual({})
  })

  it("hides generated signing views when the actor has no document grant", async () => {
    const tables = createBaseTables()
    tables.document_effective_access = []
    const client = new FakeClient(tables)

    await expect(
      getGeneratedDocumentSigningView(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          documentId: DOCUMENT_ID,
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Document was not found.",
    })
  })

  it("hides generated signing views after the document enters trash", async () => {
    const tables = createBaseTables()
    tables.documents[0].lifecycle_state = "purge_pending"
    const client = new FakeClient(tables)

    await expect(
      getGeneratedDocumentSigningView(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          documentId: DOCUMENT_ID,
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Generated document was not found.",
    })
  })

  it("rejects answer changes after the document leaves active lifecycle", async () => {
    const tables = createBaseTables()
    tables.documents[0].lifecycle_state = "archived"
    tables.documents[0].archived_at = "2026-07-18T12:00:00.000Z"
    const client = new FakeClient(tables)

    await expect(
      saveGeneratedDocumentAnswers(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          documentId: DOCUMENT_ID,
          values: { client_name: "Late update" },
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Archived documents cannot be changed.",
    })

    expect(tables.document_answers[0].values).toEqual({})
  })

  it("merges answer patches atomically without erasing a concurrent value", async () => {
    const tables = createBaseTables()
    tables.document_answers[0].values = { client_name: "Old value" }
    const client = new FakeClient(tables)
    client.beforeMergeGeneratedDocumentAnswers = (): void => {
      tables.document_answers[0].values = {
        client_name: "Old value",
        concurrent_system_value: "Preserve me",
      }
    }

    const view = await saveGeneratedDocumentAnswers(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        documentId: DOCUMENT_ID,
        values: { client_name: "Updated value" },
      },
      { client: client as never }
    )

    expect(view.answers).toEqual({
      client_name: "Updated value",
      concurrent_system_value: "Preserve me",
    })
  })

  it("rejects an answer save when completion wins the row lock", async () => {
    const tables = createBaseTables()
    const client = new FakeClient(tables)
    client.beforeMergeGeneratedDocumentAnswers = (): void => {
      tables.document_answers[0].workflow_status = "completed"
    }

    await expect(
      saveGeneratedDocumentAnswers(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          documentId: DOCUMENT_ID,
          values: { client_name: "Late value" },
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Completed document answers are immutable.",
    })
  })

  it("does not overwrite a fresher answer when the submitted value matches its page baseline", async () => {
    const tables = createBaseTables()
    tables.document_signing_recipients.push(
      createRecipientRow(
        RECIPIENT_ONE_ID,
        TOKEN_ONE,
        "Avery Morgan",
        "avery@example.com"
      )
    )
    tables.document_answers[0].values = { client_name: "Fresh value" }
    tables.document_answers[0].workflow_status = "awaiting_signatures"
    const client = new FakeClient(tables)

    const completedView = await completePublicDocumentSigning(
      {
        token: TOKEN_ONE,
        values: { client_name: "Old value" },
        baselineValues: { client_name: "Old value" },
        signatureDataUrl: DRAWING_DATA_URL,
      },
      { client: client as never, now: (): Date => NOW }
    )

    expect(completedView.workflowStatus).toBe("completed")
    expect(completedView.answers).toEqual({ client_name: "Fresh value" })
    expect(tables.document_answers[0].values).toEqual({
      client_name: "Fresh value",
    })
  })

  it("applies an intentional edit that differs from the submitted page baseline", async () => {
    const tables = createBaseTables()
    tables.document_signing_recipients.push(
      createRecipientRow(
        RECIPIENT_ONE_ID,
        TOKEN_ONE,
        "Avery Morgan",
        "avery@example.com"
      )
    )
    tables.document_answers[0].values = { client_name: "Concurrent value" }
    tables.document_answers[0].workflow_status = "awaiting_signatures"
    const client = new FakeClient(tables)

    const completedView = await completePublicDocumentSigning(
      {
        token: TOKEN_ONE,
        values: { client_name: "Intentional edit" },
        baselineValues: { client_name: "Old page value" },
        signatureDataUrl: DRAWING_DATA_URL,
      },
      { client: client as never, now: (): Date => NOW }
    )

    expect(completedView.answers).toEqual({ client_name: "Intentional edit" })
    expect(tables.document_answers[0].values).toEqual({
      client_name: "Intentional edit",
    })
  })
})
