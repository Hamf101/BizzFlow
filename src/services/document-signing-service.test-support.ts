import { createHash } from "node:crypto"

import {
  createBlankTemplateContent,
  type TemplateBlock,
  type TemplateContent
} from "@/types/template"

export type FakeRow = Record<string, unknown>
export type FakeTables = Record<string, FakeRow[]>

type FakeError = { code: string; message: string }
type FakeResult = { data: unknown; error: FakeError | null }
type FakeFilter = (row: FakeRow) => boolean
type FakeOperation = "select" | "insert" | "update" | "delete"

export const ORG_ID = "10000000-0000-4000-8000-000000000001"
export const MANAGER_ID = "20000000-0000-4000-8000-000000000001"
export const DOCUMENT_ID = "30000000-0000-4000-8000-000000000001"
export const RECIPIENT_ONE_ID = "40000000-0000-4000-8000-000000000001"
export const TOKEN_ONE = "token_one_abcdefghijklmnopqrstuvwxyz123456"
export const DRAWING_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAqklEQVR4nOXQyw2EMAwFwLTAbTug/wqztxUCIRYIjBMfIkX52H5Tps9cl6vWWjKtsgbIBvHbZIXYHGSD2L3IAnH4YHSIvx+OCnH6w2gQlz+OAnG7QO8QzQr1CtG8YG8QjxXuBeLxBtEhXmsUFeL1htEgmHwUCAYQBYIDaAgeXEPwwBqCB9UQPKCG4ME0BA+kIXgQDcEDaAg+uIbgA2sIPqiG4ANqCD6YhvgCi4+tg797B8QAAAAASUVORK5CYII="
export const NOW = new Date("2026-07-17T20:00:00.000Z")

class FakeQuery implements PromiseLike<FakeResult> {
  private operation: FakeOperation = "select"
  private payload: FakeRow | FakeRow[] | null = null
  private readonly filters: FakeFilter[] = []
  private orderColumn: string | null = null
  private orderAscending = true

  constructor(
    private readonly tableName: string,
    private readonly tables: FakeTables
  ) {}

  select(): FakeQuery {
    return this
  }

  insert(payload: FakeRow | FakeRow[]): FakeQuery {
    this.operation = "insert"
    this.payload = payload
    return this
  }

  update(payload: FakeRow): FakeQuery {
    this.operation = "update"
    this.payload = payload
    return this
  }

  delete(): FakeQuery {
    this.operation = "delete"
    return this
  }

  eq(column: string, value: unknown): FakeQuery {
    this.filters.push((row: FakeRow): boolean => row[column] === value)
    return this
  }

  neq(column: string, value: unknown): FakeQuery {
    this.filters.push((row: FakeRow): boolean => row[column] !== value)
    return this
  }

  is(column: string, value: unknown): FakeQuery {
    return this.eq(column, value)
  }

  in(column: string, values: readonly unknown[]): FakeQuery {
    this.filters.push((row: FakeRow): boolean => values.includes(row[column]))
    return this
  }

  order(column: string, options: { ascending: boolean }): FakeQuery {
    this.orderColumn = column
    this.orderAscending = options.ascending
    return this
  }

  async single(): Promise<FakeResult> {
    const result = this.execute()
    const rows = result.data as FakeRow[]
    return { data: rows[0] ?? null, error: null }
  }

  async maybeSingle(): Promise<FakeResult> {
    return this.single()
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?:
      ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private execute(): FakeResult {
    const table =
      this.tables[this.tableName] ?? (this.tables[this.tableName] = [])

    if (this.operation === "insert") {
      const payloads = Array.isArray(this.payload)
        ? this.payload
        : [this.payload ?? {}]
      const rows = payloads.map((payload: FakeRow): FakeRow => ({
        ...payload
      }))
      table.push(...rows)
      return { data: rows, error: null }
    }

    const matchingRows = table.filter((row: FakeRow): boolean =>
      this.filters.every((filter: FakeFilter): boolean => filter(row))
    )

    if (this.operation === "update") {
      matchingRows.forEach((row: FakeRow): void => {
        Object.assign(row, this.payload ?? {}, {
          updated_at: "2026-07-17T20:00:00.000Z"
        })
      })
      return { data: matchingRows, error: null }
    }

    if (this.operation === "delete") {
      this.tables[this.tableName] = table.filter(
        (row: FakeRow): boolean => !matchingRows.includes(row)
      )
      return { data: matchingRows, error: null }
    }

    const selectedRows = [...matchingRows]

    if (this.orderColumn) {
      const orderColumn = this.orderColumn
      const direction = this.orderAscending ? 1 : -1
      selectedRows.sort(
        (left: FakeRow, right: FakeRow): number =>
          String(left[orderColumn]).localeCompare(String(right[orderColumn])) *
          direction
      )
    }

    return { data: selectedRows, error: null }
  }
}

/** In-memory Supabase client shared by the signing workflow suites. */
export class FakeClient {
  beforeMergeGeneratedDocumentAnswers?: () => void

  constructor(readonly tables: FakeTables) {}

  /**
   * Starts an in-memory query for a signing table.
   *
   * @param tableName - Table to query.
   * @returns Chainable fake query.
   */
  from(tableName: string): FakeQuery {
    return new FakeQuery(tableName, this.tables)
  }

  /**
   * Emulates the atomic answer-merge and signature-completion functions.
   *
   * @param functionName - Supabase function name.
   * @param args - Function arguments.
   * @returns Fake Supabase RPC result.
   */
  async rpc(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<FakeResult> {
    if (functionName === "merge_generated_document_answers") {
      this.beforeMergeGeneratedDocumentAnswers?.()
      const answer = this.tables.document_answers.find(
        (row: FakeRow): boolean =>
          row.document_id === args.target_document_id &&
          row.org_id === args.target_org_id
      )

      if (!answer) {
        return {
          data: null,
          error: { code: "P0002", message: "Answers were not found." }
        }
      }

      if (answer.workflow_status === "completed") {
        return {
          data: null,
          error: {
            code: "23514",
            message: "Completed document answers are immutable."
          }
        }
      }

      answer.values = {
        ...(answer.values as FakeRow),
        ...(args.target_values as FakeRow)
      }
      answer.updated_at = NOW.toISOString()

      return { data: { ...(answer.values as FakeRow) }, error: null }
    }

    if (functionName !== "complete_document_recipient_signature") {
      throw new Error(`Unsupported fake RPC: ${functionName}`)
    }

    const recipient = this.tables.document_signing_recipients.find(
      (row: FakeRow): boolean =>
        row.id === args.target_recipient_id &&
        row.document_id === args.target_document_id &&
        row.org_id === args.target_org_id &&
        row.token_hash === args.target_token_hash
    )
    const answer = this.tables.document_answers.find(
      (row: FakeRow): boolean =>
        row.document_id === args.target_document_id &&
        row.org_id === args.target_org_id
    )

    if (!recipient || !answer) {
      return { data: null, error: null }
    }

    recipient.status = "signed"
    recipient.viewed_at = recipient.viewed_at ?? NOW.toISOString()
    recipient.signed_at = NOW.toISOString()
    recipient.signature_data = args.target_signature_data
    recipient.initials_data = args.target_initials_data
    answer.values = {
      ...(answer.values as FakeRow),
      ...(args.target_values as FakeRow)
    }
    const hasPendingRequiredRecipient =
      this.tables.document_signing_recipients.some(
        (row: FakeRow): boolean =>
          row.document_id === args.target_document_id &&
          row.org_id === args.target_org_id &&
          row.requires_signature === true &&
          row.status !== "signed"
      )
    answer.workflow_status = hasPendingRequiredRecipient
      ? "awaiting_signatures"
      : "completed"

    return { data: answer.workflow_status, error: null }
  }
}

/**
 * Creates a valid isolated signing database seed.
 *
 * @returns Mutable fake tables for one generated document.
 */
export function createBaseTables(): FakeTables {
  return {
    organization_memberships: [
      {
        org_id: ORG_ID,
        user_id: MANAGER_ID,
        role: "manager",
        status: "active"
      }
    ],
    organizations: [{ id: ORG_ID, name: "BizFlow Studio" }],
    documents: [
      {
        id: DOCUMENT_ID,
        org_id: ORG_ID,
        folder_id: null,
        title: "Professional services agreement",
        description: null,
        source_kind: "generated",
        template_id: null,
        template_revision: null,
        template_snapshot: createTemplateContent(),
        created_by: MANAGER_ID,
        updated_by: MANAGER_ID,
        archived_at: null,
        created_at: "2026-07-17T19:00:00.000Z",
        updated_at: "2026-07-17T19:00:00.000Z"
      }
    ],
    document_answers: [
      {
        document_id: DOCUMENT_ID,
        org_id: ORG_ID,
        values: {},
        workflow_status: "draft",
        created_at: "2026-07-17T19:00:00.000Z",
        updated_at: "2026-07-17T19:00:00.000Z"
      }
    ],
    document_signing_recipients: []
  }
}

/**
 * Creates the guided template snapshot used by signing tests.
 *
 * @param options - Optional initials requirement.
 * @returns Valid template content with one required text field.
 */
export function createTemplateContent(
  options: { requiredInitials?: boolean } = {}
): TemplateContent {
  const content = createBlankTemplateContent()
  const bodyBlocks: TemplateBlock[] = [
    {
      id: "50000000-0000-4000-8000-000000000001",
      type: "text_field",
      fieldKey: "client_name",
      label: "Client legal name",
      required: true,
      helpText: null,
      placeholder: null,
      multiline: false
    }
  ]

  if (options.requiredInitials) {
    bodyBlocks.push({
      id: "50000000-0000-4000-8000-000000000002",
      type: "initials_field",
      fieldKey: "client_initials",
      label: "Client initials",
      required: true,
      helpText: null
    })
  }

  return {
    ...content,
    blocks: bodyBlocks
  }
}

/**
 * Creates one pending signing recipient with a hashed private token.
 *
 * @param id - Recipient identifier.
 * @param token - Raw token to hash for persistence.
 * @param name - Recipient display name.
 * @param email - Recipient email address.
 * @returns Mutable recipient persistence row.
 */
export function createRecipientRow(
  id: string,
  token: string,
  name: string,
  email: string
): FakeRow {
  return {
    id,
    org_id: ORG_ID,
    document_id: DOCUMENT_ID,
    user_id: null,
    name,
    email,
    requires_signature: true,
    status: "pending",
    token_hash: hashToken(token),
    token_expires_at: "2026-07-24T20:00:00.000Z",
    invited_at: "2026-07-17T19:00:00.000Z",
    viewed_at: null,
    signed_at: null,
    signature_data: null,
    initials_data: null
  }
}

/**
 * Hashes a private test token using the production digest algorithm.
 *
 * @param value - Raw token.
 * @returns SHA-256 digest.
 */
export function hashToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
