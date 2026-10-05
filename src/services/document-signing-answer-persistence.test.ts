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
  createTemplateContent,
  DOCUMENT_ID,
  DRAWING_DATA_URL,
  FakeClient,
  MANAGER_ID,
  NOW,
  ORG_ID,
  RECIPIENT_ONE_ID,
  TOKEN_ONE,
} from "@/services/document-signing-service.test-support"
import { parseTemplateContent, type TemplateContent } from "@/types/template"
import { createQuoteContent } from "@/types/template-calculation.test-support"

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

  it("freezes an answer once a signer has agreed to it", async () => {
    const secondRecipientId = "40000000-0000-4000-8000-000000000002"
    const secondToken = "token_two_abcdefghijklmnopqrstuvwxyz123456"
    const signedTables = () => {
      const tables = createBaseTables()
      tables.document_signing_recipients.push(
        {
          ...createRecipientRow(RECIPIENT_ONE_ID, TOKEN_ONE, "Avery Morgan", "avery@example.com"),
          signed_at: "2026-07-17T19:30:00.000Z",
          status: "signed",
        },
        createRecipientRow(secondRecipientId, secondToken, "Jordan Reyes", "jordan@example.com")
      )
      tables.document_answers[0].values = { client_name: "As signed" }
      tables.document_answers[0].workflow_status = "awaiting_signatures"
      return tables
    }

    const memberTables = signedTables()
    const memberClient = new FakeClient(memberTables)
    await expect(
      saveGeneratedDocumentAnswers(
        {
          actorUserId: MANAGER_ID,
          documentId: DOCUMENT_ID,
          organizationId: ORG_ID,
          values: { client_name: "Changed after signing" },
        },
        { client: memberClient as never }
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(memberTables.document_answers[0].values).toEqual({ client_name: "As signed" })

    // A later signer's change is refused under the answer row's lock, which
    // supabase/tests/signing-and-document-guards-live-rpc.sql proves.

    // Signing on without changing what was agreed still completes.
    const completingTables = signedTables()
    const completingClient = new FakeClient(completingTables)
    const completed = await completePublicDocumentSigning(
      {
        baselineValues: { client_name: "As signed" },
        signatureDataUrl: DRAWING_DATA_URL,
        token: secondToken,
        values: { client_name: "As signed" },
      },
      { client: completingClient as never, now: (): Date => NOW }
    )

    expect(completed.workflowStatus).toBe("completed")
    expect(completingTables.document_answers[0].values).toEqual({ client_name: "As signed" })
  })

  it("takes a drawing only in the sender's own box, from a member, before the document is sent", async () => {
    const tablesWithBoxes = (sent: boolean) => {
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

      if (sent) {
        tables.document_signing_recipients.push(
          createRecipientRow(RECIPIENT_ONE_ID, TOKEN_ONE, "Avery Morgan", "avery@example.com")
        )
        tables.document_answers[0].workflow_status = "awaiting_signatures"
      }
      return tables
    }
    const saveAsMember = (tables: ReturnType<typeof createBaseTables>, values: Record<string, unknown>) =>
      saveGeneratedDocumentAnswers(
        { actorUserId: MANAGER_ID, documentId: DOCUMENT_ID, organizationId: ORG_ID, values },
        { client: new FakeClient(tables) as never }
      )

    const draftTables = tablesWithBoxes(false)
    await saveAsMember(draftTables, { sender_signature: DRAWING_DATA_URL })
    expect(draftTables.document_answers[0].values).toEqual({ sender_signature: DRAWING_DATA_URL })

    // A box with no signer named is Signer 1's, never the sender's.
    await expect(saveAsMember(tablesWithBoxes(false), { client_initials: DRAWING_DATA_URL })).rejects.toMatchObject({ statusCode: 400 })

    const sentTables = tablesWithBoxes(true)
    await expect(saveAsMember(sentTables, { sender_signature: DRAWING_DATA_URL })).rejects.toMatchObject({ statusCode: 409 })
    expect(sentTables.document_answers[0].values).toEqual({})

    for (const key of ["client_initials", "sender_signature"]) {
      const signerTables = tablesWithBoxes(true)
      await expect(
        completePublicDocumentSigning(
          {
            initialsDataUrl: DRAWING_DATA_URL,
            signatureDataUrl: DRAWING_DATA_URL,
            token: TOKEN_ONE,
            values: { [key]: DRAWING_DATA_URL, client_name: "Northstar" },
          },
          { client: new FakeClient(signerTables) as never, now: (): Date => NOW }
        )
      ).rejects.toMatchObject({ statusCode: 400 })
      expect(signerTables.document_answers[0].values).toEqual({})
      expect(signerTables.document_signing_recipients[0].status).toBe("pending")
    }
  })

  it("stores the answers a formula works out as the server works them out, whatever a page or a signer sends", async () => {
    const tables = createBaseTables()
    tables.documents[0].template_snapshot = createQuoteContent()
    tables.document_answers[0].values = {}
    const client = new FakeClient(tables)
    const saved = await saveGeneratedDocumentAnswers(
      { actorUserId: MANAGER_ID, organizationId: ORG_ID, documentId: DOCUMENT_ID, values: { items: [["Desk", "2", "10.00", "1"]], total: "1" } },
      { client: client as never }
    )

    expect(saved.answers).toMatchObject({ items: [["Desk", "2", "10.00", "20.00"]], subtotal: "20.00", vat: "4.00", total: "24.00" })

    tables.document_signing_recipients.push(createRecipientRow(RECIPIENT_ONE_ID, TOKEN_ONE, "Avery Morgan", "avery@example.com"))
    tables.document_answers[0].workflow_status = "awaiting_signatures"

    // A signer who changes the quantity changes the total with it; the page's total counts for nothing.
    const signed = await completePublicDocumentSigning(
      { token: TOKEN_ONE, values: { items: [["Desk", "3", "10.00", ""]], total: "0.01" }, baselineValues: saved.answers, signatureDataUrl: DRAWING_DATA_URL },
      { client: client as never, now: (): Date => NOW }
    )

    expect(tables.document_answers[0].values).toMatchObject({ items: [["Desk", "3", "10.00", "30.00"]], subtotal: "30.00", total: "36.00" })
    expect(signed.answers).toMatchObject({ total: "36.00" })
  })

  it("prunes a stale hidden value at read and across controller patches", async () => {
    const tables = createBaseTables()
    tables.documents[0].template_snapshot = createConditionalSigningSnapshot()
    tables.document_answers[0].values = {
      include_details: false,
      approval_details: "Legacy hidden detail",
    }
    const client = new FakeClient(tables)

    const initialView = await getGeneratedDocumentSigningView(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        documentId: DOCUMENT_ID,
      },
      { client: client as never }
    )

    expect(initialView.answers).toEqual({ include_details: false })

    const shownView = await saveGeneratedDocumentAnswers(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        documentId: DOCUMENT_ID,
        values: { include_details: true },
      },
      { client: client as never }
    )

    expect(shownView.answers).toEqual({ include_details: true })
    expect(tables.document_answers[0].values).toEqual({
      include_details: true,
    })

    const hiddenView = await saveGeneratedDocumentAnswers(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        documentId: DOCUMENT_ID,
        values: {
          include_details: false,
          approval_details: "Submitted stale detail",
        },
      },
      { client: client as never }
    )

    expect(hiddenView.answers).toEqual({ include_details: false })
    expect(tables.document_answers[0].values).toEqual({
      include_details: false,
    })
  })

  it("completes with hidden required fields pruned from stored answers", async () => {
    const tables = createBaseTables()
    tables.documents[0].template_snapshot = createConditionalSigningSnapshot()
    tables.document_signing_recipients.push(
      createRecipientRow(
        RECIPIENT_ONE_ID,
        TOKEN_ONE,
        "Avery Morgan",
        "avery@example.com"
      )
    )
    tables.document_answers[0].values = {
      include_details: false,
      approval_details: "Legacy hidden detail",
    }
    tables.document_answers[0].workflow_status = "awaiting_signatures"
    const client = new FakeClient(tables)

    const completedView = await completePublicDocumentSigning(
      {
        token: TOKEN_ONE,
        values: {
          include_details: false,
          approval_details: "Stale page detail",
        },
        baselineValues: {
          include_details: false,
          approval_details: "Stale page detail",
        },
        signatureDataUrl: DRAWING_DATA_URL,
      },
      { client: client as never, now: (): Date => NOW }
    )

    expect(completedView.workflowStatus).toBe("completed")
    expect(completedView.answers).toEqual({ include_details: false })
    expect(tables.document_answers[0].values).toEqual({
      include_details: false,
    })
  })

  it("requires newly visible fields against the merged public-signing patch", async () => {
    const tables = createBaseTables()
    tables.documents[0].template_snapshot = createConditionalSigningSnapshot()
    tables.document_signing_recipients.push(
      createRecipientRow(
        RECIPIENT_ONE_ID,
        TOKEN_ONE,
        "Avery Morgan",
        "avery@example.com"
      )
    )
    tables.document_answers[0].values = { include_details: false }
    tables.document_answers[0].workflow_status = "awaiting_signatures"
    const client = new FakeClient(tables)

    await expect(
      completePublicDocumentSigning(
        {
          token: TOKEN_ONE,
          values: { include_details: true },
          baselineValues: { include_details: false },
          signatureDataUrl: DRAWING_DATA_URL,
        },
        { client: client as never, now: (): Date => NOW }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message:
        "Approval details must be completed before the final signature.",
    })

    expect(tables.document_answers[0].values).toEqual({
      include_details: false,
    })
  })
})

function createConditionalSigningSnapshot(): TemplateContent {
  const controllerId = "93000000-0000-4000-8000-000000000001"

  return parseTemplateContent({
    schemaVersion: 3,
    branding: {},
    layout: {},
    sections: [],
    fieldGroups: [],
    blockRules: [],
    blocks: [
      {
        id: controllerId,
        type: "checkbox_field",
        fieldKey: "include_details",
        label: "Include details",
        required: false,
        helpText: null,
        checkedByDefault: false,
      },
      {
        id: "93000000-0000-4000-8000-000000000002",
        type: "text_field",
        fieldKey: "approval_details",
        label: "Approval details",
        required: true,
        helpText: null,
        placeholder: null,
        multiline: true,
        visibleWhen: {
          sourceBlockId: controllerId,
          operator: "equals",
          value: true,
        },
      },
      {
        id: "93000000-0000-4000-8000-000000000003",
        type: "initials_field",
        fieldKey: "approval_initials",
        label: "Approval initials",
        required: true,
        helpText: null,
        visibleWhen: {
          sourceBlockId: controllerId,
          operator: "equals",
          value: true,
        },
      },
    ],
  })
}
