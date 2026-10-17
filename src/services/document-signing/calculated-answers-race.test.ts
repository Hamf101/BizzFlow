import { isDeepStrictEqual } from "node:util"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  completePublicDocumentSigning,
  saveGeneratedDocumentAnswers,
} from "@/services/document-signing-service"
import { pruneHiddenAnswerValues } from "@/services/document-signing/answer-validation"
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
import { createBlankTemplateContent, parseTemplateContent, type TemplateContent } from "@/types/template"

const READ = { a: "1", b: "1", total: "2" }

// Total = A + B, worked out by the server from the answers it read.
function createSumContent(): TemplateContent {
  const field = (n: number, label: string, extra: object = {}) => ({
    id: `74000000-0000-4000-8000-00000000000${n}`,
    type: "text_field",
    fieldKey: label.toLowerCase(),
    label,
    required: false,
    helpText: null,
    placeholder: null,
    multiline: false,
    format: "number",
    ...extra,
  })

  return parseTemplateContent({
    ...createBlankTemplateContent(),
    sections: [],
    blocks: [field(1, "A"), field(2, "B"), field(3, "Total", { formula: "{A} + {B}" })],
  })
}

/**
 * The answer functions as the database runs them: under the row lock, a save
 * that names the answers it read is refused once they have changed.
 * `beforeLock` is someone else's save landing between the read and the lock.
 */
class LockingClient extends FakeClient {
  beforeLock?: () => void
  locks = 0

  override async rpc(functionName: string, args: Record<string, unknown>) {
    if (functionName === "merge_generated_document_answers" || functionName === "complete_document_recipient_signature") {
      this.locks += 1
      this.beforeLock?.()
      const stored = pruneHiddenAnswerValues(createSumContent(), this.tables.document_answers[0].values as Record<string, unknown>)

      if (args.target_expected_values != null && !isDeepStrictEqual(stored, args.target_expected_values)) {
        return { data: null, error: { code: "40001", message: "Document answers changed since they were read." } }
      }
    }

    return super.rpc(functionName, args)
  }
}

function createSumTables(): FakeTables {
  const tables = createBaseTables()
  tables.documents[0].template_snapshot = createSumContent()
  tables.document_answers[0].values = { ...READ }
  return tables
}

const save = (client: FakeClient, values: Record<string, unknown>) =>
  saveGeneratedDocumentAnswers({ actorUserId: MANAGER_ID, organizationId: ORG_ID, documentId: DOCUMENT_ID, values }, { client: client as never })

describe("answers a formula works out under concurrent saves", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("works a member's total out again from answers someone else saved meanwhile", async () => {
    const tables = createSumTables()
    const client = new LockingClient(tables)
    // While A = 2 is worked out from A = 1, B = 1, someone saves B = 3.
    client.beforeLock = (): void => {
      client.beforeLock = undefined
      tables.document_answers[0].values = { a: "1", b: "3", total: "4" }
    }

    const view = await save(client, { a: "2" })

    expect(tables.document_answers[0].values).toEqual({ a: "2", b: "3", total: "5" })
    expect(view.answers).toEqual({ a: "2", b: "3", total: "5" })
  })

  it("works a signer's total out again from answers someone else saved meanwhile", async () => {
    const tables = createSumTables()
    tables.document_answers[0].workflow_status = "awaiting_signatures"
    tables.document_signing_recipients.push(createRecipientRow(RECIPIENT_ONE_ID, TOKEN_ONE, "Avery Morgan", "avery@example.com"))
    const client = new LockingClient(tables)
    client.beforeLock = (): void => {
      client.beforeLock = undefined
      tables.document_answers[0].values = { a: "1", b: "3", total: "4" }
    }

    await completePublicDocumentSigning(
      { consented: true, token: TOKEN_ONE, values: { ...READ, a: "2" }, baselineValues: READ, signatureDataUrl: DRAWING_DATA_URL },
      { client: client as never, now: (): Date => NOW }
    )

    expect(tables.document_answers[0].values).toEqual({ a: "2", b: "3", total: "5" })
    expect(tables.document_signing_recipients[0].status).toBe("signed")
  })

  it("gives up after the last try while the answers keep changing", async () => {
    // No pause between tries: only how many there are matters here.
    vi.spyOn(Math, "random").mockReturnValue(0)
    const tables = createSumTables()
    const client = new LockingClient(tables)
    let b = 1
    client.beforeLock = (): void => {
      b += 1
      tables.document_answers[0].values = { a: "1", b: String(b), total: String(1 + b) }
    }

    await expect(save(client, { a: "2" })).rejects.toMatchObject({
      statusCode: 409,
      message: "This document changed while you were saving. Try again.",
    })
    expect(client.locks).toBe(7)
    expect(tables.document_answers[0].values).toEqual({ a: "1", b: "8", total: "9" })
  })

  it("asks no check of a document without formulas", async () => {
    const tables = createBaseTables()
    const client = new LockingClient(tables)
    client.beforeLock = (): void => {
      tables.document_answers[0].values = { client_name: "Someone else" }
    }

    await save(client, { client_name: "Northstar" })

    expect(tables.document_answers[0].values).toEqual({ client_name: "Northstar" })
    expect(client.locks).toBe(1)
  })
})
