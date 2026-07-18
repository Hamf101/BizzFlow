import { afterEach, describe, expect, it, vi } from "vitest"

import type { OrganizationRole } from "@/lib/permissions"
import {
  createDocumentComment,
  listDocumentComments,
  type DocumentCommentServiceDeps,
} from "@/services/document-comment-service"

type FakeRow = Record<string, unknown>
type FakeTableName =
  | "organization_memberships"
  | "documents"
  | "document_comments"
  | "profiles"
  | "document_activity_events"
type FakeTables = Record<FakeTableName, FakeRow[]>
type FakeRpcError = {
  code: string
  message: string
}

type FakeSupabaseClientOptions = {
  activityInsertFails?: boolean
}

afterEach(() => {
  vi.restoreAllMocks()
})

class FakeSupabaseClient {
  readonly tables: FakeTables
  readonly rpcCalls: Array<{
    functionName: string
    args: Record<string, unknown>
  }> = []
  readonly fromCounts: Record<FakeTableName, number> = {
    organization_memberships: 0,
    documents: 0,
    document_comments: 0,
    profiles: 0,
    document_activity_events: 0,
  }

  constructor(
    seed: Partial<FakeTables> = {},
    private readonly options: FakeSupabaseClientOptions = {}
  ) {
    this.tables = {
      organization_memberships: seed.organization_memberships ?? [],
      documents: seed.documents ?? [],
      document_comments: seed.document_comments ?? [],
      profiles: seed.profiles ?? [],
      document_activity_events: seed.document_activity_events ?? [],
    }
  }

  from(tableName: FakeTableName): FakeQueryBuilder {
    this.fromCounts[tableName] += 1
    return new FakeQueryBuilder(this, tableName)
  }

  async rpc(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<{ data: string | null; error: FakeRpcError | null }> {
    this.rpcCalls.push({ functionName, args })

    if (functionName !== "create_document_comment") {
      return {
        data: null,
        error: { code: "42883", message: "Unknown RPC function." },
      }
    }

    const document = this.tables.documents.find(
      (row: FakeRow): boolean =>
        row.id === args.target_document_id && row.org_id === args.target_org_id
    )

    if (!document) {
      return {
        data: null,
        error: { code: "P0002", message: "Document not found." },
      }
    }

    if (document.archived_at) {
      return {
        data: null,
        error: {
          code: "P0001",
          message: "Archived documents cannot be commented on.",
        },
      }
    }

    if (this.options.activityInsertFails) {
      return {
        data: null,
        error: { code: "23514", message: "Activity insert failed." },
      }
    }

    const commentId = String(args.target_comment_id)
    const createdAt = "2026-07-17T12:00:00.000Z"

    this.tables.document_comments.push({
      id: commentId,
      org_id: args.target_org_id,
      document_id: args.target_document_id,
      body: args.target_body,
      created_by: args.target_actor_user_id,
      created_at: createdAt,
    })
    this.tables.document_activity_events.push({
      id: "activity-comment-new",
      org_id: args.target_org_id,
      document_id: args.target_document_id,
      actor_user_id: args.target_actor_user_id,
      event_type: "document.commented",
      metadata: { commentId },
      created_at: createdAt,
    })

    return { data: commentId, error: null }
  }
}

class FakeQueryBuilder {
  private readonly filters: Array<(row: FakeRow) => boolean> = []
  private insertRows: FakeRow[] | null = null
  private orderColumn: string | null = null
  private orderAscending = true
  private limitCount: number | null = null

  constructor(
    private readonly client: FakeSupabaseClient,
    private readonly tableName: FakeTableName
  ) {}

  select(): FakeQueryBuilder {
    return this
  }

  insert(value: FakeRow | FakeRow[]): FakeQueryBuilder {
    this.insertRows = Array.isArray(value) ? value : [value]
    return this
  }

  eq(column: string, value: unknown): FakeQueryBuilder {
    this.filters.push((row: FakeRow) => row[column] === value)
    return this
  }

  in(column: string, values: unknown[]): FakeQueryBuilder {
    this.filters.push((row: FakeRow) => values.includes(row[column]))
    return this
  }

  order(
    column: string,
    options: { ascending?: boolean } = {}
  ): FakeQueryBuilder {
    this.orderColumn = column
    this.orderAscending = options.ascending ?? true
    return this
  }

  limit(count: number): FakeQueryBuilder {
    this.limitCount = count
    return this
  }

  async single(): Promise<{ data: FakeRow | null; error: Error | null }> {
    const rows = this.execute()

    if (rows.length !== 1) {
      return { data: null, error: new Error("Expected one row.") }
    }

    return { data: rows[0], error: null }
  }

  async maybeSingle(): Promise<{ data: FakeRow | null; error: Error | null }> {
    const rows = this.execute()

    if (rows.length > 1) {
      return { data: null, error: new Error("Expected zero or one row.") }
    }

    return { data: rows[0] ?? null, error: null }
  }

  then<TResult1 = { data: FakeRow[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: FakeRow[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.execute(), error: null }).then(
      onfulfilled,
      onrejected
    )
  }

  private execute(): FakeRow[] {
    if (this.insertRows) {
      const insertedRows = this.insertRows.map((row: FakeRow) => ({
        created_at: "2026-07-17T12:00:00.000Z",
        ...row,
      }))
      this.client.tables[this.tableName].push(...insertedRows)
      return insertedRows
    }

    let rows = this.client.tables[this.tableName].filter((row: FakeRow) =>
      this.filters.every((filter: (row: FakeRow) => boolean) => filter(row))
    )

    if (this.orderColumn) {
      rows = [...rows].sort((left: FakeRow, right: FakeRow) => {
        const leftValue = String(left[this.orderColumn ?? ""])
        const rightValue = String(right[this.orderColumn ?? ""])
        return this.orderAscending
          ? leftValue.localeCompare(rightValue)
          : rightValue.localeCompare(leftValue)
      })
    }

    if (this.limitCount !== null) {
      rows = rows.slice(0, this.limitCount)
    }

    return rows
  }
}

function membership(
  role: OrganizationRole = "staff",
  status = "active"
): FakeRow {
  return {
    id: "membership-1",
    org_id: "org-1",
    user_id: "user-1",
    role,
    status,
  }
}

function documentRow(
  organizationId = "org-1",
  archivedAt: string | null = null
): FakeRow {
  return {
    id: "document-1",
    org_id: organizationId,
    archived_at: archivedAt,
  }
}

function createDeps(client: FakeSupabaseClient): DocumentCommentServiceDeps {
  return {
    client: client as never,
    createId: () => "comment-new",
  }
}

describe("document comment permissions and tenancy", () => {
  it("rejects disabled organization members", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [membership("staff", "disabled")],
      documents: [documentRow()],
    })

    await expect(
      createDocumentComment(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
          body: "Please review this.",
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 403 })

    expect(client.tables.document_comments).toHaveLength(0)
  })

  it("does not accept a document from another tenant", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [membership()],
      documents: [documentRow("org-2")],
    })

    await expect(
      createDocumentComment(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
          body: "Please review this.",
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({
      message: "Document was not found.",
      statusCode: 404,
    })
  })
})

describe("document comment validation and creation", () => {
  it.each([
    ["blank", "   ", "Comment body cannot be empty."],
    ["too long", "x".repeat(2001), "Comment body cannot exceed 2,000 characters."],
  ])("rejects a %s comment", async (_caseName, body, message) => {
    const client = new FakeSupabaseClient({
      organization_memberships: [membership()],
      documents: [documentRow()],
    })

    await expect(
      createDocumentComment(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
          body,
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ message, statusCode: 400 })

    expect(client.tables.document_comments).toHaveLength(0)
  })

  it("rejects comments on archived documents", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [membership()],
      documents: [documentRow("org-1", "2026-07-16T12:00:00.000Z")],
    })

    await expect(
      createDocumentComment(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
          body: "Please review this.",
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it("trims a reviewer comment and records its activity atomically", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [membership("external_reviewer")],
      documents: [documentRow()],
      profiles: [
        { id: "user-1", email: "reviewer@example.com", full_name: "  Ada Reviewer  " },
      ],
    })

    const comment = await createDocumentComment(
      {
        actorUserId: "user-1",
        organizationId: "org-1",
        documentId: "document-1",
        body: "  Please review this.  ",
      },
      createDeps(client)
    )

    expect(comment).toEqual({
      id: "comment-new",
      organizationId: "org-1",
      documentId: "document-1",
      body: "Please review this.",
      createdBy: "user-1",
      authorDisplayName: "Ada Reviewer",
      createdAt: "2026-07-17T12:00:00.000Z",
    })
    expect(client.rpcCalls).toEqual([
      {
        functionName: "create_document_comment",
        args: {
          target_org_id: "org-1",
          target_document_id: "document-1",
          target_comment_id: "comment-new",
          target_body: "Please review this.",
          target_actor_user_id: "user-1",
        },
      },
    ])
    expect(client.tables.document_activity_events).toEqual([
      expect.objectContaining({
        org_id: "org-1",
        document_id: "document-1",
        actor_user_id: "user-1",
        event_type: "document.commented",
        metadata: { commentId: "comment-new" },
      }),
    ])
  })

  it("rolls back the comment when the atomic activity insert fails", async () => {
    const client = new FakeSupabaseClient(
      {
        organization_memberships: [membership()],
        documents: [documentRow()],
        profiles: [
          { id: "user-1", email: "staff@example.com", full_name: "Staff Member" },
        ],
      },
      { activityInsertFails: true }
    )

    await expect(
      createDocumentComment(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
          body: "Persist this comment.",
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({
      message: "Unable to create document comment.",
      statusCode: 500,
    })

    expect(client.tables.document_comments).toHaveLength(0)
    expect(client.tables.document_activity_events).toHaveLength(0)
  })
})

describe("document comment listing", () => {
  it("returns only document-scoped comments newest first with batched author labels", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [membership("external_reviewer")],
      documents: [documentRow()],
      profiles: [
        { id: "user-name", email: "name@example.com", full_name: "Named User" },
        { id: "user-email", email: "email@example.com", full_name: null },
      ],
      document_comments: [
        {
          id: "comment-old",
          org_id: "org-1",
          document_id: "document-1",
          body: "Old",
          created_by: "user-email",
          created_at: "2026-07-17T10:00:00.000Z",
        },
        {
          id: "comment-new",
          org_id: "org-1",
          document_id: "document-1",
          body: "New",
          created_by: "user-name",
          created_at: "2026-07-17T11:00:00.000Z",
        },
        {
          id: "comment-former",
          org_id: "org-1",
          document_id: "document-1",
          body: "Former",
          created_by: null,
          created_at: "2026-07-17T09:00:00.000Z",
        },
        {
          id: "comment-other-document",
          org_id: "org-1",
          document_id: "document-2",
          body: "Hidden",
          created_by: "user-name",
          created_at: "2026-07-17T12:00:00.000Z",
        },
        {
          id: "comment-other-org",
          org_id: "org-2",
          document_id: "document-1",
          body: "Hidden",
          created_by: "user-name",
          created_at: "2026-07-17T12:00:00.000Z",
        },
      ],
    })

    const comments = await listDocumentComments(
      {
        actorUserId: "user-1",
        organizationId: "org-1",
        documentId: "document-1",
      },
      createDeps(client)
    )

    expect(comments.map((comment) => comment.id)).toEqual([
      "comment-new",
      "comment-old",
      "comment-former",
    ])
    expect(comments.map((comment) => comment.authorDisplayName)).toEqual([
      "Named User",
      "email@example.com",
      "Former member",
    ])
    expect(client.fromCounts.profiles).toBe(1)
  })
})
