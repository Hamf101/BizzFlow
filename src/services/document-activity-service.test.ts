import { describe, expect, it } from "vitest"

import {
  listDocumentActivity,
  recordDocumentActivity,
  type DocumentActivityServiceDeps,
} from "@/services/document-activity-service"

type FakeRow = Record<string, unknown>
type FakeTableName =
  | "organization_memberships"
  | "documents"
  | "document_activity_events"
  | "profiles"
type FakeTables = Record<FakeTableName, FakeRow[]>
type FakeSupabaseClientOptions = {
  documentAccessLevel?: "viewer" | "contributor" | null
}

class FakeSupabaseClient {
  readonly tables: FakeTables
  readonly fromCounts: Record<FakeTableName, number> = {
    organization_memberships: 0,
    documents: 0,
    document_activity_events: 0,
    profiles: 0,
  }

  constructor(
    seed: Partial<FakeTables> = {},
    private readonly options: FakeSupabaseClientOptions = {}
  ) {
    this.tables = {
      organization_memberships: seed.organization_memberships ?? [],
      documents: seed.documents ?? [],
      document_activity_events: seed.document_activity_events ?? [],
      profiles: seed.profiles ?? [],
    }
  }

  from(tableName: FakeTableName): FakeQueryBuilder {
    this.fromCounts[tableName] += 1
    return new FakeQueryBuilder(this, tableName)
  }

  async rpc(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<{ data: string | null; error: Error | null }> {
    if (functionName !== "get_document_access_level") {
      return {
        data: null,
        error: new Error(`Unsupported fake RPC: ${functionName}`),
      }
    }

    const document = this.tables.documents.find(
      (row: FakeRow): boolean =>
        row.id === args.target_document_id &&
        row.org_id === args.target_org_id
    )
    const membership = this.tables.organization_memberships.find(
      (row: FakeRow): boolean =>
        row.org_id === args.target_org_id &&
        row.user_id === args.target_actor_user_id &&
        row.status === "active"
    )
    const accessLevel =
      this.options.documentAccessLevel === undefined
        ? "viewer"
        : this.options.documentAccessLevel

    return {
      data: document && membership ? accessLevel : null,
      error: null,
    }
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
      const rows = this.insertRows.map((row: FakeRow) => ({
        created_at: "2026-07-17T12:00:00.000Z",
        ...row,
      }))
      this.client.tables[this.tableName].push(...rows)
      return rows
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

    return this.limitCount === null ? rows : rows.slice(0, this.limitCount)
  }
}

function deps(client: FakeSupabaseClient): DocumentActivityServiceDeps {
  return { client: client as never, createId: () => "activity-new" }
}

describe("record document activity", () => {
  it("stores a server-side event for a same-tenant document", async () => {
    const client = new FakeSupabaseClient({
      documents: [{ id: "document-1", org_id: "org-1" }],
    })

    await recordDocumentActivity(
      {
        organizationId: "org-1",
        documentId: "document-1",
        actorUserId: "user-1",
        eventType: "document.replaced",
        metadata: { versionId: "version-2", versionNumber: 2 },
      },
      deps(client)
    )

    expect(client.tables.document_activity_events).toEqual([
      expect.objectContaining({
        id: "activity-new",
        org_id: "org-1",
        document_id: "document-1",
        actor_user_id: "user-1",
        event_type: "document.replaced",
        metadata: { versionId: "version-2", versionNumber: 2 },
      }),
    ])
  })

  it("rejects a document belonging to another tenant", async () => {
    const client = new FakeSupabaseClient({
      documents: [{ id: "document-1", org_id: "org-2" }],
    })

    await expect(
      recordDocumentActivity(
        {
          organizationId: "org-1",
          documentId: "document-1",
          actorUserId: "user-1",
          eventType: "document.archived",
        },
        deps(client)
      )
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(client.tables.document_activity_events).toHaveLength(0)
  })
})

describe("list document activity", () => {
  it("requires an active membership with document access", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [
        {
          org_id: "org-1",
          user_id: "user-1",
          role: "staff",
          status: "disabled",
        },
      ],
      documents: [{ id: "document-1", org_id: "org-1" }],
    })

    await expect(
      listDocumentActivity(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
        },
        deps(client)
      )
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("hides activity from active members without a document grant", async () => {
    const client = new FakeSupabaseClient(
      {
        organization_memberships: [
          {
            org_id: "org-1",
            user_id: "user-1",
            role: "staff",
            status: "active",
          },
        ],
        documents: [{ id: "document-1", org_id: "org-1" }],
      },
      { documentAccessLevel: null }
    )

    await expect(
      listDocumentActivity(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
        },
        deps(client)
      )
    ).rejects.toMatchObject({
      message: "Document was not found.",
      statusCode: 404,
    })

    expect(client.fromCounts.document_activity_events).toBe(0)
  })

  it("hides activity after a document enters trash", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [
        {
          org_id: "org-1",
          user_id: "user-1",
          role: "staff",
          status: "active",
        },
      ],
      documents: [
        {
          id: "document-1",
          org_id: "org-1",
          lifecycle_state: "trashed",
        },
      ],
      document_activity_events: [
        {
          id: "event-private",
          org_id: "org-1",
          document_id: "document-1",
          actor_user_id: "user-1",
          event_type: "document.commented",
          metadata: {},
          created_at: "2026-07-17T11:00:00.000Z",
        },
      ],
    })

    await expect(
      listDocumentActivity(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
        },
        deps(client)
      )
    ).rejects.toMatchObject({
      message: "Document was not found.",
      statusCode: 404,
    })

    expect(client.fromCounts.document_activity_events).toBe(0)
  })

  it("returns scoped events newest first and resolves actors in one profile query", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [
        {
          org_id: "org-1",
          user_id: "user-1",
          role: "external_reviewer",
          status: "active",
        },
      ],
      documents: [{ id: "document-1", org_id: "org-1" }],
      profiles: [
        { id: "actor-name", email: "name@example.com", full_name: "Named Actor" },
        { id: "actor-email", email: "email@example.com", full_name: null },
      ],
      document_activity_events: [
        {
          id: "event-old",
          org_id: "org-1",
          document_id: "document-1",
          actor_user_id: "actor-email",
          event_type: "document.uploaded",
          metadata: { versionNumber: 1 },
          created_at: "2026-07-17T09:00:00.000Z",
        },
        {
          id: "event-new",
          org_id: "org-1",
          document_id: "document-1",
          actor_user_id: "actor-name",
          event_type: "document.commented",
          metadata: { commentId: "comment-1" },
          created_at: "2026-07-17T11:00:00.000Z",
        },
        {
          id: "event-system",
          org_id: "org-1",
          document_id: "document-1",
          actor_user_id: null,
          event_type: "document.archived",
          metadata: {},
          created_at: "2026-07-17T10:00:00.000Z",
        },
        {
          id: "event-other-document",
          org_id: "org-1",
          document_id: "document-2",
          actor_user_id: "actor-name",
          event_type: "document.commented",
          metadata: {},
          created_at: "2026-07-17T12:00:00.000Z",
        },
        {
          id: "event-other-org",
          org_id: "org-2",
          document_id: "document-1",
          actor_user_id: "actor-name",
          event_type: "document.commented",
          metadata: {},
          created_at: "2026-07-17T12:00:00.000Z",
        },
      ],
    })

    const events = await listDocumentActivity(
      {
        actorUserId: "user-1",
        organizationId: "org-1",
        documentId: "document-1",
      },
      deps(client)
    )

    expect(events.map((event) => event.id)).toEqual([
      "event-new",
      "event-system",
      "event-old",
    ])
    expect(events.map((event) => event.actorDisplayName)).toEqual([
      "Named Actor",
      "System",
      "email@example.com",
    ])
    expect(events[0].metadata).toEqual({ commentId: "comment-1" })
    expect(client.fromCounts.profiles).toBe(1)
  })
})
