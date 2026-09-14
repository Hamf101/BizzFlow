import { describe, expect, it, vi } from "vitest"

import {
  allocateInternalSubmissionFile,
  assignInternalSubmission,
  cleanupExpiredSubmissionFileObjects,
  completeInternalSubmissionFile,
  createInternalSubmissionComment,
  createInternalSubmissionDraft,
  createInternalSubmissionFileDownloadUrl,
  expireAbandonedSubmissionFiles,
  exportInternalSubmissionsCsv,
  getInternalSubmission,
  getInternalSubmissionPreview,
  listSubmissionPage,
  saveInternalSubmissionDraft,
  type ListSubmissionPageInput,
  submitInternalSubmission,
  supersedeInternalSubmissionFile,
  transitionInternalSubmission
} from "@/services/submission-service"
import { PostgrestReadQuery } from "@/services/postgrest-fake.test-support"
import { parseTemplateContent, type TemplateContent } from "@/types/template"

type FakeRow = Record<string, unknown>
type FakeTables = Record<string, FakeRow[]>
type FakeResult = { data: unknown; error: FakeError | null }
type FakeError = Error & { code?: string }
type RpcHandler = (
  functionName: string,
  args: Record<string, unknown>
) => Promise<FakeResult>

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"
const MANAGER_ID = "20000000-0000-4000-8000-000000000001"
const STAFF_ID = "20000000-0000-4000-8000-000000000002"
const OTHER_STAFF_ID = "20000000-0000-4000-8000-000000000003"
const EXTERNAL_ID = "20000000-0000-4000-8000-000000000004"
const TEMPLATE_ID = "30000000-0000-4000-8000-000000000001"
const SUBMISSION_ID = "40000000-0000-4000-8000-000000000001"
const OTHER_SUBMISSION_ID = "40000000-0000-4000-8000-000000000002"
const FILE_ID = "50000000-0000-4000-8000-000000000001"
const COMMENT_ID = "70000000-0000-4000-8000-000000000001"
const ACTIVITY_ID = "80000000-0000-4000-8000-000000000001"
const CHECKSUM = "a".repeat(64)
const SNAPSHOT = createSnapshot()

// Reads go through the shared PostgREST stand-in (filters, order, ranges,
// counts, the per-response row cap, and 416 past the end); writes in this
// domain go through RPCs, which each test stubs on the client.
class FakeQuery extends PostgrestReadQuery {
  constructor(tableName: string, tables: FakeTables) {
    super((tables[tableName] ??= []))
  }
}

class FakeClient {
  readonly rpc = vi.fn<RpcHandler>()

  constructor(readonly tables: FakeTables) {}

  from(tableName: string): FakeQuery {
    return new FakeQuery(tableName, this.tables)
  }
}

describe("internal submission visibility", () => {
  it("shows every organization submission to managers and only owned rows to staff", async () => {
    const client = createClient()

    const managerRows = (
      await listSubmissionPage(createPageInput(MANAGER_ID), {
        client: client as never
      })
    ).submissions
    const staffRows = (
      await listSubmissionPage(createPageInput(STAFF_ID), {
        client: client as never
      })
    ).submissions

    expect(managerRows.map((submission) => submission.id)).toEqual([
      OTHER_SUBMISSION_ID,
      SUBMISSION_ID
    ])
    expect(staffRows.map((submission) => submission.id)).toEqual([
      SUBMISSION_ID
    ])
  })

  it("shows external reviewers only assigned non-drafts and hides other staff rows", async () => {
    const client = createClient({
      submissions: [
        createSubmissionRow({
          status: "in_review",
          revision: 3,
          submitted_by: STAFF_ID,
          submitted_at: "2026-07-18T17:00:00.000Z",
          assigned_to: EXTERNAL_ID,
          assigned_by: MANAGER_ID,
          assigned_at: "2026-07-18T17:05:00.000Z"
        }),
        createSubmissionRow({
          id: OTHER_SUBMISSION_ID,
          status: "submitted",
          submitted_by: OTHER_STAFF_ID,
          submitted_at: "2026-07-18T17:00:00.000Z",
          created_by: OTHER_STAFF_ID,
          updated_by: OTHER_STAFF_ID,
          updated_at: "2026-07-18T17:00:00.000Z"
        })
      ]
    })

    const externalRows = (
      await listSubmissionPage(createPageInput(EXTERNAL_ID), {
        client: client as never
      })
    ).submissions

    expect(externalRows.map((submission) => submission.id)).toEqual([
      SUBMISSION_ID
    ])

    await expect(
      getInternalSubmission(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: OTHER_SUBMISSION_ID
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("loads assigned review history without exposing pending files to external reviewers", async () => {
    const client = createClient({
      submissions: [createAssignedSubmissionRow()],
      submission_files: [
        createFileRow(),
        createFileRow({
          id: "50000000-0000-4000-8000-000000000002",
          status: "available"
        })
      ],
      submission_comments: [createCommentRow()],
      submission_activity_events: [createActivityRow()]
    })

    const detail = await getInternalSubmission(
      {
        actorUserId: EXTERNAL_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID
      },
      { client: client as never }
    )

    expect(detail.files).toHaveLength(1)
    expect(detail.files[0]).toMatchObject({ status: "available" })
    expect(detail.comments).toEqual([
      expect.objectContaining({
        id: COMMENT_ID,
        body: "Please confirm the attachment."
      })
    ])
    expect(detail.activity).toEqual([
      expect.objectContaining({
        id: ACTIVITY_ID,
        eventType: "assigned",
        fromStatus: "submitted",
        toStatus: "in_review"
      })
    ])
  })
})

describe("internal submission preview", () => {
  it("previews exactly the title, snapshot, and answers a member may open, and nothing of the rest", async () => {
    const client = createClient()
    const input = {
      actorUserId: MANAGER_ID,
      organizationId: ORGANIZATION_ID,
      submissionId: SUBMISSION_ID
    }

    const [preview, detail] = await Promise.all([
      getInternalSubmissionPreview(input, { client: client as never }),
      getInternalSubmission(input, { client: client as never })
    ])

    // Only what the pages draw; files, comments, and activity stay behind.
    expect(preview).toEqual({
      answers: detail.submission.values,
      content: detail.submission.templateSnapshot,
      title: detail.submission.title
    })
    await expect(
      getInternalSubmissionPreview(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: OTHER_SUBMISSION_ID
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("internal submission csv export", () => {
  it("renders a header row and one escaped row per visible submission", async () => {
    const client = createClient({
      submissions: [createSubmissionRow({ title: 'Vendor "Northstar", Inc.' })]
    })

    const csv = await exportInternalSubmissionsCsv(
      { actorUserId: MANAGER_ID, organizationId: ORGANIZATION_ID },
      { client: client as never }
    )

    expect(csv.split("\n")).toEqual([
      '"Submission ID","Title","Status","Template ID","Created At","Submitted At","Updated At"',
      `"${SUBMISSION_ID}","Vendor ""Northstar"", Inc.","draft","${TEMPLATE_ID}","2026-07-18T15:00:00.000Z","","2026-07-18T16:00:00.000Z"`
    ])
  })

  // The export used to run its own admin query in the route handler, so any
  // holder of submissions:view received every organization row.
  it("applies the same role scoping as the submissions list", async () => {
    const client = createClient()

    const managerCsv = await exportInternalSubmissionsCsv(
      { actorUserId: MANAGER_ID, organizationId: ORGANIZATION_ID },
      { client: client as never }
    )
    const staffCsv = await exportInternalSubmissionsCsv(
      { actorUserId: STAFF_ID, organizationId: ORGANIZATION_ID },
      { client: client as never }
    )

    expect(managerCsv).toContain(OTHER_SUBMISSION_ID)
    expect(staffCsv).toContain(SUBMISSION_ID)
    expect(staffCsv).not.toContain(OTHER_SUBMISSION_ID)
  })

  it("rejects an actor with no active membership", async () => {
    const client = createClient({ organization_memberships: [] })

    await expect(
      exportInternalSubmissionsCsv(
        { actorUserId: MANAGER_ID, organizationId: ORGANIZATION_ID },
        { client: client as never }
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("exports every visible submission, past the per-response row cap", async () => {
    const client = createClient({ submissions: createSubmissionRows(1_234) })

    const lines = (
      await exportInternalSubmissionsCsv(
        { actorUserId: MANAGER_ID, organizationId: ORGANIZATION_ID },
        { client: client as never }
      )
    ).split("\n")

    expect(lines).toHaveLength(1_235)
    expect(lines[1]).toContain(getNumberedSubmissionId(1))
    expect(lines.at(-1)).toContain(getNumberedSubmissionId(1_234))
  })

  it("refuses an export larger than its limit instead of truncating it", async () => {
    const client = createClient({ submissions: createSubmissionRows(11) })

    await expect(
      exportInternalSubmissionsCsv(
        { actorUserId: MANAGER_ID, organizationId: ORGANIZATION_ID },
        { client: client as never, maxExportRows: 10 } as never
      )
    ).rejects.toMatchObject({ statusCode: 413 })
  })

  it("exports only what the view shows, in the view's order", async () => {
    const submitted = {
      status: "submitted",
      submitted_by: STAFF_ID,
      submitted_at: "2026-07-18T10:00:00.000Z"
    }
    const client = createClient({
      submissions: [
        createNumberedSubmissionRow(1, { ...submitted, title: "Charlie" }),
        createNumberedSubmissionRow(2, { ...submitted, title: "Alpha" }),
        createNumberedSubmissionRow(3, { title: "Bravo" })
      ]
    })

    const lines = (
      await exportInternalSubmissionsCsv(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORGANIZATION_ID,
          sort: { direction: "asc", key: "title" },
          statuses: ["submitted"]
        } as never,
        { client: client as never }
      )
    ).split("\n")

    expect(lines.slice(1).map((line: string): string => line.slice(1, 37))).toEqual([
      getNumberedSubmissionId(2),
      getNumberedSubmissionId(1)
    ])
  })
})

describe("submission list pages", () => {
  it("pages what a manager can see, latest update first", async () => {
    const client = createClient({ submissions: createSubmissionRows(55) })

    const page = await listSubmissionPage(
      createPageInput(MANAGER_ID, { page: 2 }),
      { client: client as never }
    )

    expect(page).toMatchObject({ page: 2, pageSize: 25, total: 55 })
    expect(page.submissions.map((submission) => submission.id)).toEqual(
      [...Array(25).keys()].map((index: number): string =>
        getNumberedSubmissionId(26 + index)
      )
    )
  })

  it("breaks ties by id, so a page boundary never repeats or skips a row", async () => {
    const tied = { updated_at: "2026-07-18T12:00:00.000Z" }
    const client = createClient({
      submissions: [
        createNumberedSubmissionRow(3, tied),
        createNumberedSubmissionRow(1, tied),
        createNumberedSubmissionRow(2, tied)
      ]
    })
    const input = createPageInput(MANAGER_ID, { pageSize: 2 })

    const first = await listSubmissionPage(input, { client: client as never })
    const second = await listSubmissionPage(
      { ...input, page: 2 },
      { client: client as never }
    )

    expect(
      [...first.submissions, ...second.submissions].map(
        (submission) => submission.id
      )
    ).toEqual([1, 2, 3].map(getNumberedSubmissionId))
  })

  it("keeps staff to their own submissions and reviewers to assigned non-drafts", async () => {
    const client = createClient({
      submissions: [
        createNumberedSubmissionRow(1),
        createNumberedSubmissionRow(2, {
          created_by: OTHER_STAFF_ID,
          updated_by: OTHER_STAFF_ID
        }),
        createAssignedSubmissionRow({
          id: getNumberedSubmissionId(3),
          updated_at: "2026-07-18T11:00:00.000Z"
        })
      ]
    })

    const staff = await listSubmissionPage(createPageInput(STAFF_ID), {
      client: client as never
    })
    const reviewer = await listSubmissionPage(createPageInput(EXTERNAL_ID), {
      client: client as never
    })
    const manager = await listSubmissionPage(createPageInput(MANAGER_ID), {
      client: client as never
    })

    expect(staff.submissions.map((submission) => submission.id)).toEqual([
      getNumberedSubmissionId(1),
      getNumberedSubmissionId(3)
    ])
    expect(staff.total).toBe(2)
    expect(reviewer.submissions.map((submission) => submission.id)).toEqual([
      getNumberedSubmissionId(3)
    ])
    expect(reviewer.total).toBe(1)
    expect(manager.total).toBe(3)
  })

  it("answers a page past the end with no rows and the true total", async () => {
    const client = createClient({ submissions: createSubmissionRows(3) })

    await expect(
      listSubmissionPage(createPageInput(MANAGER_ID, { page: 5 }), {
        client: client as never
      })
    ).resolves.toMatchObject({ page: 5, submissions: [], total: 3 })
  })

  it("filters by status, literal title text, and assignee", async () => {
    const client = createClient({
      submissions: [
        createNumberedSubmissionRow(1, {
          status: "submitted",
          submitted_by: STAFF_ID,
          submitted_at: "2026-07-18T10:00:00.000Z",
          title: "Refund, 50% off"
        }),
        createNumberedSubmissionRow(2, { title: "Order of 500 units" }),
        createAssignedSubmissionRow({
          id: getNumberedSubmissionId(3),
          title: "Vendor review",
          updated_at: "2026-07-18T11:00:00.000Z"
        })
      ]
    })
    const ids = async (
      overrides: Partial<ListSubmissionPageInput>
    ): Promise<string[]> =>
      (
        await listSubmissionPage(createPageInput(MANAGER_ID, overrides), {
          client: client as never
        })
      ).submissions.map((submission) => submission.id)

    expect(await ids({ statuses: ["submitted"] })).toEqual([
      getNumberedSubmissionId(1)
    ])
    expect(await ids({ query: "50%" })).toEqual([getNumberedSubmissionId(1)])
    expect(await ids({ assignedTo: EXTERNAL_ID })).toEqual([
      getNumberedSubmissionId(3)
    ])
    expect(await ids({ assignedTo: null })).toEqual([
      getNumberedSubmissionId(1),
      getNumberedSubmissionId(2)
    ])
  })

  it.each([
    { label: "page 0", overrides: { page: 0 } },
    { label: "page 10,001", overrides: { page: 10_001 } },
    { label: "a page size of 0", overrides: { pageSize: 0 } },
    { label: "a page size of 101", overrides: { pageSize: 101 } },
    {
      label: "an unknown order",
      overrides: { sort: { direction: "asc", key: "priority" } }
    },
    { label: "a search over 100 characters", overrides: { query: "x".repeat(101) } },
    { label: "an assignee that is not a user id", overrides: { assignedTo: "someone" } },
    { label: "an unknown status", overrides: { statuses: ["archived"] } }
  ])("refuses $label", async ({ overrides }) => {
    const client = createClient()

    await expect(
      listSubmissionPage(
        { ...createPageInput(MANAGER_ID), ...overrides } as never,
        { client: client as never }
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("refuses an actor with no active membership", async () => {
    const client = createClient({ organization_memberships: [] })

    await expect(
      listSubmissionPage(createPageInput(MANAGER_ID), {
        client: client as never
      })
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("internal submission draft lifecycle", () => {
  it("creates a draft through the atomic snapshot RPC", async () => {
    const client = createClient()
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("create_internal_submission_draft")
      expect(args).toMatchObject({
        target_org_id: ORGANIZATION_ID,
        target_template_id: TEMPLATE_ID,
        target_submission_id: SUBMISSION_ID,
        target_title: "Vendor intake",
        target_actor_user_id: STAFF_ID
      })
      return {
        data: createSubmissionRow({ values: {}, revision: 1 }),
        error: null
      }
    })

    const result = await createInternalSubmissionDraft(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        templateId: TEMPLATE_ID,
        title: "  Vendor   intake "
      },
      {
        client: client as never
      }
    )

    expect(result).toMatchObject({ id: SUBMISSION_ID, status: "draft" })
  })

  it("merges a form patch over persisted values before saving", async () => {
    const client = createClient({
      submissions: [
        createSubmissionRow({
          values: { vendor_name: "Old", notes: "Keep this" }
        })
      ]
    })
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("save_internal_submission_draft")
      expect(args.target_values).toEqual({
        vendor_name: "Northstar",
        notes: "Keep this"
      })
      return {
        data: createSubmissionRow({
          values: args.target_values,
          revision: 2
        }),
        error: null
      }
    })

    const result = await saveInternalSubmissionDraft(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 1,
        values: { vendor_name: " Northstar " }
      },
      { client: client as never }
    )

    expect(result).toMatchObject({
      revision: 2,
      values: { vendor_name: "Northstar", notes: "Keep this" }
    })
  })

  it("enforces creator-only draft mutation before calling SQL", async () => {
    const client = createClient()

    await expect(
      saveInternalSubmissionDraft(
        {
          actorUserId: OTHER_STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          expectedRevision: 1,
          values: {}
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("rejects a stale draft revision before replacing answers", async () => {
    const client = createClient()

    await expect(
      saveInternalSubmissionDraft(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          expectedRevision: 2,
          values: { vendor_name: "Northstar" }
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      message: "Submission draft has changed. Reload and try again.",
      statusCode: 409
    })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("submits a complete merged answer set with verified file fields", async () => {
    const client = createClient({
      submissions: [
        createSubmissionRow({
          values: { vendor_name: "Old", notes: "Keep this" }
        })
      ],
      submission_files: [createFileRow({ status: "available" })]
    })
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("submit_internal_submission")
      expect(args.target_values).toEqual({
        vendor_name: "Northstar",
        notes: "Keep this"
      })
      return {
        data: createSubmissionRow({
          status: "submitted",
          revision: 2,
          values: args.target_values,
          submitted_by: STAFF_ID,
          submitted_at: "2026-07-18T18:00:00.000Z"
        }),
        error: null
      }
    })

    const result = await submitInternalSubmission(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 1,
        values: { vendor_name: "Northstar" }
      },
      { client: client as never }
    )

    expect(result.status).toBe("submitted")
  })

  it("blocks submit while any upload remains pending", async () => {
    const client = createClient({
      submissions: [
        createSubmissionRow({ values: { vendor_name: "Northstar" } })
      ],
      submission_files: [createFileRow()]
    })

    await expect(
      submitInternalSubmission(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          expectedRevision: 1,
          values: {}
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      message: "Wait for pending file uploads before submitting.",
      statusCode: 409
    })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("rejects submit when a required snapshot answer is missing", async () => {
    const client = createClient({
      submissions: [createSubmissionRow()],
      submission_files: [createFileRow({ status: "available" })]
    })

    await expect(
      submitInternalSubmission(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          expectedRevision: 1,
          values: {}
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      message:
        "Vendor name must be completed before this submission can be submitted.",
      statusCode: 400
    })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("passes an exact submitted retry through to the idempotent RPC", async () => {
    const submittedRow = createSubmissionRow({
      status: "submitted",
      revision: 2,
      values: { vendor_name: "Northstar" },
      submitted_by: STAFF_ID,
      submitted_at: "2026-07-18T18:00:00.000Z"
    })
    const client = createClient({
      submissions: [submittedRow],
      submission_files: [createFileRow({ status: "available" })]
    })
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("submit_internal_submission")
      expect(args).toMatchObject({
        target_expected_revision: 1,
        target_values: { vendor_name: "Northstar" }
      })
      return { data: submittedRow, error: null }
    })

    const result = await submitInternalSubmission(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 1,
        values: {}
      },
      { client: client as never }
    )

    expect(result).toMatchObject({ status: "submitted", revision: 2 })
    expect(client.rpc).toHaveBeenCalledOnce()
  })

  it("saves and resubmits creator changes after review requests updates", async () => {
    const needsChangesRow = createAssignedSubmissionRow({
      status: "needs_changes",
      revision: 4,
      values: { vendor_name: "Old", notes: "Keep this" }
    })
    const client = createClient({
      submissions: [needsChangesRow],
      submission_files: [createFileRow({ status: "available" })]
    })
    client.rpc.mockImplementation(async (functionName, args) => {
      if (functionName === "save_internal_submission_draft") {
        return {
          data: createAssignedSubmissionRow({
            status: "needs_changes",
            revision: 5,
            values: args.target_values
          }),
          error: null
        }
      }

      expect(functionName).toBe("submit_internal_submission")
      return {
        data: createSubmissionRow({
          status: "submitted",
          revision: 5,
          values: args.target_values,
          submitted_by: STAFF_ID,
          submitted_at: "2026-07-18T18:00:00.000Z",
          assigned_to: EXTERNAL_ID,
          assigned_by: MANAGER_ID,
          assigned_at: "2026-07-18T17:05:00.000Z"
        }),
        error: null
      }
    })

    const saved = await saveInternalSubmissionDraft(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 4,
        values: { vendor_name: "Northstar" }
      },
      { client: client as never }
    )
    const resubmitted = await submitInternalSubmission(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 4,
        values: { vendor_name: "Northstar" }
      },
      { client: client as never }
    )

    expect(saved).toMatchObject({ status: "needs_changes", revision: 5 })
    expect(resubmitted).toMatchObject({
      status: "submitted",
      assignedTo: EXTERNAL_ID
    })
  })
})

describe("internal submission review workflow", () => {
  it("assigns an eligible reviewer through the revision-guarded RPC", async () => {
    const client = createClient({
      submissions: [
        createSubmissionRow({
          status: "submitted",
          revision: 2,
          submitted_by: STAFF_ID,
          submitted_at: "2026-07-18T17:00:00.000Z"
        })
      ]
    })
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("assign_internal_submission")
      expect(args).toEqual({
        target_org_id: ORGANIZATION_ID,
        target_submission_id: SUBMISSION_ID,
        target_expected_revision: 2,
        target_assignee_user_id: EXTERNAL_ID,
        target_actor_user_id: MANAGER_ID
      })
      return { data: createAssignedSubmissionRow(), error: null }
    })

    const result = await assignInternalSubmission(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 2,
        assignedTo: EXTERNAL_ID
      },
      { client: client as never }
    )

    expect(result).toMatchObject({
      status: "in_review",
      assignedTo: EXTERNAL_ID
    })
  })

  it("denies assignment to staff before invoking the RPC", async () => {
    const client = createClient()

    await expect(
      assignInternalSubmission(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          expectedRevision: 1,
          assignedTo: EXTERNAL_ID
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("returns the safe review conflict message from the database", async () => {
    const client = createClient()
    client.rpc.mockResolvedValue({
      data: null,
      error: Object.assign(
        new Error("Submission review has changed. Reload and try again."),
        { code: "40001" }
      )
    })

    await expect(
      assignInternalSubmission(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          expectedRevision: 2,
          assignedTo: EXTERNAL_ID
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      message: "Submission review has changed. Reload and try again.",
      statusCode: 409
    })
  })

  it("trims a required change request comment before the atomic transition", async () => {
    const client = createClient({
      submissions: [createAssignedSubmissionRow()]
    })
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("transition_internal_submission")
      expect(args).toMatchObject({
        target_expected_revision: 3,
        target_transition: "needs_changes",
        target_comment: "Please correct the total.",
        target_actor_user_id: MANAGER_ID
      })
      return {
        data: createAssignedSubmissionRow({
          status: "needs_changes",
          revision: 4
        }),
        error: null
      }
    })

    const result = await transitionInternalSubmission(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 3,
        targetStatus: "needs_changes",
        comment: "  Please correct the total.  "
      },
      { client: client as never }
    )

    expect(result).toMatchObject({ status: "needs_changes", revision: 4 })
  })

  it("requires a nonblank note before changes or rejection", async () => {
    const client = createClient({
      submissions: [createAssignedSubmissionRow()]
    })

    await expect(
      transitionInternalSubmission(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          expectedRevision: 3,
          targetStatus: "rejected",
          comment: "   "
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("lets an assigned external reviewer add a general comment", async () => {
    const client = createClient({
      submissions: [createAssignedSubmissionRow()]
    })
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("create_internal_submission_comment")
      expect(args).toEqual({
        target_org_id: ORGANIZATION_ID,
        target_submission_id: SUBMISSION_ID,
        target_comment_id: COMMENT_ID,
        target_body: "Please confirm the attachment.",
        target_actor_user_id: EXTERNAL_ID
      })
      return { data: createCommentRow(), error: null }
    })

    const result = await createInternalSubmissionComment(
      {
        actorUserId: EXTERNAL_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        body: "  Please confirm the attachment.  "
      },
      { client: client as never, createId: (): string => COMMENT_ID }
    )

    expect(result).toMatchObject({ id: COMMENT_ID, createdBy: EXTERNAL_ID })
  })
})

describe("internal submission file workflow", () => {
  it("allocates metadata before returning a canonical create-only upload URL", async () => {
    const client = createClient()
    const createSignedSubmissionUploadUrl = vi.fn(async (input) => ({
      uploadUrl: "https://r2.example/upload",
      storageKey: buildExpectedStorageKey(FILE_ID, "Evidence-final.pdf"),
      expiresInSeconds: 300,
      input
    }))
    client.rpc.mockImplementation(async (functionName, args) => {
      if (functionName === "allocate_internal_submission_file") {
        expect(args.target_storage_key).toBe(
          buildExpectedStorageKey(FILE_ID, "Evidence-final.pdf")
        )
      } else {
        expect(functionName).toBe(
          "record_internal_submission_file_upload_window"
        )
        expect(args.target_cleanup_after).toBe("2026-07-18T18:10:00.000Z")
      }

      return {
        data: createFileRow({
          id: FILE_ID,
          original_filename: "Evidence final.pdf",
          safe_filename: "Evidence-final.pdf",
          storage_key: buildExpectedStorageKey(FILE_ID, "Evidence-final.pdf")
        }),
        error: null
      }
    })

    const result = await allocateInternalSubmissionFile(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 1,
        fieldKey: "evidence",
        originalFilename: "Evidence final.pdf",
        contentType: "application/pdf",
        byteSize: 1_024,
        checksumSha256: CHECKSUM
      },
      {
        client: client as never,
        createId: () => FILE_ID,
        validateSubmissionUploadRequest: vi.fn(),
        now: () => new Date("2026-07-18T18:00:00.000Z"),
        createSignedSubmissionUploadUrl:
          createSignedSubmissionUploadUrl as never
      }
    )

    expect(result).toMatchObject({
      file: { id: FILE_ID, status: "upload_pending" },
      uploadUrl: "https://r2.example/upload",
      expiresInSeconds: 300
    })
    expect(createSignedSubmissionUploadUrl).toHaveBeenCalledOnce()
    expect(client.rpc).toHaveBeenCalledTimes(2)
  })

  it("reuses exact pending metadata without allocating a second row", async () => {
    const client = createClient({
      submission_files: [
        createFileRow({
          original_filename: "Evidence.pdf",
          safe_filename: "Evidence.pdf"
        })
      ]
    })
    const createId = vi.fn(() => "unexpected")
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("record_internal_submission_file_upload_window")
      expect(args.target_file_id).toBe(FILE_ID)
      return { data: createFileRow(), error: null }
    })

    const result = await allocateInternalSubmissionFile(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 1,
        fieldKey: "evidence",
        originalFilename: "Evidence.pdf",
        contentType: "application/pdf",
        byteSize: 1_024,
        checksumSha256: CHECKSUM
      },
      {
        client: client as never,
        createId,
        validateSubmissionUploadRequest: vi.fn(),
        createSignedSubmissionUploadUrl: vi.fn(async () => ({
          uploadUrl: "https://r2.example/retry",
          storageKey: buildExpectedStorageKey(FILE_ID),
          expiresInSeconds: 300
        }))
      }
    )

    expect(result.uploadUrl).toBe("https://r2.example/retry")
    expect(client.rpc).toHaveBeenCalledOnce()
    expect(createId).not.toHaveBeenCalled()
  })

  it("byte-verifies the bound checksum before completing the allocation", async () => {
    const client = createClient({
      submission_files: [createFileRow()]
    })
    const events: string[] = []
    const verifySubmissionUpload = vi.fn(async (input) => {
      expect(input).toMatchObject({ checksumSha256: CHECKSUM })
      events.push("verify")
    })
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("complete_internal_submission_file")
      expect(args.target_checksum_sha256).toBe(CHECKSUM)
      events.push("rpc")
      return {
        data: createFileRow({ status: "available" }),
        error: null
      }
    })

    const result = await completeInternalSubmissionFile(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        fileId: FILE_ID
      },
      {
        client: client as never,
        verifySubmissionUpload
      }
    )

    expect(events).toEqual(["verify", "rpc"])
    expect(result.file.status).toBe("available")
  })

  it("rejects a same-metadata retry when the selected bytes changed", async () => {
    const client = createClient({
      submission_files: [createFileRow()]
    })

    await expect(
      allocateInternalSubmissionFile(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          expectedRevision: 1,
          fieldKey: "evidence",
          originalFilename: "evidence.pdf",
          contentType: "application/pdf",
          byteSize: 1_024,
          checksumSha256: "b".repeat(64)
        },
        {
          client: client as never,
          validateSubmissionUploadRequest: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      message: "Pending submission file metadata does not match this upload.",
      statusCode: 409
    })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("tombstones an active file before best-effort object cleanup", async () => {
    const client = createClient({
      submission_files: [createFileRow({ status: "available" })]
    })
    const deleteSubmissionStorageObject = vi.fn(async () => undefined)
    client.rpc.mockImplementation(async (functionName) => {
      expect(functionName).toBe("supersede_internal_submission_file")
      return {
        data: {
          ...createFileRow({ status: "superseded" }),
          storage_key: buildExpectedStorageKey(FILE_ID)
        },
        error: null
      }
    })

    await expect(
      supersedeInternalSubmissionFile(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          fileId: FILE_ID
        },
        {
          client: client as never,
          deleteSubmissionStorageObject
        }
      )
    ).resolves.toEqual({
      fileId: FILE_ID,
      storageKey: buildExpectedStorageKey(FILE_ID)
    })
    expect(deleteSubmissionStorageObject).toHaveBeenCalledWith({
      storageKey: buildExpectedStorageKey(FILE_ID)
    })
  })

  it("allows the creator to replace a file after changes are requested", async () => {
    const client = createClient({
      submissions: [
        createAssignedSubmissionRow({
          status: "needs_changes",
          revision: 4
        })
      ],
      submission_files: [createFileRow({ status: "available" })]
    })
    client.rpc.mockResolvedValue({
      data: {
        ...createFileRow({ status: "superseded" }),
        storage_key: buildExpectedStorageKey(FILE_ID)
      },
      error: null
    })

    await expect(
      supersedeInternalSubmissionFile(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          fileId: FILE_ID
        },
        {
          client: client as never,
          deleteSubmissionStorageObject: vi.fn(async () => undefined)
        }
      )
    ).resolves.toMatchObject({ fileId: FILE_ID })
  })

  it("deletes bytes that arrive after their upload allocation was cancelled", async () => {
    const client = createClient({
      submission_files: [
        createFileRow({
          status: "superseded",
          superseded_by: STAFF_ID,
          superseded_at: "2026-07-18T18:00:00.000Z",
          storage_cleaned_at: null
        })
      ]
    })
    const deleteSubmissionStorageObject = vi.fn(async () => undefined)

    await expect(
      completeInternalSubmissionFile(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          fileId: FILE_ID
        },
        {
          client: client as never,
          deleteSubmissionStorageObject
        }
      )
    ).rejects.toMatchObject({
      message: "This submission file upload was cancelled.",
      statusCode: 409
    })
    expect(deleteSubmissionStorageObject).toHaveBeenCalledWith({
      storageKey: buildExpectedStorageKey(FILE_ID)
    })
  })

  it("signs downloads only for available visible files", async () => {
    const client = createClient({
      submission_files: [createFileRow({ status: "available" })]
    })
    const result = await createInternalSubmissionFileDownloadUrl(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        fileId: FILE_ID
      },
      {
        client: client as never,
        createSignedSubmissionDownloadUrl: vi.fn(async () => ({
          downloadUrl: "https://r2.example/download",
          expiresInSeconds: 300
        }))
      }
    )

    expect(result).toEqual({
      downloadUrl: "https://r2.example/download",
      expiresInSeconds: 300
    })
  })

  it("does not sign a download while the file is pending", async () => {
    const client = createClient({
      submission_files: [createFileRow()]
    })
    const createSignedSubmissionDownloadUrl = vi.fn()

    await expect(
      createInternalSubmissionFileDownloadUrl(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          fileId: FILE_ID
        },
        {
          client: client as never,
          createSignedSubmissionDownloadUrl
        }
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(createSignedSubmissionDownloadUrl).not.toHaveBeenCalled()
  })
})

describe("internal submission file cleanup", () => {
  it("deletes only expired tombstones and marks each successful cleanup", async () => {
    const futureFileId = "50000000-0000-4000-8000-000000000002"
    const dueRow = createFileRow({
      status: "superseded",
      cleanup_after: "2026-07-18T17:59:00.000Z",
      storage_cleaned_at: null
    })
    const client = createClient({
      submission_files: [
        dueRow,
        createFileRow({
          id: futureFileId,
          status: "superseded",
          storage_key: buildExpectedStorageKey(futureFileId),
          cleanup_after: "2026-07-18T18:01:00.000Z",
          storage_cleaned_at: null
        }),
        createFileRow({ status: "available" })
      ]
    })
    const deleteSubmissionStorageObject = vi.fn(async () => undefined)
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("mark_internal_submission_file_storage_cleaned")
      expect(args).toEqual({
        target_file_id: FILE_ID,
        target_storage_key: buildExpectedStorageKey(FILE_ID)
      })
      return {
        data: {
          ...dueRow,
          storage_cleaned_at: "2026-07-18T18:00:00.000Z"
        },
        error: null
      }
    })

    const result = await cleanupExpiredSubmissionFileObjects(
      {},
      {
        client: client as never,
        deleteSubmissionStorageObject,
        now: () => new Date("2026-07-18T18:00:00.000Z")
      }
    )

    expect(result).toEqual({ attempted: 1, cleaned: 1, failed: 0 })
    expect(deleteSubmissionStorageObject).toHaveBeenCalledWith({
      storageKey: buildExpectedStorageKey(FILE_ID)
    })
    expect(client.rpc).toHaveBeenCalledOnce()
  })
})

describe("abandoned submission file expiry", () => {
  it("expires abandoned drafts and dead uploads in one bounded database pass", async () => {
    const client = createClient()

    client.rpc.mockResolvedValue({
      data: { expired_drafts: 2, expired_files: 5 },
      error: null
    })

    await expect(
      expireAbandonedSubmissionFiles({}, { client: client as never })
    ).resolves.toEqual({ expiredDrafts: 2, expiredFiles: 5 })
    expect(client.rpc).toHaveBeenCalledWith(
      "expire_abandoned_submission_files",
      { target_batch_size: 250 }
    )
  })

  it.each([0, 1_001, 2.5])(
    "refuses batch size %s before it reaches the database",
    async (batchSize: number) => {
      const client = createClient()

      await expect(
        expireAbandonedSubmissionFiles({ batchSize }, { client: client as never })
      ).rejects.toThrow(RangeError)
      expect(client.rpc).not.toHaveBeenCalled()
    }
  )

  it("reports a database failure instead of a partial result", async () => {
    const client = createClient()
    const failure = Object.assign(new Error("connection reset"), {
      code: "08006"
    })

    client.rpc.mockResolvedValue({ data: null, error: failure })

    await expect(
      expireAbandonedSubmissionFiles({}, { client: client as never })
    ).rejects.toMatchObject({ statusCode: 500 })
  })
})

function createClient(overrides: Partial<FakeTables> = {}): FakeClient {
  return new FakeClient({
    organization_memberships: [
      createMembership(MANAGER_ID, "manager"),
      createMembership(STAFF_ID, "staff"),
      createMembership(OTHER_STAFF_ID, "staff"),
      createMembership(EXTERNAL_ID, "external_reviewer")
    ],
    document_templates: [
      {
        id: TEMPLATE_ID,
        org_id: ORGANIZATION_ID,
        status: "published",
        content: SNAPSHOT
      }
    ],
    submissions: [
      createSubmissionRow(),
      createSubmissionRow({
        id: OTHER_SUBMISSION_ID,
        created_by: OTHER_STAFF_ID,
        updated_by: OTHER_STAFF_ID,
        updated_at: "2026-07-18T17:00:00.000Z"
      })
    ],
    submission_files: [],
    submission_comments: [],
    submission_activity_events: [],
    ...overrides
  })
}

function createMembership(userId: string, role: string): FakeRow {
  return {
    org_id: ORGANIZATION_ID,
    user_id: userId,
    role,
    status: "active"
  }
}

function createSubmissionRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: SUBMISSION_ID,
    org_id: ORGANIZATION_ID,
    title: "Vendor intake",
    template_id: TEMPLATE_ID,
    template_revision: 3,
    template_snapshot: SNAPSHOT,
    values: {},
    status: "draft",
    revision: 1,
    created_by: STAFF_ID,
    updated_by: STAFF_ID,
    submitted_by: null,
    assigned_to: null,
    assigned_by: null,
    created_at: "2026-07-18T15:00:00.000Z",
    updated_at: "2026-07-18T16:00:00.000Z",
    submitted_at: null,
    assigned_at: null,
    ...overrides
  }
}

// Row 1 is the most recently updated, and ids rise with the row number.
function createSubmissionRows(count: number, overrides: FakeRow = {}): FakeRow[] {
  return [...Array(count).keys()].map(
    (index: number): FakeRow => createNumberedSubmissionRow(index + 1, overrides)
  )
}

function createNumberedSubmissionRow(
  rowNumber: number,
  overrides: FakeRow = {}
): FakeRow {
  return createSubmissionRow({
    id: getNumberedSubmissionId(rowNumber),
    title: `Submission ${String(rowNumber).padStart(4, "0")}`,
    updated_at: new Date(
      Date.UTC(2026, 6, 18, 12) - rowNumber * 60_000
    ).toISOString(),
    ...overrides
  })
}

function getNumberedSubmissionId(rowNumber: number): string {
  return `41000000-0000-4000-8000-${String(rowNumber).padStart(12, "0")}`
}

function createPageInput(
  actorUserId: string,
  overrides: Partial<ListSubmissionPageInput> = {}
): ListSubmissionPageInput {
  return {
    actorUserId,
    organizationId: ORGANIZATION_ID,
    page: 1,
    pageSize: 25,
    sort: { direction: "desc", key: "updated" },
    ...overrides
  }
}

function createAssignedSubmissionRow(overrides: FakeRow = {}): FakeRow {
  return createSubmissionRow({
    status: "in_review",
    revision: 3,
    submitted_by: STAFF_ID,
    submitted_at: "2026-07-18T17:00:00.000Z",
    assigned_to: EXTERNAL_ID,
    assigned_by: MANAGER_ID,
    assigned_at: "2026-07-18T17:05:00.000Z",
    ...overrides
  })
}

function createCommentRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: COMMENT_ID,
    org_id: ORGANIZATION_ID,
    submission_id: SUBMISSION_ID,
    body: "Please confirm the attachment.",
    created_by: EXTERNAL_ID,
    created_at: "2026-07-18T17:10:00.000Z",
    ...overrides
  }
}

function createActivityRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: ACTIVITY_ID,
    org_id: ORGANIZATION_ID,
    submission_id: SUBMISSION_ID,
    actor_user_id: MANAGER_ID,
    event_type: "assigned",
    from_status: "submitted",
    to_status: "in_review",
    assignee_user_id: EXTERNAL_ID,
    comment_id: null,
    submission_revision: 3,
    created_at: "2026-07-18T17:05:00.000Z",
    ...overrides
  }
}

function createFileRow(overrides: FakeRow = {}): FakeRow {
  const available = overrides.status === "available"

  return {
    id: FILE_ID,
    org_id: ORGANIZATION_ID,
    submission_id: SUBMISSION_ID,
    field_key: "evidence",
    status: "upload_pending",
    storage_key: buildExpectedStorageKey(FILE_ID),
    original_filename: "evidence.pdf",
    safe_filename: "evidence.pdf",
    content_type: "application/pdf",
    byte_size: 1_024,
    checksum_sha256: available ? CHECKSUM : null,
    expected_checksum_sha256: CHECKSUM,
    uploaded_by: STAFF_ID,
    created_at: "2026-07-18T16:10:00.000Z",
    updated_at: "2026-07-18T16:10:00.000Z",
    available_at: available ? "2026-07-18T16:11:00.000Z" : null,
    superseded_by: null,
    superseded_at: null,
    cleanup_after: "2026-07-18T16:30:00.000Z",
    storage_cleaned_at: null,
    ...overrides
  }
}

function buildExpectedStorageKey(
  fileId: string,
  filename = "evidence.pdf"
): string {
  return `organizations/${ORGANIZATION_ID}/submissions/${SUBMISSION_ID}/files/evidence/${fileId}/${filename}`
}

function createSnapshot(): TemplateContent {
  return parseTemplateContent({
    schemaVersion: 2,
    blocks: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        type: "text_field",
        fieldKey: "vendor_name",
        label: "Vendor name",
        required: true,
        helpText: null,
        placeholder: null,
        multiline: false
      },
      {
        id: "60000000-0000-4000-8000-000000000002",
        type: "text_field",
        fieldKey: "notes",
        label: "Notes",
        required: false,
        helpText: null,
        placeholder: null,
        multiline: true
      },
      {
        id: "60000000-0000-4000-8000-000000000003",
        type: "file_field",
        fieldKey: "evidence",
        label: "Evidence",
        required: true,
        helpText: null
      }
    ]
  })
}
