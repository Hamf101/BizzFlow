import { describe, expect, it, vi } from "vitest"

import type { ListSort } from "@/lib/list-state"
import {
  PostgrestReadQuery,
  type FakeRow,
} from "@/services/postgrest-fake.test-support"
import {
  listTemplatePage,
  type ListTemplatePageInput,
} from "@/services/template-service"
import { createBlankTemplateContent, type TemplateSortKey } from "@/types/template"

const ORG_ID = "10000000-0000-4000-8000-000000000001"
const OTHER_ORG_ID = "10000000-0000-4000-8000-000000000002"
const MANAGER_ID = "20000000-0000-4000-8000-000000000001"
const STAFF_ID = "20000000-0000-4000-8000-000000000002"
const REVIEWER_ID = "20000000-0000-4000-8000-000000000003"
const OTHER_ORG_MANAGER_ID = "20000000-0000-4000-8000-000000000004"

const RECENTLY_UPDATED: ListSort<TemplateSortKey> = {
  direction: "desc",
  key: "updated",
}

/** Serves each table through the shared PostgREST stand-in. */
class TemplateListClient {
  constructor(private readonly tables: Record<string, FakeRow[]>) {}

  from(tableName: string): PostgrestReadQuery {
    return new PostgrestReadQuery(this.tables[tableName] ?? [])
  }

  // Stands in for document_template_card_contents: the requested templates of
  // one organization, each with its stored content.
  async rpc(
    functionName: string,
    args: { target_org_id: string; template_ids: string[] }
  ): Promise<{ data: FakeRow[] | null; error: { message: string } | null }> {
    if (functionName !== "document_template_card_contents") {
      throw new Error(`Unexpected function ${functionName}`)
    }

    return {
      data: (this.tables.document_templates ?? [])
        .filter(
          (row: FakeRow): boolean =>
            row.org_id === args.target_org_id &&
            args.template_ids.includes(String(row.id))
        )
        .map((row: FakeRow): FakeRow => ({ content: row.content, id: row.id })),
      error: null,
    }
  }
}

// Minutes after a fixed instant, so every timestamp is deterministic.
function at(minutes: number): string {
  return new Date(Date.UTC(2026, 7, 1) + minutes * 60_000).toISOString()
}

function templateId(number: number): string {
  return `30000000-0000-4000-8000-${String(number).padStart(12, "0")}`
}

// Template 1 was created first and updated last, so "recently updated" and
// "newest first" put opposite ends of the list on top.
function createTemplateRow(number: number, overrides: FakeRow = {}): FakeRow {
  return {
    archived_at: null,
    category: null,
    content: { blocks: [], schemaVersion: 3 },
    created_at: at(number),
    created_by: MANAGER_ID,
    description: "Internal notes",
    id: templateId(number),
    org_id: ORG_ID,
    published_at: null,
    revision: 1,
    status: "published",
    title: `Template ${String(number).padStart(4, "0")}`,
    updated_at: at(10_000 - number),
    updated_by: MANAGER_ID,
    ...overrides,
  }
}

function createMembership(userId: string, role: string, orgId = ORG_ID): FakeRow {
  return { org_id: orgId, role, role_definition: null, status: "active", user_id: userId }
}

function createDeps(templates: FakeRow[]): { client: never } {
  return {
    client: new TemplateListClient({
      document_templates: templates,
      organization_memberships: [
        createMembership(MANAGER_ID, "manager"),
        createMembership(STAFF_ID, "staff"),
        createMembership(REVIEWER_ID, "external_reviewer"),
        createMembership(OTHER_ORG_MANAGER_ID, "manager", OTHER_ORG_ID),
      ],
    }) as never,
  }
}

function createPageInput(
  actorUserId: string,
  overrides: Partial<ListTemplatePageInput> = {}
): ListTemplatePageInput {
  return {
    actorUserId,
    organizationId: ORG_ID,
    page: 1,
    pageSize: 25,
    sort: RECENTLY_UPDATED,
    ...overrides,
  }
}

async function listIds(
  actorUserId: string,
  templates: FakeRow[],
  overrides: Partial<ListTemplatePageInput> = {}
): Promise<string[]> {
  const page = await listTemplatePage(
    createPageInput(actorUserId, overrides),
    createDeps(templates)
  )

  return page.templates.map((template): string => template.id)
}

const lifecycle = [
  createTemplateRow(1),
  createTemplateRow(2, { status: "draft" }),
  createTemplateRow(3, { archived_at: at(20_000), status: "archived" }),
  createTemplateRow(4),
]

describe("listTemplatePage", () => {
  it("lists every template for managers, recently updated first", async () => {
    const page = await listTemplatePage(createPageInput(MANAGER_ID), createDeps(lifecycle))

    expect(page).toMatchObject({ page: 1, pageSize: 25, total: 4 })
    expect(page.templates.map((template): string => template.id)).toEqual(
      [1, 2, 3, 4].map(templateId)
    )
    expect(page.templates[0]).toMatchObject({
      category: null,
      createdAt: at(1),
      id: templateId(1),
      organizationId: ORG_ID,
      revision: 1,
      status: "published",
      title: "Template 0001",
      updatedAt: at(9_999),
    })
  })

  it("gives each card its own content, asked for once for the page and within the actor's organization", async () => {
    const blank = createBlankTemplateContent()
    const templates = [
      createTemplateRow(1, { content: blank }),
      createTemplateRow(2, { content: { blocks: "not a list", schemaVersion: 3 } }),
      createTemplateRow(3, { content: blank, org_id: OTHER_ORG_ID }),
    ]
    const deps = createDeps(templates)
    const rpc = vi.spyOn(deps.client as unknown as TemplateListClient, "rpc")

    const page = await listTemplatePage(createPageInput(MANAGER_ID), deps)

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith("document_template_card_contents", {
      target_org_id: ORG_ID,
      template_ids: [templateId(1), templateId(2)],
    })
    // Content that cannot be read leaves a blank page, not a broken library.
    expect(
      page.templates.map((template) => [template.id, template.content])
    ).toEqual([
      [templateId(1), blank],
      [templateId(2), null],
    ])
  })

  it("still lists every template when their contents cannot be read", async () => {
    const deps = createDeps(lifecycle)
    vi.spyOn(deps.client as unknown as TemplateListClient, "rpc").mockResolvedValue({
      data: null,
      error: { message: "Could not find the function" },
    })

    const page = await listTemplatePage(createPageInput(MANAGER_ID), deps)

    expect(page.templates.map((template) => [template.id, template.content])).toEqual(
      [1, 2, 3, 4].map((number: number) => [templateId(number), null])
    )
  })

  it("shows members who cannot manage templates only published ones, whatever they ask for", async () => {
    expect(await listIds(STAFF_ID, lifecycle)).toEqual([1, 4].map(templateId))
    expect(
      await listIds(STAFF_ID, lifecycle, { statuses: ["draft", "archived"] })
    ).toEqual([])
  })

  it("filters a manager's templates by status", async () => {
    expect(
      await listIds(MANAGER_ID, lifecycle, { statuses: ["draft", "archived"] })
    ).toEqual([2, 3].map(templateId))
  })

  it("searches titles literally, ignoring case", async () => {
    const titled = [
      createTemplateRow(1, { title: "Lease 100%" }),
      createTemplateRow(2, { title: "Lease 1000" }),
      createTemplateRow(3, { title: "lease_renewal" }),
      createTemplateRow(4, { title: "Leasehold, three rows" }),
    ]

    // Read as patterns, "100%" would also match "Lease 1000" and "E_R" the
    // "e r" in "three rows".
    expect(await listIds(MANAGER_ID, titled, { query: "100%" })).toEqual([templateId(1)])
    expect(await listIds(MANAGER_ID, titled, { query: "E_R" })).toEqual([templateId(3)])
    expect(await listIds(MANAGER_ID, titled, { query: "  LEASE " })).toEqual(
      [1, 2, 3, 4].map(templateId)
    )
  })

  it("narrows to one category or to uncategorised templates, and to neither without one", async () => {
    const grouped = [
      createTemplateRow(1, { category: "Safety" }),
      createTemplateRow(2, { category: "Field Operations" }),
      createTemplateRow(3),
    ]

    expect(
      await listIds(MANAGER_ID, grouped, { category: "  Field   Operations " })
    ).toEqual([templateId(2)])
    expect(await listIds(MANAGER_ID, grouped, { category: null })).toEqual([templateId(3)])
    expect(await listIds(MANAGER_ID, grouped, { category: undefined })).toEqual(
      [1, 2, 3].map(templateId)
    )
  })

  it("orders by creation or title and pages through ties without repeating or skipping one", async () => {
    // Stored in reverse, so only the id tiebreak can put them in id order.
    const ties = Array.from({ length: 30 }, (_, index) =>
      createTemplateRow(30 - index, { title: "Same title" })
    )
    const byTitle = { sort: { direction: "asc", key: "title" } } as const
    const first = await listIds(MANAGER_ID, ties, { ...byTitle, page: 1 })
    const second = await listIds(MANAGER_ID, ties, { ...byTitle, page: 2 })

    expect([...first, ...second]).toEqual(
      Array.from({ length: 30 }, (_, index) => templateId(index + 1))
    )
    expect(
      await listIds(MANAGER_ID, lifecycle, { sort: { direction: "desc", key: "created" } })
    ).toEqual([4, 3, 2, 1].map(templateId))
  })

  it("answers a page past the end with no templates and the true total", async () => {
    const page = await listTemplatePage(
      createPageInput(MANAGER_ID, { page: 2 }),
      createDeps(lifecycle)
    )

    expect(page).toMatchObject({ page: 2, templates: [], total: 4 })
  })

  it("counts every match, even past PostgREST's thousand-row responses", async () => {
    const many = Array.from({ length: 1_005 }, (_, index) => createTemplateRow(index + 1))
    const page = await listTemplatePage(
      createPageInput(MANAGER_ID, {
        page: 41,
        sort: { direction: "asc", key: "created" },
      }),
      createDeps(many)
    )

    expect(page.total).toBe(1_005)
    expect(page.templates.map((template): string => template.id)).toEqual(
      [1_001, 1_002, 1_003, 1_004, 1_005].map(templateId)
    )
  })

  it("keeps other organizations' templates out", async () => {
    const mixed = [...lifecycle, createTemplateRow(5, { org_id: OTHER_ORG_ID })]

    expect(await listIds(MANAGER_ID, mixed)).toEqual([1, 2, 3, 4].map(templateId))
    await expect(
      listTemplatePage(createPageInput(OTHER_ORG_MANAGER_ID), createDeps(mixed))
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("refuses external reviewers", async () => {
    await expect(
      listTemplatePage(createPageInput(REVIEWER_ID), createDeps(lifecycle))
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it.each([
    ["page 0", { page: 0 }],
    ["a page beyond the last allowed", { page: 10_001 }],
    ["a page size of 0", { pageSize: 0 }],
    ["a page size of 101", { pageSize: 101 }],
    ["an unknown order", { sort: { direction: "asc", key: "priority" } }],
    ["an unknown direction", { sort: { direction: "up", key: "title" } }],
    ["a search over 100 characters", { query: "x".repeat(101) }],
    ["an unknown status", { statuses: ["retired"] }],
    ["a category over 40 characters", { category: "x".repeat(41) }],
  ])("rejects %s", async (_case, override) => {
    await expect(
      listTemplatePage(
        { ...createPageInput(MANAGER_ID), ...override } as never,
        createDeps(lifecycle)
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})
