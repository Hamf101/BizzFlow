import { describe, expect, it } from "vitest"

import {
  PostgrestReadQuery,
  type FakeRow,
  type PostgrestFakeResult,
} from "@/services/postgrest-fake.test-support"
import {
  deleteSavedView,
  listSavedViews,
  renameSavedView,
  saveListView,
} from "@/services/saved-view-service"

const UNIQUE_VIOLATION = {
  code: "23505",
  message: "duplicate key value violates unique constraint",
}

let viewCount = 0
const nextViewId = (): string =>
  `00000000-0000-4000-8000-${String((viewCount += 1)).padStart(12, "0")}`

/** Saved views with the table's writes and its one-name-per-list index. */
class SavedViewQuery extends PostgrestReadQuery {
  private inserted: FakeRow | null = null
  private changes: FakeRow | null = null
  private removing = false

  constructor(
    private readonly table: FakeRow[],
    private readonly failWrites: boolean
  ) {
    super(table)
  }

  insert(row: FakeRow): this {
    this.inserted = row
    return this
  }

  update(values: FakeRow): this {
    this.changes = values
    return this
  }

  delete(): this {
    this.removing = true
    return this
  }

  protected override execute(): PostgrestFakeResult {
    if ((this.inserted || this.changes || this.removing) && this.failWrites) {
      return {
        count: null,
        data: null,
        error: { code: "08006", message: "Connection failed" },
      }
    }

    if (this.inserted) {
      const row: FakeRow = { id: nextViewId(), ...this.inserted }

      if (this.clashes(row)) {
        return { count: null, data: null, error: UNIQUE_VIOLATION }
      }

      this.table.push(row)
      return { count: null, data: [row], error: null }
    }

    const result = super.execute()
    const matched = result.data ?? []

    if (this.changes) {
      if (matched.some((row: FakeRow) => this.clashes({ ...row, ...this.changes }))) {
        return { count: null, data: null, error: UNIQUE_VIOLATION }
      }

      matched.forEach((row: FakeRow) => Object.assign(row, this.changes))
    }

    if (this.removing) {
      for (const row of matched) {
        this.table.splice(this.table.indexOf(row), 1)
      }
    }

    return result
  }

  // The table's unique index: one name per member, list, and workspace,
  // whatever its case.
  private clashes(candidate: FakeRow): boolean {
    return this.table.some(
      (row: FakeRow): boolean =>
        row.id !== candidate.id &&
        row.org_id === candidate.org_id &&
        row.user_id === candidate.user_id &&
        row.list === candidate.list &&
        String(row.name).toLowerCase() === String(candidate.name).toLowerCase()
    )
  }
}

function fixture({ failWrites = false } = {}) {
  const memberships: FakeRow[] = [
    { id: "member-1", org_id: "org-1", user_id: "user-1", status: "active" },
    { id: "member-2", org_id: "org-1", user_id: "user-2", status: "active" },
    { id: "member-3", org_id: "org-2", user_id: "user-1", status: "active" },
  ]
  const views: FakeRow[] = []
  const tables: Record<string, FakeRow[]> = {
    organization_memberships: memberships,
    saved_list_views: views,
  }
  const deps = {
    client: {
      from: (table: string) => new SavedViewQuery(tables[table] ?? [], failWrites),
    } as never,
  }

  return { deps, memberships, views }
}

const actor = { actorUserId: "user-1", organizationId: "org-1" }
const leases = {
  ...actor,
  list: "documents",
  name: "  Leases, newest first  ",
  query: "folderId=10000000-0000-4000-8000-000000000001&sort=-modified",
}

describe("saved list views", () => {
  it("keeps a view for its member alone, on its own list and workspace", async () => {
    const { deps } = fixture()
    const saved = await saveListView(leases, deps)

    expect(saved).toMatchObject({
      list: "documents",
      name: "Leases, newest first",
      query: leases.query,
    })
    expect(await listSavedViews({ ...actor, list: "documents" }, deps)).toEqual([saved])
    expect(
      await listSavedViews({ ...actor, actorUserId: "user-2", list: "documents" }, deps)
    ).toEqual([])
    expect(
      await listSavedViews({ ...actor, list: "documents", organizationId: "org-2" }, deps)
    ).toEqual([])
    expect(await listSavedViews({ ...actor, list: "tasks" }, deps)).toEqual([])
  })

  it("refuses a second view with the same name on a list, ignoring case", async () => {
    const { deps, views } = fixture()
    await saveListView(leases, deps)

    await expect(
      saveListView({ ...leases, name: "LEASES, NEWEST FIRST" }, deps)
    ).rejects.toMatchObject({ statusCode: 409 })
    await saveListView({ ...leases, list: "tasks", query: "sort=due" }, deps)
    expect(views).toHaveLength(2)
  })

  it("keeps at most twenty views on one list", async () => {
    const { deps, views } = fixture()

    for (let index = 1; index <= 20; index += 1) {
      await saveListView({ ...leases, name: `View ${index}` }, deps)
    }

    await expect(
      saveListView({ ...leases, name: "One more" }, deps)
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(views).toHaveLength(20)
  })

  it.each([
    ["an unknown list", { list: "people" }],
    ["an empty name", { name: "   " }],
    ["a name over 40 characters", { name: "x".repeat(41) }],
    ["a page in the query", { query: "sort=-modified&page=2" }],
    ["an overlong query", { query: `q=${"x".repeat(1_000)}` }],
  ])("refuses %s without saving", async (_case, change) => {
    const { deps, views } = fixture()

    await expect(saveListView({ ...leases, ...change }, deps)).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(views).toHaveLength(0)
  })

  it("renames and deletes a member's own view and nobody else's", async () => {
    const { deps, views } = fixture()
    const mine = await saveListView(leases, deps)
    const theirs = await saveListView({ ...leases, actorUserId: "user-2" }, deps)

    await expect(
      renameSavedView({ ...actor, name: "Mine now", viewId: theirs.id }, deps)
    ).rejects.toMatchObject({ statusCode: 404 })
    await expect(
      deleteSavedView({ ...actor, viewId: theirs.id }, deps)
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(
      await renameSavedView({ ...actor, name: " Leases ", viewId: mine.id }, deps)
    ).toMatchObject({ id: mine.id, name: "Leases" })

    await deleteSavedView({ ...actor, viewId: mine.id }, deps)
    expect(views).toEqual([
      expect.objectContaining({ id: theirs.id, name: "Leases, newest first" }),
    ])
  })

  it("refuses a rename onto another view's name on the same list", async () => {
    const { deps, views } = fixture()
    await saveListView(leases, deps)
    const other = await saveListView({ ...leases, name: "Insurance papers" }, deps)

    await expect(
      renameSavedView({ ...actor, name: "leases, NEWEST first", viewId: other.id }, deps)
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(views.map((view: FakeRow) => view.name)).toEqual([
      "Leases, newest first",
      "Insurance papers",
    ])
  })

  it.each(["disabled", "missing", "other-tenant"])(
    "refuses every operation for a %s membership",
    async (kind) => {
      const { deps, memberships, views } = fixture()
      const saved = await saveListView(leases, deps)

      if (kind === "missing") memberships.splice(0, 1)
      else if (kind === "other-tenant") memberships[0].org_id = "org-3"
      else memberships[0].status = "disabled"

      await expect(
        listSavedViews({ ...actor, list: "documents" }, deps)
      ).rejects.toMatchObject({ statusCode: 403 })
      await expect(
        saveListView({ ...leases, name: "Another" }, deps)
      ).rejects.toMatchObject({ statusCode: 403 })
      await expect(
        renameSavedView({ ...actor, name: "Renamed", viewId: saved.id }, deps)
      ).rejects.toMatchObject({ statusCode: 403 })
      await expect(
        deleteSavedView({ ...actor, viewId: saved.id }, deps)
      ).rejects.toMatchObject({ statusCode: 403 })
      expect(views).toEqual([
        expect.objectContaining({ id: saved.id, name: "Leases, newest first" }),
      ])
    }
  )

  it("reports a failed save without passing on the database's words", async () => {
    const { deps } = fixture({ failWrites: true })
    const failure = await saveListView(leases, deps).catch((error: unknown) => error)

    expect(failure).toMatchObject({ statusCode: 500 })
    expect((failure as Error).message).not.toContain("Connection failed")
  })
})
