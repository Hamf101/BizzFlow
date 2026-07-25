import { describe, expect, it } from "vitest"

import {
  createGeneratedDocument,
  listDocumentTemplates,
  listRecentDocuments,
  publishDocumentTemplate,
  recordDocumentRecentAccess,
  updateDocumentTemplate
} from "@/services/template-service"
import {
  createBlankTemplateContent,
  parseTemplateContent,
  type TemplateContent
} from "@/types/template"

type FakeRow = Record<string, unknown>
type FakeTables = Record<string, FakeRow[]>
type FakeResult = {
  data: unknown
  error: null
}
type FakeFilter = (row: FakeRow) => boolean
type FakeOperation = "select" | "insert" | "update" | "upsert" | "delete"
type FakeOperationHook = (tableName: string, operation: FakeOperation) => void

const ORG_ID = "10000000-0000-4000-8000-000000000001"
const MANAGER_ID = "20000000-0000-4000-8000-000000000001"
const STAFF_ID = "20000000-0000-4000-8000-000000000002"
const EXTERNAL_ID = "20000000-0000-4000-8000-000000000003"
const OTHER_USER_ID = "20000000-0000-4000-8000-000000000004"
const TEMPLATE_ID = "30000000-0000-4000-8000-000000000001"
const DRAFT_TEMPLATE_ID = "30000000-0000-4000-8000-000000000002"
const DOCUMENT_ID = "40000000-0000-4000-8000-000000000001"
const SECOND_DOCUMENT_ID = "40000000-0000-4000-8000-000000000002"
const CREATED_DOCUMENT_ID = "40000000-0000-4000-8000-000000000003"

class FakeQuery implements PromiseLike<FakeResult> {
  private operation: FakeOperation = "select"
  private payload: FakeRow | null = null
  private readonly filters: FakeFilter[] = []
  private orderColumn: string | null = null
  private orderAscending = true
  private rowLimit: number | null = null

  constructor(
    private readonly tableName: string,
    private readonly tables: FakeTables,
    private readonly beforeOperation?: FakeOperationHook
  ) {}

  select(): FakeQuery {
    return this
  }

  insert(payload: FakeRow): FakeQuery {
    this.operation = "insert"
    this.payload = payload
    return this
  }

  update(payload: FakeRow): FakeQuery {
    this.operation = "update"
    this.payload = payload
    return this
  }

  upsert(payload: FakeRow): FakeQuery {
    this.operation = "upsert"
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

  is(column: string, value: unknown): FakeQuery {
    this.filters.push((row: FakeRow): boolean => row[column] === value)
    return this
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

  limit(value: number): FakeQuery {
    this.rowLimit = value
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
    this.beforeOperation?.(this.tableName, this.operation)

    if (this.operation === "insert") {
      const row = withDatabaseDefaults(this.tableName, this.payload ?? {})
      table.push(row)
      return { data: [row], error: null }
    }

    if (this.operation === "upsert") {
      const payload = this.payload ?? {}
      const existing = table.find((row: FakeRow): boolean => {
        return (
          row.org_id === payload.org_id &&
          row.user_id === payload.user_id &&
          row.document_id === payload.document_id
        )
      })

      if (existing) {
        Object.assign(existing, payload)
        return { data: [existing], error: null }
      }

      const row = { ...payload }
      table.push(row)
      return { data: [row], error: null }
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

    let selectedRows = [...matchingRows]

    if (this.orderColumn) {
      const column = this.orderColumn
      const direction = this.orderAscending ? 1 : -1
      selectedRows.sort((left: FakeRow, right: FakeRow): number => {
        return (
          String(left[column]).localeCompare(String(right[column])) * direction
        )
      })
    }

    if (this.rowLimit !== null) {
      selectedRows = selectedRows.slice(0, this.rowLimit)
    }

    return { data: selectedRows, error: null }
  }
}

class FakeClient {
  constructor(
    readonly tables: FakeTables,
    private readonly beforeOperation?: FakeOperationHook
  ) {}

  from(tableName: string): FakeQuery {
    return new FakeQuery(tableName, this.tables, this.beforeOperation)
  }
}

function withDatabaseDefaults(tableName: string, payload: FakeRow): FakeRow {
  const timestamps = {
    created_at: "2026-07-17T19:00:00.000Z",
    updated_at: "2026-07-17T19:00:00.000Z"
  }

  if (tableName === "document_templates") {
    return { ...timestamps, ...payload }
  }

  if (tableName === "documents") {
    return { ...timestamps, archived_at: null, ...payload }
  }

  return { ...payload }
}

function createMembership(userId: string, role: string): FakeRow {
  return {
    org_id: ORG_ID,
    user_id: userId,
    role,
    status: "active"
  }
}

function createTemplateRow(
  id: string,
  status: "draft" | "published",
  content: TemplateContent = createBlankTemplateContent()
): FakeRow {
  return {
    id,
    org_id: ORG_ID,
    title: status === "draft" ? "Draft handbook" : "Published handbook",
    description: null,
    status,
    revision: 1,
    content,
    created_by: MANAGER_ID,
    updated_by: MANAGER_ID,
    published_by: status === "published" ? MANAGER_ID : null,
    archived_by: null,
    created_at: "2026-07-17T18:00:00.000Z",
    updated_at:
      status === "published"
        ? "2026-07-17T19:00:00.000Z"
        : "2026-07-17T20:00:00.000Z",
    published_at: status === "published" ? "2026-07-17T19:00:00.000Z" : null,
    archived_at: null
  }
}

function createDocumentRow(id: string, title: string): FakeRow {
  return {
    id,
    org_id: ORG_ID,
    folder_id: null,
    title,
    description: null,
    source_kind: "generated",
    archived_at: null
  }
}

function createBaseTables(): FakeTables {
  return {
    organization_memberships: [
      createMembership(MANAGER_ID, "manager"),
      createMembership(STAFF_ID, "staff"),
      createMembership(EXTERNAL_ID, "external_reviewer"),
      createMembership(OTHER_USER_ID, "staff")
    ],
    document_templates: [
      createTemplateRow(TEMPLATE_ID, "published"),
      createTemplateRow(DRAFT_TEMPLATE_ID, "draft")
    ],
    folders: [],
    documents: [
      createDocumentRow(DOCUMENT_ID, "First document"),
      createDocumentRow(SECOND_DOCUMENT_ID, "Second document")
    ],
    document_answers: [],
    document_recent_accesses: []
  }
}

describe("template service", () => {
  it("shows all template statuses to managers and only published templates to staff", async () => {
    const client = new FakeClient(createBaseTables())

    const managerTemplates = await listDocumentTemplates(
      { actorUserId: MANAGER_ID, organizationId: ORG_ID },
      { client: client as never }
    )
    const staffTemplates = await listDocumentTemplates(
      { actorUserId: STAFF_ID, organizationId: ORG_ID },
      { client: client as never }
    )

    expect(managerTemplates.map((template) => template.status)).toEqual([
      "draft",
      "published"
    ])
    expect(staffTemplates.map((template) => template.status)).toEqual([
      "published"
    ])
    await expect(
      listDocumentTemplates(
        { actorUserId: EXTERNAL_ID, organizationId: ORG_ID },
        { client: client as never }
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("publishes drafts so staff can select them", async () => {
    const client = new FakeClient(createBaseTables())

    await publishDocumentTemplate(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        templateId: DRAFT_TEMPLATE_ID,
        expectedRevision: 1
      },
      {
        client: client as never,
        now: (): Date => new Date("2026-07-17T21:00:00.000Z")
      }
    )

    const templates = await listDocumentTemplates(
      { actorUserId: STAFF_ID, organizationId: ORG_ID },
      { client: client as never }
    )

    expect(templates.map((template) => template.id)).toEqual([
      DRAFT_TEMPLATE_ID,
      TEMPLATE_ID
    ])
  })

  it("rejects publishing when the database has a newer revision", async () => {
    const tables = createBaseTables()
    const draft = tables.document_templates.find(
      (row: FakeRow): boolean => row.id === DRAFT_TEMPLATE_ID
    )

    if (!draft) {
      throw new Error("Expected the draft template fixture to exist.")
    }

    draft.revision = 2
    draft.title = "Concurrent draft update"
    const client = new FakeClient(tables)

    await expect(
      publishDocumentTemplate(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          templateId: DRAFT_TEMPLATE_ID,
          expectedRevision: 1
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      message: "Document template changed before it could be published.",
      statusCode: 409
    })

    expect(draft.status).toBe("draft")
    expect(draft.revision).toBe(2)
  })

  it("rejects an edit when the template is archived after it is read", async () => {
    const tables = createBaseTables()
    const draft = tables.document_templates.find(
      (row: FakeRow): boolean => row.id === DRAFT_TEMPLATE_ID
    )

    if (!draft) {
      throw new Error("Expected the draft template fixture to exist.")
    }

    let lifecycleChanged = false
    const client = new FakeClient(
      tables,
      (tableName: string, operation: FakeOperation): void => {
        if (
          !lifecycleChanged &&
          tableName === "document_templates" &&
          operation === "update"
        ) {
          draft.status = "archived"
          lifecycleChanged = true
        }
      }
    )

    await expect(
      updateDocumentTemplate(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          templateId: DRAFT_TEMPLATE_ID,
          expectedRevision: 1,
          title: "Unsafe concurrent edit"
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      message: "Document template changed since it was opened.",
      statusCode: 409
    })

    expect(draft.status).toBe("archived")
    expect(draft.title).not.toBe("Unsafe concurrent edit")
  })

  it("increments revisions while preserving previously generated snapshots", async () => {
    const tables = createBaseTables()
    const originalContent = createBlankTemplateContent()
    originalContent.branding.organizationName = "Original organization"
    tables.document_templates[0].content = originalContent
    const client = new FakeClient(tables)

    const generated = await createGeneratedDocument(
      {
        actorUserId: STAFF_ID,
        organizationId: ORG_ID,
        templateId: TEMPLATE_ID
      },
      {
        client: client as never,
        createId: (): string => CREATED_DOCUMENT_ID
      }
    )
    const revisedContent = createBlankTemplateContent()
    revisedContent.branding.organizationName = "Revised organization"
    const updated = await updateDocumentTemplate(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        templateId: TEMPLATE_ID,
        expectedRevision: 1,
        content: revisedContent
      },
      { client: client as never }
    )

    expect(updated.revision).toBe(2)
    expect(updated.content.branding.organizationName).toBe(
      "Revised organization"
    )
    expect(generated.templateSnapshot.branding.organizationName).toBe(
      "Original organization"
    )
    expect(
      (
        tables.documents.find(
          (row: FakeRow): boolean => row.id === CREATED_DOCUMENT_ID
        )?.template_snapshot as TemplateContent
      ).branding.organizationName
    ).toBe("Original organization")
    await expect(
      updateDocumentTemplate(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          templateId: TEMPLATE_ID,
          expectedRevision: 1,
          title: "Stale edit"
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it("reserves file upload fields for internal submissions", async () => {
    const tables = createBaseTables()
    const content = createBlankTemplateContent()

    content.blocks.push({
      id: "50000000-0000-4000-8000-000000000001",
      type: "file_field",
      fieldKey: "supporting_document",
      label: "Supporting document",
      required: true,
      helpText: "Upload one supporting file."
    })
    tables.document_templates[0].content = content
    const client = new FakeClient(tables)

    await expect(
      createGeneratedDocument(
        {
          actorUserId: STAFF_ID,
          organizationId: ORG_ID,
          templateId: TEMPLATE_ID
        },
        {
          client: client as never,
          createId: (): string => CREATED_DOCUMENT_ID
        }
      )
    ).rejects.toMatchObject({
      message: "File upload fields are only supported in internal submissions.",
      statusCode: 409
    })
    expect(tables.documents).toHaveLength(2)
    expect(tables.document_answers).toEqual([])
  })

  it("upserts and lists per-user recents in last-opened order", async () => {
    const tables = createBaseTables()
    tables.document_recent_accesses.push({
      org_id: ORG_ID,
      user_id: OTHER_USER_ID,
      document_id: SECOND_DOCUMENT_ID,
      last_opened_at: "2026-07-17T23:00:00.000Z"
    })
    const client = new FakeClient(tables)

    await recordDocumentRecentAccess(
      {
        actorUserId: STAFF_ID,
        organizationId: ORG_ID,
        documentId: DOCUMENT_ID
      },
      {
        client: client as never,
        now: (): Date => new Date("2026-07-17T20:00:00.000Z")
      }
    )
    await recordDocumentRecentAccess(
      {
        actorUserId: STAFF_ID,
        organizationId: ORG_ID,
        documentId: SECOND_DOCUMENT_ID
      },
      {
        client: client as never,
        now: (): Date => new Date("2026-07-17T21:00:00.000Z")
      }
    )
    await recordDocumentRecentAccess(
      {
        actorUserId: STAFF_ID,
        organizationId: ORG_ID,
        documentId: DOCUMENT_ID
      },
      {
        client: client as never,
        now: (): Date => new Date("2026-07-17T22:00:00.000Z")
      }
    )

    const recent = await listRecentDocuments(
      { actorUserId: STAFF_ID, organizationId: ORG_ID },
      { client: client as never }
    )

    expect(recent.map((document) => document.documentId)).toEqual([
      DOCUMENT_ID,
      SECOND_DOCUMENT_ID
    ])
    expect(recent.map((document) => document.lastOpenedAt)).toEqual([
      "2026-07-17T22:00:00.000Z",
      "2026-07-17T21:00:00.000Z"
    ])
    expect(recent.every((document) => document.userId === STAFF_ID)).toBe(true)
  })

  it("rejects non-PNG/JPEG embedded image data", () => {
    const content = createBlankTemplateContent()
    content.blocks.push({
      id: "50000000-0000-4000-8000-000000000001",
      type: "image",
      dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      altText: "Unsafe vector image",
      caption: null,
      alignment: "center",
      widthPercent: 100
    })

    expect(() => parseTemplateContent(content)).toThrow()
  })

  it("rejects duplicate field keys before a template can be published", () => {
    const content = createBlankTemplateContent()
    content.blocks.push(
      {
        id: "50000000-0000-4000-8000-000000000002",
        type: "text_field",
        fieldKey: "client_name",
        label: "Client name",
        required: true,
        helpText: null,
        placeholder: null,
        multiline: false
      },
      {
        id: "50000000-0000-4000-8000-000000000003",
        type: "date_field",
        fieldKey: "CLIENT_NAME",
        label: "Effective date",
        required: false,
        helpText: null
      }
    )

    expect(() => parseTemplateContent(content)).toThrow(
      "Every fillable field must have a unique field key."
    )
  })
})
