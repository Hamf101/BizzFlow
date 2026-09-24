import { describe, expect, it, vi } from "vitest"

import {
  SAMPLE_SUBMISSION_COUNT,
  seedSampleSubmissionsForOrganization,
  STARTER_TEMPLATES,
} from "./starter-templates"

const ORG_ID = "10000000-0000-4000-8000-000000000001"
const MANAGER_ID = "20000000-0000-4000-8000-000000000001"
const STAFF_ID = "20000000-0000-4000-8000-000000000002"
const TEMPLATE_ID = "30000000-0000-4000-8000-000000000001"

type FakeRow = Record<string, unknown>
type FakeTables = Record<string, FakeRow[]>

class FakeQuery {
  private readonly filters: ((row: FakeRow) => boolean)[] = []

  constructor(private readonly rows: FakeRow[]) {}

  select(): FakeQuery {
    return this
  }

  eq(column: string, value: unknown): FakeQuery {
    this.filters.push((row: FakeRow): boolean => row[column] === value)
    return this
  }

  async maybeSingle(): Promise<{ data: FakeRow | null; error: null }> {
    const matched = this.rows.filter((row: FakeRow): boolean =>
      this.filters.every((filter): boolean => filter(row))
    )
    return { data: matched[0] ?? null, error: null }
  }
}

class FakeClient {
  constructor(readonly tables: FakeTables) {}

  from(tableName: string): FakeQuery {
    return new FakeQuery(this.tables[tableName] ?? [])
  }
}

/** Seeds every starter template as published, so samples have a target. */
function createTables(overrides: Partial<FakeTables> = {}): FakeTables {
  return {
    organization_memberships: [
      { org_id: ORG_ID, user_id: MANAGER_ID, role: "manager", status: "active" },
      { org_id: ORG_ID, user_id: STAFF_ID, role: "staff", status: "active" },
    ],
    document_templates: STARTER_TEMPLATES.map(
      (starter, index: number): FakeRow => ({
        id: `${TEMPLATE_ID}${index}`,
        org_id: ORG_ID,
        title: starter.title,
        status: "published",
      })
    ),
    submissions: [],
    ...overrides,
  }
}

function createSubmissionDeps(client: FakeClient) {
  let nextId = 0

  return {
    client: client as never,
    createId: (): string => `40000000-0000-4000-8000-00000000000${nextId++}`,
    createInternalSubmissionDraft: vi.fn(
      async (input: {
        submissionId: string
        title: string
      }): Promise<{ id: string; revision: number }> => {
        client.tables.submissions.push({
          id: input.submissionId,
          org_id: ORG_ID,
          title: input.title,
          status: "draft",
        })
        return { id: input.submissionId, revision: 1 }
      }
    ) as never,
    submitInternalSubmission: vi.fn(async () => ({})) as never,
  }
}

describe("starter-templates", () => {
  it("provides valid starter template definitions", () => {
    expect(STARTER_TEMPLATES.length).toBeGreaterThanOrEqual(3)

    for (const starter of STARTER_TEMPLATES) {
      expect(starter.title).toBeTruthy()
      expect(starter.description).toBeTruthy()
      expect(starter.category).toBeTruthy()
      expect(starter.content.schemaVersion).toBe(3)
      expect(starter.content.blocks.length).toBeGreaterThan(0)
    }
  })

  it("answers every required field of its own template in each sample", () => {
    // A sample that skipped a required field would be rejected by the real
    // submit validator the seeder runs it through.
    for (const starter of STARTER_TEMPLATES) {
      const requiredKeys = starter.content.blocks
        .filter(
          (block): block is typeof block & { fieldKey: string } =>
            "fieldKey" in block &&
            "required" in block &&
            block.required === true
        )
        .map((block) => block.fieldKey)

      expect(starter.sampleSubmissions.length).toBeGreaterThan(0)

      for (const sample of starter.sampleSubmissions) {
        expect(sample.title).toContain("Sample:")
        for (const key of requiredKeys) {
          expect(Object.keys(sample.values)).toContain(key)
        }
      }
    }
  })
})

describe("seedSampleSubmissionsForOrganization", () => {
  it("submits one example per definition through the real draft path", async () => {
    const client = new FakeClient(createTables())
    const deps = createSubmissionDeps(client)

    const result = await seedSampleSubmissionsForOrganization(
      { actorUserId: MANAGER_ID, organizationId: ORG_ID },
      deps
    )

    expect(result).toEqual({
      seededCount: SAMPLE_SUBMISSION_COUNT,
      skippedCount: 0,
    })
    expect(deps.createInternalSubmissionDraft).toHaveBeenCalledTimes(
      SAMPLE_SUBMISSION_COUNT
    )
    expect(deps.submitInternalSubmission).toHaveBeenCalledTimes(
      SAMPLE_SUBMISSION_COUNT
    )
  })

  it("is safe to re-run and counts existing samples as skipped", async () => {
    const client = new FakeClient(createTables())
    await seedSampleSubmissionsForOrganization(
      { actorUserId: MANAGER_ID, organizationId: ORG_ID },
      createSubmissionDeps(client)
    )

    const secondDeps = createSubmissionDeps(client)
    const result = await seedSampleSubmissionsForOrganization(
      { actorUserId: MANAGER_ID, organizationId: ORG_ID },
      secondDeps
    )

    expect(result).toEqual({
      seededCount: 0,
      skippedCount: SAMPLE_SUBMISSION_COUNT,
    })
    expect(secondDeps.createInternalSubmissionDraft).not.toHaveBeenCalled()
  })

  it("skips a starter template that has not been seeded yet", async () => {
    const client = new FakeClient(createTables({ document_templates: [] }))
    const deps = createSubmissionDeps(client)

    const result = await seedSampleSubmissionsForOrganization(
      { actorUserId: MANAGER_ID, organizationId: ORG_ID },
      deps
    )

    expect(result).toEqual({
      seededCount: 0,
      skippedCount: SAMPLE_SUBMISSION_COUNT,
    })
    expect(deps.createInternalSubmissionDraft).not.toHaveBeenCalled()
  })

  it("rejects a member who cannot manage templates", async () => {
    const client = new FakeClient(createTables())

    await expect(
      seedSampleSubmissionsForOrganization(
        { actorUserId: STAFF_ID, organizationId: ORG_ID },
        createSubmissionDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("ignores a published template belonging to another organization", async () => {
    const client = new FakeClient(
      createTables({
        document_templates: STARTER_TEMPLATES.map(
          (starter, index: number): FakeRow => ({
            id: `${TEMPLATE_ID}${index}`,
            org_id: "10000000-0000-4000-8000-0000000000ff",
            title: starter.title,
            status: "published",
          })
        ),
      })
    )
    const deps = createSubmissionDeps(client)

    const result = await seedSampleSubmissionsForOrganization(
      { actorUserId: MANAGER_ID, organizationId: ORG_ID },
      deps
    )

    expect(result.seededCount).toBe(0)
    expect(deps.createInternalSubmissionDraft).not.toHaveBeenCalled()
  })
})
