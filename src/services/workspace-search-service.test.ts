import { describe, expect, it, vi } from "vitest"

import type { OrganizationPermissionSubject } from "@/lib/permissions"
import { searchWorkspace, type WorkspaceSearchDeps } from "@/services/workspace-search-service"

const ME = "20000000-0000-4000-8000-000000000001"
const ORG = "10000000-0000-4000-8000-000000000001"
const WHEN = "2026-09-20T10:00:00.000Z"

// Rows as each list's own service hands them back, with the parts a search
// result must never carry: answers, a template's snapshot, who trashed what.
function file(id: string) {
  return { accessLevel: "edit", archivedBy: null, createdAt: WHEN, description: null, folderId: "folder-1", id, lifecycleState: "active", organizationId: ORG, sourceKind: "upload", title: `Lease ${id}`, trashedBy: "someone", updatedAt: WHEN }
}
const SUBMISSION = { assignedTo: ME, createdAt: WHEN, createdBy: ME, id: "submission-1", status: "in_review", submittedAt: WHEN, templateSnapshot: { pages: [] }, title: "Lease application", updatedAt: WHEN, values: { tax_id: "078-05-1120" } }
function folder(id: string, name: string) {
  return { accessLevel: "edit", archivedBy: null, createdAt: WHEN, id, lifecycleState: "active", name, organizationId: ORG, parentFolderId: null, trashedBy: "someone", updatedAt: WHEN }
}
const ADA = { createdAt: WHEN, email: "ada@example.com", fullName: "Ada Okafor", id: "membership-1", phoneNumber: "+15550100", role: "manager", roleName: null, status: "active", userId: ME, workspaceDisplayName: null }

const TUNDE = { ...ADA, email: "tunde@example.com", fullName: "Tunde Bello", id: "membership-2", role: "staff" }

function fakes(membership: OrganizationPermissionSubject, overrides: Partial<Record<keyof WorkspaceSearchDeps, unknown>> = {}) {
  return {
    listFiles: vi.fn(async () => [file("1"), file("2")]),
    listFolders: vi.fn(async () => [folder("folder-1", "Leases"), folder("folder-2", "Manager handbooks")]),
    listPeople: vi.fn(async () => ({ invites: [], members: [ADA, TUNDE], roles: [] })),
    listRecentFiles: vi.fn(async () => [file("recent")]),
    listSubmissions: vi.fn(async () => ({ page: 1, pageSize: 4, submissions: [SUBMISSION], total: 1 })),
    listTasks: vi.fn(async () => ({ page: 1, pageSize: 4, tasks: [], total: 0 })),
    listTemplates: vi.fn(async () => ({ page: 1, pageSize: 4, templates: [], total: 0 })),
    loadMembership: async () => membership,
    ...overrides,
  }
}

function search(input: { kind?: unknown; query?: unknown }, deps: ReturnType<typeof fakes>) {
  return searchWorkspace({ actorUserId: ME, organizationId: ORG, ...input }, deps as unknown as WorkspaceSearchDeps)
}

describe("searchWorkspace", () => {
  it("looks only where the member's role can open, and hands back only what a result shows", async () => {
    // An external reviewer sees people, files and submissions, but no templates or tasks.
    const deps = fakes("external_reviewer")

    const found = await search({ query: " manager " }, deps)

    expect(deps.listTemplates).not.toHaveBeenCalled()
    expect(deps.listTasks).not.toHaveBeenCalled()
    expect(deps.listSubmissions).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: ME, organizationId: ORG, pageSize: 4, query: "manager" }))
    expect(found.totals).toEqual({ files: 3, people: 1, submissions: 1 })
    // People are found by their role's name too; Tunde is staff.
    expect(found.hits).toEqual([
      { item: { createdAt: WHEN, email: "ada@example.com", fullName: "Ada Okafor", id: "membership-1", role: "manager", roleName: null, workspaceDisplayName: null }, kind: "people" },
      // Folders by name first, as Files lists them.
      { folder: true, item: { createdAt: WHEN, id: "folder-2", name: "Manager handbooks", updatedAt: WHEN }, kind: "files" },
      { item: { createdAt: WHEN, description: null, id: "1", lifecycleState: "active", sourceKind: "upload", title: "Lease 1", updatedAt: WHEN }, kind: "files" },
      { item: { createdAt: WHEN, description: null, id: "2", lifecycleState: "active", sourceKind: "upload", title: "Lease 2", updatedAt: WHEN }, kind: "files" },
      { item: { createdAt: WHEN, id: "submission-1", status: "in_review", submittedAt: WHEN, title: "Lease application", updatedAt: WHEN }, kind: "submissions" },
    ])
  })

  it("lists more of one section and still counts the others", async () => {
    const deps = fakes("owner_admin", { listFiles: vi.fn(async () => Array.from({ length: 25 }, (_, index) => file(String(index)))) })

    const found = await search({ kind: "files", query: "lease" }, deps)

    expect(found.hits).toHaveLength(20)
    expect(found.hits.every((hit) => hit.kind === "files")).toBe(true)
    // "Leases" is a folder too.
    expect(found.totals).toEqual({ files: 26, people: 0, submissions: 1, tasks: 0, templates: 0 })
    expect(deps.listTemplates).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 1 }))
  })

  it("opens a chosen section's own list before any words, and only that section", async () => {
    const deps = fakes("owner_admin", { listPeople: vi.fn(async () => ({ invites: [], members: [TUNDE, ADA], roles: [] })) })

    const files = await search({ kind: "files" }, deps)
    expect(files.hits).toEqual([
      { item: { createdAt: WHEN, description: null, id: "recent", lifecycleState: "active", sourceKind: "upload", title: "Lease recent", updatedAt: WHEN }, kind: "files" },
    ])
    expect(deps.listRecentFiles).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: ME, limit: 20, organizationId: ORG }))
    expect(deps.listFiles).not.toHaveBeenCalled()
    expect(deps.listTemplates).not.toHaveBeenCalled()

    // Tasks open soonest due first; people by name.
    await search({ kind: "tasks", query: "" }, deps)
    expect(deps.listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ sort: { direction: "asc", key: "due" }, statuses: ["open", "in_progress"] })
    )
    const people = await search({ kind: "people" }, deps)
    expect(people.hits.map((hit) => (hit.kind === "people" ? hit.item.fullName : null))).toEqual(["Ada Okafor", "Tunde Bello"])
  })

  it("refuses words out of range or an unknown section before looking anywhere", async () => {
    const deps = fakes("owner_admin")

    for (const input of [{ query: " a " }, { query: "x".repeat(101) }, { query: 42 }, { kind: "invoices", query: "lease" }, { query: "" }, {}]) {
      await expect(search(input, deps)).rejects.toMatchObject({ statusCode: 400 })
    }
    expect(deps.listFiles).not.toHaveBeenCalled()
  })

  it("says why a section refused, and nothing of a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const tooMany = Object.assign(new Error("Too many files match this search. Narrow it down."), { statusCode: 413 })

    await expect(search({ query: "le" }, fakes("staff", { listFiles: vi.fn().mockRejectedValue(tooMany) }))).rejects.toMatchObject({
      message: tooMany.message,
      statusCode: 413,
    })
    await expect(
      search({ query: "le" }, fakes("staff", { listTasks: vi.fn().mockRejectedValue(new Error("connect ECONNRESET 10.0.0.3:5432")) }))
    ).rejects.toMatchObject({ message: "Search failed. Try again.", statusCode: 500 })
  })
})
