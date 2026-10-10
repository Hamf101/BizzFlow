import { vi } from "vitest"

import { hashToken } from "@/services/document-signing/token-security"
import {
  PostgrestWriteQuery,
  type FakeOperation,
  type FakeRow,
} from "@/services/postgrest-fake.test-support"
import type { PublicFormServiceDeps } from "@/services/public-form-service"
import { answerTemplateAccess } from "@/services/templates/access.test-support"
import { templateContentV3Schema } from "@/types/template"

export const ORG_ID = "10000000-0000-4000-8000-000000000001"
export const OTHER_ORG_ID = "10000000-0000-4000-8000-000000000009"
export const TEMPLATE_ID = "20000000-0000-4000-8000-000000000001"
export const LINK_ID = "30000000-0000-4000-8000-000000000001"
export const SUBMISSION_ID = "40000000-0000-4000-8000-000000000001"
export const FILE_ID = "50000000-0000-4000-8000-000000000001"
export const MANAGER_ID = "60000000-0000-4000-8000-000000000001"

/** The token the app derives for LINK_ID; links keep only its hash. */
export const PUBLIC_TOKEN = "public-token-0123456789abcdef-0123456789"
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
  "published_document_templates",
  "public_form_links",
  "organizations",
  "submissions",
  "submission_files",
  "organization_memberships",
] as const

export type FakeTableName = (typeof KNOWN_TABLES)[number]
export type { FakeRow }

type FakeRpcResult = {
  data: unknown
  error: { code?: string; message: string } | null
}

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
    token_hash: hashToken(PUBLIC_TOKEN),
    recipient_email: null,
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
    public_draft_token: hashToken(DRAFT_TOKEN),
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

/**
 * In-memory Supabase stand-in scoped to the relations this service may use.
 */
export class FakePublicFormClient {
  readonly tables: Record<FakeTableName, FakeRow[]>
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  /** Tables whose writes fail, standing in for a database error mid-request. */
  readonly failingWrites = new Set<FakeTableName>()

  constructor(seed: Partial<Record<FakeTableName, FakeRow[]>> = {}) {
    this.tables = Object.fromEntries(
      KNOWN_TABLES.map((name) => [name, seed[name] ?? []])
    ) as Record<FakeTableName, FakeRow[]>

    // Unless a test says otherwise, each published template was last
    // published exactly as its working copy stands.
    if (!seed.published_document_templates) {
      this.tables.published_document_templates = this.tables.document_templates
        .filter((row) => row.status === "published")
        .map((row) => ({ ...row }))
    }
  }

  from(tableName: string): PostgrestWriteQuery {
    if (!(KNOWN_TABLES as readonly string[]).includes(tableName)) {
      throw new Error(
        `Query against unknown relation "${tableName}". Known relations: ${KNOWN_TABLES.join(", ")}.`
      )
    }

    return new PostgrestWriteQuery(this.tables, tableName, {
      before: (table: string, operation: FakeOperation) =>
        (operation === "insert" || operation === "update") && this.failingWrites.has(table as FakeTableName)
          ? { message: `Writes to ${table} are failing.` }
          : undefined,
    })
  }

  async rpc(
    name: string,
    args: Record<string, unknown>
  ): Promise<FakeRpcResult> {
    this.rpcCalls.push({ name, args })

    if (name === "get_template_access_level") {
      return answerTemplateAccess(this.tables, name, args)
    }

    if (name === "start_public_form_draft") {
      return this.startPublicFormDraft(args)
    }

    if (name === "supersede_public_submission_file") {
      const link = this.findLink(args)
      const draft = this.tables.submissions.find(
        (row) =>
          row.status === "draft" &&
          link?.status === "active" &&
          row.public_draft_token === hashToken(String(args.target_public_draft_token)) &&
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

    if (name !== "submit_public_form_entry") {
      throw new Error(`Unexpected RPC ${name}.`)
    }

    return this.submitPublicFormEntry(args)
  }

  /** Finds a link as the database does: by its token's hash alone. */
  private findLink(args: Record<string, unknown>): FakeRow | undefined {
    const hash = hashToken(String(args.target_public_form_token))
    return this.tables.public_form_links.find((row) => row.token_hash === hash)
  }

  /** The form a link serves: a sent link's frozen content, or the template as published. */
  private served(link: FakeRow): { revision: unknown; content: unknown } | undefined {
    if (link.content_snapshot) {
      return { revision: link.template_revision_snapshot ?? 1, content: link.content_snapshot }
    }

    const template = this.tables.published_document_templates.find((row) => row.id === link.template_id && row.org_id === link.org_id)
    return template && { revision: template.revision, content: template.content }
  }

  // Mirrors start_public_form_draft: the draft keeps the form its link serves.
  private startPublicFormDraft(args: Record<string, unknown>): FakeRpcResult {
    const link = this.findLink(args)
    const served = link?.status === "active" ? this.served(link) : undefined

    if (!link || !served) {
      return { data: null, error: { code: "55000", message: "Link is not accepting submissions." } }
    }

    if (served.revision !== args.target_template_revision) {
      return { data: null, error: { code: "40001", message: "The form changed." } }
    }

    const row: FakeRow = {
      id: args.target_submission_id,
      org_id: link.org_id,
      title: String(args.target_title).trim(),
      template_id: link.template_id,
      template_revision: served.revision,
      template_snapshot: served.content,
      values: args.target_values,
      status: "draft",
      revision: 1,
      public_form_link_id: link.id,
      public_draft_token: hashToken(String(args.target_public_draft_token)),
      created_at: args.target_created_at,
      updated_at: args.target_created_at,
    }
    this.tables.submissions.push(row)
    return { data: { ...row }, error: null }
  }

  // Mirrors submit_public_form_entry: the link is re-checked, the submission
  // saved, and capacity claimed in one step that happens whole or not at all.
  private submitPublicFormEntry(args: Record<string, unknown>): FakeRpcResult {
    const link = this.findLink(args)
    const max = link?.max_submissions as number | null | undefined
    const count = link?.submission_count as number
    const expired =
      typeof link?.expires_at === "string" &&
      Date.parse(link.expires_at) <= Date.parse(FROZEN_NOW)

    if (
      !link ||
      link.status !== "active" ||
      expired ||
      (typeof max === "number" && count >= max)
    ) {
      return {
        data: null,
        error: { code: "55000", message: "Link is not accepting submissions." },
      }
    }

    if (this.failingWrites.has("submissions")) {
      return {
        data: null,
        error: { code: "XX000", message: "Writes to submissions are failing." },
      }
    }

    const saved = args.target_public_draft_token
      ? this.submitFakeDraft(link, args)
      : this.insertFakeSubmission(link, args)

    if ("error" in saved) {
      return { data: null, error: saved.error }
    }

    link.submission_count = count + 1
    return { data: { ...saved.row }, error: null }
  }

  private submitFakeDraft(
    link: FakeRow,
    args: Record<string, unknown>
  ): { row: FakeRow } | Pick<FakeRpcResult, "error"> {
    const draft = this.tables.submissions.find(
      (row) =>
        row.public_draft_token === hashToken(String(args.target_public_draft_token)) &&
        row.public_form_link_id === link.id &&
        row.org_id === link.org_id &&
        row.status === "draft" &&
        row.revision === args.target_expected_revision
    )

    if (!draft) {
      return {
        error: { code: "40001", message: "Public submission draft has changed." },
      }
    }

    Object.assign(draft, {
      values: args.target_values,
      status: "submitted",
      revision: (draft.revision as number) + 1,
      public_draft_token: null,
      updated_at: args.target_submitted_at,
      submitted_at: args.target_submitted_at,
    })
    return { row: draft }
  }

  private insertFakeSubmission(
    link: FakeRow,
    args: Record<string, unknown>
  ): { row: FakeRow } | Pick<FakeRpcResult, "error"> {
    if (args.target_template_id !== link.template_id) {
      return {
        error: { code: "22023", message: "Submission details are invalid." },
      }
    }

    const served = this.served(link)

    if (!served || served.revision !== args.target_template_revision) {
      return { error: { code: "40001", message: "The form changed." } }
    }

    const row: FakeRow = {
      id: args.target_submission_id,
      org_id: link.org_id,
      title: String(args.target_title).trim(),
      template_id: args.target_template_id,
      template_revision: served.revision,
      template_snapshot: served.content,
      values: args.target_values,
      status: "submitted",
      revision: 1,
      created_by: null,
      updated_by: null,
      submitted_by: null,
      assigned_to: null,
      assigned_by: null,
      public_form_link_id: link.id,
      public_draft_token: null,
      created_at: args.target_submitted_at,
      updated_at: args.target_submitted_at,
      submitted_at: args.target_submitted_at,
      assigned_at: null,
    }

    this.tables.submissions.push(row)
    return { row }
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
    linkToken: (linkId) => (linkId === LINK_ID ? PUBLIC_TOKEN : `derived-token-for-${linkId}`),
    generateDraftTokenImpl: () => DRAFT_TOKEN,
    createSignedSubmissionUploadUrl: vi.fn(async (input) => ({
      uploadUrl: "https://r2.example/upload",
      storageKey: `organizations/${input.organizationId}/submissions/${input.submissionId}/files/${input.fieldKey}/${input.fileId}/${input.safeFilename}`,
      expiresInSeconds: 900,
    })),
    verifySubmissionUpload: vi.fn(async () => {}),
    recordAuditLog: vi.fn(async () => undefined),
  }
}
