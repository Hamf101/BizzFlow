import { vi } from "vitest"

import type { PublicFormServiceDeps } from "@/services/public-form-service"
import { templateContentV3Schema } from "@/types/template"

export const ORG_ID = "10000000-0000-4000-8000-000000000001"
export const OTHER_ORG_ID = "10000000-0000-4000-8000-000000000009"
export const TEMPLATE_ID = "20000000-0000-4000-8000-000000000001"
export const LINK_ID = "30000000-0000-4000-8000-000000000001"
export const SUBMISSION_ID = "40000000-0000-4000-8000-000000000001"
export const FILE_ID = "50000000-0000-4000-8000-000000000001"
export const MANAGER_ID = "60000000-0000-4000-8000-000000000001"

export const PUBLIC_TOKEN = "public-token-0123456789abcdef"
export const DRAFT_TOKEN = "a".repeat(64)
export const OTHER_DRAFT_TOKEN = "b".repeat(64)
export const CHECKSUM = "c".repeat(64)

export const FROZEN_NOW = "2026-07-31T12:00:00.000Z"

/**
 * The exact set of relations this service is allowed to touch.
 *
 * The fake throws on anything else, so a query against a table that does not
 * exist in the schema fails the test instead of silently resolving — the class
 * of bug that let `templates` (the real relation is `document_templates`) ship.
 */
const KNOWN_TABLES = [
  "document_templates",
  "public_form_links",
  "organizations",
  "submissions",
  "submission_files",
] as const

export type FakeTableName = (typeof KNOWN_TABLES)[number]
export type FakeRow = Record<string, unknown>

type FakeResult = { data: unknown; error: { message: string } | null }

export function createTemplateContent(): unknown {
  return templateContentV3Schema.parse({
    schemaVersion: 3,
    branding: {
      organizationName: "BizFlow",
      logoDataUrl: null,
      logoAlignment: "left",
      logoWidthPercent: 30,
      primaryColor: "#0f172a",
      accentColor: "#0284c7",
    },
    blocks: [
      {
        id: "10000000-0000-4000-8000-0000000000a1",
        type: "text_field",
        fieldKey: "full_name",
        label: "Full name",
        required: true,
        multiline: false,
        placeholder: null,
        helpText: null,
      },
      {
        id: "10000000-0000-4000-8000-0000000000a2",
        type: "checkbox_field",
        fieldKey: "agreed",
        label: "I agree",
        required: false,
        helpText: null,
      },
      {
        id: "10000000-0000-4000-8000-0000000000a3",
        type: "file_field",
        fieldKey: "evidence",
        label: "Evidence",
        required: false,
        helpText: null,
      },
    ],
    sections: [],
    fieldGroups: [],
    blockRules: [],
  })
}

export function createTemplateRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: TEMPLATE_ID,
    org_id: ORG_ID,
    title: "Visitor Form",
    description: null,
    status: "published",
    revision: 3,
    content: createTemplateContent(),
    created_by: MANAGER_ID,
    updated_by: MANAGER_ID,
    published_by: MANAGER_ID,
    archived_by: null,
    created_at: FROZEN_NOW,
    updated_at: FROZEN_NOW,
    published_at: FROZEN_NOW,
    archived_at: null,
    ...overrides,
  }
}

export function createLinkRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: LINK_ID,
    org_id: ORG_ID,
    template_id: TEMPLATE_ID,
    token: PUBLIC_TOKEN,
    status: "active",
    expires_at: null,
    max_submissions: null,
    submission_count: 0,
    created_by: MANAGER_ID,
    created_at: FROZEN_NOW,
    updated_at: FROZEN_NOW,
    ...overrides,
  }
}

export function createDraftRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: SUBMISSION_ID,
    org_id: ORG_ID,
    title: "Visitor Form (Public)",
    template_id: TEMPLATE_ID,
    template_revision: 3,
    template_snapshot: createTemplateContent(),
    values: {},
    status: "draft",
    revision: 1,
    public_form_link_id: LINK_ID,
    public_draft_token: DRAFT_TOKEN,
    created_at: FROZEN_NOW,
    updated_at: FROZEN_NOW,
    submitted_at: null,
    ...overrides,
  }
}

export function createFileRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: FILE_ID,
    org_id: ORG_ID,
    submission_id: SUBMISSION_ID,
    field_key: "evidence",
    status: "upload_pending",
    storage_key: `organizations/${ORG_ID}/submissions/${SUBMISSION_ID}/files/evidence/${FILE_ID}/evidence.pdf`,
    original_filename: "evidence.pdf",
    safe_filename: "evidence.pdf",
    content_type: "application/pdf",
    byte_size: 1024,
    expected_checksum_sha256: CHECKSUM,
    checksum_sha256: null,
    available_at: null,
    created_at: FROZEN_NOW,
    updated_at: FROZEN_NOW,
    ...overrides,
  }
}

class FakeQueryBuilder implements PromiseLike<FakeResult> {
  private readonly filters: Array<(row: FakeRow) => boolean> = []
  private insertRows: FakeRow[] | null = null
  private updateValues: FakeRow | null = null

  constructor(
    private readonly client: FakePublicFormClient,
    private readonly tableName: FakeTableName
  ) {}

  select(): this {
    return this
  }

  insert(values: FakeRow | FakeRow[]): this {
    this.insertRows = Array.isArray(values) ? values : [values]
    return this
  }

  update(values: FakeRow): this {
    this.updateValues = values
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value)
    return this
  }

  order(): this {
    return this
  }

  async single(): Promise<FakeResult> {
    const rows = this.run()
    return rows.length === 1
      ? { data: rows[0], error: null }
      : { data: null, error: { message: "Expected exactly one row." } }
  }

  async maybeSingle(): Promise<FakeResult> {
    const rows = this.run()
    return rows.length > 1
      ? { data: null, error: { message: "Expected zero or one row." } }
      : { data: rows[0] ?? null, error: null }
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?:
      | ((value: FakeResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.run(), error: null }).then(
      onfulfilled,
      onrejected
    )
  }

  private run(): FakeRow[] {
    const table = this.client.tables[this.tableName]

    if (this.insertRows) {
      const inserted = this.insertRows.map((row) => ({ ...row }))
      table.push(...inserted)
      return inserted
    }

    const matched = table.filter((row) =>
      this.filters.every((predicate) => predicate(row))
    )

    if (this.updateValues) {
      for (const row of matched) {
        Object.assign(row, this.updateValues)
      }
    }

    return matched
  }
}

/**
 * In-memory Supabase stand-in scoped to the relations this service may use.
 */
export class FakePublicFormClient {
  readonly tables: Record<FakeTableName, FakeRow[]>
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []

  constructor(seed: Partial<Record<FakeTableName, FakeRow[]>> = {}) {
    this.tables = Object.fromEntries(
      KNOWN_TABLES.map((name) => [name, seed[name] ?? []])
    ) as Record<FakeTableName, FakeRow[]>
  }

  from(tableName: string): FakeQueryBuilder {
    if (!(KNOWN_TABLES as readonly string[]).includes(tableName)) {
      throw new Error(
        `Query against unknown relation "${tableName}". Known relations: ${KNOWN_TABLES.join(", ")}.`
      )
    }

    return new FakeQueryBuilder(this, tableName as FakeTableName)
  }

  async rpc(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: { message: string } | null }> {
    this.rpcCalls.push({ name, args })

    if (name === "supersede_public_submission_file") {
      const link = this.tables.public_form_links.find(
        (row) =>
          row.token === args.target_public_form_token && row.status === "active"
      )
      const draft = this.tables.submissions.find(
        (row) =>
          row.public_draft_token === args.target_public_draft_token &&
          row.public_form_link_id === link?.id &&
          row.org_id === link?.org_id &&
          row.status === "draft"
      )
      const file = this.tables.submission_files.find(
        (row) =>
          row.id === args.target_file_id &&
          row.submission_id === draft?.id &&
          row.org_id === draft?.org_id &&
          (row.status === "upload_pending" || row.status === "available")
      )

      if (!link || !draft || !file) {
        return { data: null, error: { message: "Public file was not found." } }
      }

      file.status = "superseded"
      file.superseded_by = null
      file.superseded_at = FROZEN_NOW
      file.updated_at = FROZEN_NOW
      return { data: file, error: null }
    }

    if (name !== "increment_public_form_link_submission_count") {
      throw new Error(`Unexpected RPC ${name}.`)
    }

    const link = this.tables.public_form_links.find(
      (row) => row.token === args.p_token && row.status === "active"
    )

    if (!link) {
      return { data: false, error: null }
    }

    const max = link.max_submissions as number | null
    const count = link.submission_count as number

    if (max !== null && count >= max) {
      return { data: false, error: null }
    }

    link.submission_count = count + 1
    return { data: true, error: null }
  }
}

/**
 * Deterministic dependencies: frozen clock, sequenced ids, stubbed R2.
 */
export function createDeps(
  client: FakePublicFormClient,
  ids: string[] = []
): PublicFormServiceDeps {
  const queue = [...ids]

  return {
    client: client as never,
    now: () => new Date(FROZEN_NOW),
    createId: () => queue.shift() ?? SUBMISSION_ID,
    generateTokenImpl: () => PUBLIC_TOKEN,
    generateDraftTokenImpl: () => DRAFT_TOKEN,
    createSignedSubmissionUploadUrl: vi.fn(async (input) => ({
      uploadUrl: "https://r2.example/upload",
      storageKey: `organizations/${input.organizationId}/submissions/${input.submissionId}/files/${input.fieldKey}/${input.fileId}/${input.safeFilename}`,
      expiresInSeconds: 900,
    })),
    verifySubmissionUpload: vi.fn(async () => {}),
  }
}
