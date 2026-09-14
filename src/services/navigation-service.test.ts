import { describe, expect, it, vi } from "vitest"
import { PostgrestReadQuery, type FakeRow, type PostgrestFakeResult } from "@/services/postgrest-fake.test-support"
import { getNavigationPreferences, renameNavigationTab, saveNavigationOrder } from "@/services/navigation-service"

class NavigationQuery extends PostgrestReadQuery {
  private values: FakeRow | null = null
  constructor(rows: FakeRow[], private readonly failWrites = false) { super(rows) }
  update(values: FakeRow): this { this.values = values; return this }
  protected override execute(): PostgrestFakeResult {
    if (this.values && this.failWrites) return { data: null, count: null, error: { code: "08006", message: "Connection failed" } }
    const result = super.execute()
    if (this.values) result.data?.forEach((row) => Object.assign(row, this.values))
    return result
  }
}

function fixture(role = "owner_admin", failWrites = false) {
  const memberships = [
    { id: "member-1", org_id: "org-1", user_id: "user-1", status: "active", role, navigation_order: [] },
    { id: "member-2", org_id: "org-1", user_id: "user-2", status: "active", role: "staff", navigation_order: [] },
    { id: "member-3", org_id: "org-2", user_id: "user-1", status: "active", role: "owner_admin", navigation_order: [] },
  ]
  const organizations = [
    { id: "org-1", navigation_labels: {}, navigation_revision: 0 },
    { id: "org-2", navigation_labels: {}, navigation_revision: 0 },
  ]
  const tables: Record<string, FakeRow[]> = { organization_memberships: memberships, organizations }
  const deps = { client: { from: (table: string) => new NavigationQuery(tables[table], failWrites) } as never, recordAuditLog: vi.fn().mockResolvedValue(undefined) }
  return { deps, memberships, organizations }
}
const actor = { actorUserId: "user-1", organizationId: "org-1" }
const rename = { ...actor, href: "/documents", label: "  Client files  ", expectedRevision: 0 }

describe("workspace navigation preferences", () => {
  it("persists an owner's label for other members without changing another workspace", async () => {
    const { deps, organizations } = fixture()
    await renameNavigationTab(rename, deps)
    const reloaded = await getNavigationPreferences({ ...actor, actorUserId: "user-2" }, deps)
    expect(reloaded.labels).toEqual({ "/documents": "Client files" })
    expect(reloaded.canRename).toBe(false)
    expect(organizations[1].navigation_labels).toEqual({})
  })

  it.each(["manager", "staff", "external_reviewer"])("rejects renaming by %s without mutating labels", async (role) => {
    const { deps, organizations } = fixture(role)
    await expect(renameNavigationTab(rename, deps)).rejects.toMatchObject({ statusCode: 403 })
    expect(organizations[0].navigation_labels).toEqual({})
  })

  it.each(["owner_admin", "manager", "staff", "external_reviewer"])("saves and reloads only the %s actor's own order in this workspace", async (role) => {
    const { deps } = fixture(role)
    await saveNavigationOrder({ ...actor, order: ["/settings", "/documents", "/dashboard"] }, deps)
    expect((await getNavigationPreferences(actor, deps)).order).toEqual(["/settings", "/documents", "/dashboard"])
    expect((await getNavigationPreferences({ ...actor, actorUserId: "user-2" }, deps)).order).toEqual([])
    expect((await getNavigationPreferences({ ...actor, organizationId: "org-2" }, deps)).order).toEqual([])
  })

  it.each(["disabled", "missing", "other-tenant"])("rejects reads and both mutations for %s membership", async (kind) => {
    const { deps, memberships, organizations } = fixture()
    if (kind === "missing") memberships.splice(0, 1)
    else if (kind === "other-tenant") memberships[0].org_id = "org-3"
    else memberships[0].status = "disabled"
    await expect(getNavigationPreferences(actor, deps)).rejects.toMatchObject({ statusCode: 403 })
    await expect(renameNavigationTab(rename, deps)).rejects.toMatchObject({ statusCode: 403 })
    await expect(saveNavigationOrder({ ...actor, order: ["/settings"] }, deps)).rejects.toMatchObject({ statusCode: 403 })
    expect(organizations[0].navigation_labels).toEqual({})
    expect(memberships.every((row) => row.navigation_order.length === 0)).toBe(true)
  })

  it.each(["", "   ", "x".repeat(41)])("rejects invalid tab name %j", async (label) => {
    const { deps, organizations } = fixture()
    await expect(renameNavigationTab({ ...rename, label }, deps)).rejects.toMatchObject({ statusCode: 400 })
    expect(organizations[0].navigation_labels).toEqual({})
  })

  it("rejects unknown destinations and duplicate order entries", async () => {
    const { deps } = fixture()
    await expect(renameNavigationTab({ ...rename, href: "/fake" }, deps)).rejects.toMatchObject({ statusCode: 400 })
    for (const order of [["/fake"], ["/settings", "/settings"]]) {
      await expect(saveNavigationOrder({ ...actor, order }, deps)).rejects.toMatchObject({ statusCode: 400 })
    }
    expect((await getNavigationPreferences(actor, deps)).order).toEqual([])
  })

  it("allows only one of two concurrent owners' edits to win", async () => {
    const { deps } = fixture()
    const results = await Promise.allSettled([
      renameNavigationTab(rename, deps),
      renameNavigationTab({ ...rename, label: "Competing name" }, deps),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { statusCode: 409 } })
    expect((await getNavigationPreferences(actor, deps)).revision).toBe(1)
  })

  it("reports failed writes without pretending either preference was saved", async () => {
    const { deps } = fixture("owner_admin", true)
    await expect(renameNavigationTab(rename, deps)).rejects.toMatchObject({ statusCode: 500 })
    await expect(saveNavigationOrder({ ...actor, order: ["/settings"] }, deps)).rejects.toMatchObject({ statusCode: 500 })
    expect(await getNavigationPreferences(actor, deps)).toMatchObject({ labels: {}, order: [], revision: 0 })
  })

  it("rejects stale renames without overwriting a newer label", async () => {
    const { deps } = fixture()
    await renameNavigationTab(rename, deps)
    await expect(renameNavigationTab({ ...rename, label: "Old name" }, deps)).rejects.toMatchObject({ statusCode: 409 })
    expect((await getNavigationPreferences(actor, deps)).labels).toEqual({ "/documents": "Client files" })
    await renameNavigationTab({ ...rename, href: "/tasks", label: "To do", expectedRevision: 1 }, deps)
    expect((await getNavigationPreferences(actor, deps)).labels).toEqual({ "/documents": "Client files", "/tasks": "To do" })
  })
})
