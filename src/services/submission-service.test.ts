import { describe, expect, it, vi } from "vitest"

import {
  allocateInternalSubmissionFile,
  assignInternalSubmission,
  cleanupExpiredSubmissionFileObjects,
  completeInternalSubmissionFile,
  createInternalSubmissionComment,
  createInternalSubmissionDraft,
  createInternalSubmissionFileDownloadUrl,
  getInternalSubmission,
  listInternalSubmissions,
  saveInternalSubmissionDraft,
  submitInternalSubmission,
  supersedeInternalSubmissionFile,
  transitionInternalSubmission,
} from "@/services/submission-service"
import {
  parseTemplateContent,
  type TemplateContent,
} from "@/types/template"

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

class FakeQuery implements PromiseLike<FakeResult> {
  private readonly filters: Array<(row: FakeRow) => boolean> = []
  private orderColumn: string | null = null
  private orderAscending = true
  private limitCount: number | null = null

  constructor(
    private readonly tableName: string,
    private readonly tables: FakeTables
  ) {}

  select(): FakeQuery {
    return this
  }

  eq(column: string, value: unknown): FakeQuery {
    this.filters.push((row: FakeRow): boolean => row[column] === value)
    return this
  }

  in(column: string, values: readonly unknown[]): FakeQuery {
    this.filters.push((row: FakeRow): boolean => values.includes(row[column]))
    return this
  }

  is(column: string, value: unknown): FakeQuery {
    this.filters.push((row: FakeRow): boolean => row[column] === value)
    return this
  }

  lte(column: string, value: unknown): FakeQuery {
    this.filters.push(
      (row: FakeRow): boolean => String(row[column]) <= String(value)
    )
    return this
  }

  order(column: string, options: { ascending: boolean }): FakeQuery {
    this.orderColumn = column
    this.orderAscending = options.ascending
    return this
  }

  limit(value: number): FakeQuery {
    this.limitCount = value
    return this
  }

  async maybeSingle(): Promise<FakeResult> {
    const rows = this.execute()
    return {
      data: rows.length === 1 ? rows[0] : null,
      error:
        rows.length > 1
          ? Object.assign(new Error("Expected one row."), {
              code: "PGRST116",
            })
          : null,
    }
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.execute(), error: null }).then(
      onfulfilled,
      onrejected
    )
  }

  private execute(): FakeRow[] {
    let rows = (this.tables[this.tableName] ?? []).filter(
      (row: FakeRow): boolean =>
        this.filters.every((filter): boolean => filter(row))
    )

    if (this.orderColumn) {
      const orderColumn = this.orderColumn
      const direction = this.orderAscending ? 1 : -1
      rows = [...rows].sort((left: FakeRow, right: FakeRow): number =>
        String(left[orderColumn]).localeCompare(String(right[orderColumn])) *
        direction
      )
    }

    if (this.limitCount !== null) {
      rows = rows.slice(0, this.limitCount)
    }

    return rows
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

    const managerRows = await listInternalSubmissions(
      { actorUserId: MANAGER_ID, organizationId: ORGANIZATION_ID },
      { client: client as never }
    )
    const staffRows = await listInternalSubmissions(
      { actorUserId: STAFF_ID, organizationId: ORGANIZATION_ID },
      { client: client as never }
    )

    expect(managerRows.map((submission) => submission.id)).toEqual([
      OTHER_SUBMISSION_ID,
      SUBMISSION_ID,
    ])
    expect(staffRows.map((submission) => submission.id)).toEqual([
      SUBMISSION_ID,
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
          assigned_at: "2026-07-18T17:05:00.000Z",
        }),
        createSubmissionRow({
          id: OTHER_SUBMISSION_ID,
          status: "submitted",
          submitted_by: OTHER_STAFF_ID,
          submitted_at: "2026-07-18T17:00:00.000Z",
          created_by: OTHER_STAFF_ID,
          updated_by: OTHER_STAFF_ID,
          updated_at: "2026-07-18T17:00:00.000Z",
        }),
      ],
    })

    const externalRows = await listInternalSubmissions(
      { actorUserId: EXTERNAL_ID, organizationId: ORGANIZATION_ID },
      { client: client as never }
    )

    expect(externalRows.map((submission) => submission.id)).toEqual([
      SUBMISSION_ID,
    ])

    await expect(
      getInternalSubmission(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: OTHER_SUBMISSION_ID,
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
          status: "available",
        }),
      ],
      submission_comments: [createCommentRow()],
      submission_activity_events: [createActivityRow()],
    })

    const detail = await getInternalSubmission(
      {
        actorUserId: EXTERNAL_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
      },
      { client: client as never }
    )

    expect(detail.files).toHaveLength(1)
    expect(detail.files[0]).toMatchObject({ status: "available" })
    expect(detail.comments).toEqual([
      expect.objectContaining({
        id: COMMENT_ID,
        body: "Please confirm the attachment.",
      }),
    ])
    expect(detail.activity).toEqual([
      expect.objectContaining({
        id: ACTIVITY_ID,
        eventType: "assigned",
        fromStatus: "submitted",
        toStatus: "in_review",
      }),
    ])
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
        target_actor_user_id: STAFF_ID,
      })
      return {
        data: createSubmissionRow({ values: {}, revision: 1 }),
        error: null,
      }
    })

    const result = await createInternalSubmissionDraft(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        templateId: TEMPLATE_ID,
        title: "  Vendor   intake ",
      },
      {
        client: client as never,
      }
    )

    expect(result).toMatchObject({ id: SUBMISSION_ID, status: "draft" })
  })

  it("merges a form patch over persisted values before saving", async () => {
    const client = createClient({
      submissions: [
        createSubmissionRow({
          values: { vendor_name: "Old", notes: "Keep this" },
        }),
      ],
    })
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("save_internal_submission_draft")
      expect(args.target_values).toEqual({
        vendor_name: "Northstar",
        notes: "Keep this",
      })
      return {
        data: createSubmissionRow({
          values: args.target_values,
          revision: 2,
        }),
        error: null,
      }
    })

    const result = await saveInternalSubmissionDraft(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 1,
        values: { vendor_name: " Northstar " },
      },
      { client: client as never }
    )

    expect(result).toMatchObject({
      revision: 2,
      values: { vendor_name: "Northstar", notes: "Keep this" },
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
          values: {},
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
          values: { vendor_name: "Northstar" },
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      message: "Submission draft has changed. Reload and try again.",
      statusCode: 409,
    })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("submits a complete merged answer set with verified file fields", async () => {
    const client = createClient({
      submissions: [
        createSubmissionRow({
          values: { vendor_name: "Old", notes: "Keep this" },
        }),
      ],
      submission_files: [createFileRow({ status: "available" })],
    })
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("submit_internal_submission")
      expect(args.target_values).toEqual({
        vendor_name: "Northstar",
        notes: "Keep this",
      })
      return {
        data: createSubmissionRow({
          status: "submitted",
          revision: 2,
          values: args.target_values,
          submitted_by: STAFF_ID,
          submitted_at: "2026-07-18T18:00:00.000Z",
        }),
        error: null,
      }
    })

    const result = await submitInternalSubmission(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 1,
        values: { vendor_name: "Northstar" },
      },
      { client: client as never }
    )

    expect(result.status).toBe("submitted")
  })

  it("blocks submit while any upload remains pending", async () => {
    const client = createClient({
      submissions: [
        createSubmissionRow({ values: { vendor_name: "Northstar" } }),
      ],
      submission_files: [createFileRow()],
    })

    await expect(
      submitInternalSubmission(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          expectedRevision: 1,
          values: {},
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      message: "Wait for pending file uploads before submitting.",
      statusCode: 409,
    })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("rejects submit when a required snapshot answer is missing", async () => {
    const client = createClient({
      submissions: [createSubmissionRow()],
      submission_files: [createFileRow({ status: "available" })],
    })

    await expect(
      submitInternalSubmission(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          expectedRevision: 1,
          values: {},
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      message:
        "Vendor name must be completed before this submission can be submitted.",
      statusCode: 400,
    })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("passes an exact submitted retry through to the idempotent RPC", async () => {
    const submittedRow = createSubmissionRow({
      status: "submitted",
      revision: 2,
      values: { vendor_name: "Northstar" },
      submitted_by: STAFF_ID,
      submitted_at: "2026-07-18T18:00:00.000Z",
    })
    const client = createClient({
      submissions: [submittedRow],
      submission_files: [createFileRow({ status: "available" })],
    })
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("submit_internal_submission")
      expect(args).toMatchObject({
        target_expected_revision: 1,
        target_values: { vendor_name: "Northstar" },
      })
      return { data: submittedRow, error: null }
    })

    const result = await submitInternalSubmission(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 1,
        values: {},
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
      values: { vendor_name: "Old", notes: "Keep this" },
    })
    const client = createClient({
      submissions: [needsChangesRow],
      submission_files: [createFileRow({ status: "available" })],
    })
    client.rpc.mockImplementation(async (functionName, args) => {
      if (functionName === "save_internal_submission_draft") {
        return {
          data: createAssignedSubmissionRow({
            status: "needs_changes",
            revision: 5,
            values: args.target_values,
          }),
          error: null,
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
          assigned_at: "2026-07-18T17:05:00.000Z",
        }),
        error: null,
      }
    })

    const saved = await saveInternalSubmissionDraft(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 4,
        values: { vendor_name: "Northstar" },
      },
      { client: client as never }
    )
    const resubmitted = await submitInternalSubmission(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 4,
        values: { vendor_name: "Northstar" },
      },
      { client: client as never }
    )

    expect(saved).toMatchObject({ status: "needs_changes", revision: 5 })
    expect(resubmitted).toMatchObject({
      status: "submitted",
      assignedTo: EXTERNAL_ID,
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
          submitted_at: "2026-07-18T17:00:00.000Z",
        }),
      ],
    })
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("assign_internal_submission")
      expect(args).toEqual({
        target_org_id: ORGANIZATION_ID,
        target_submission_id: SUBMISSION_ID,
        target_expected_revision: 2,
        target_assignee_user_id: EXTERNAL_ID,
        target_actor_user_id: MANAGER_ID,
      })
      return { data: createAssignedSubmissionRow(), error: null }
    })

    const result = await assignInternalSubmission(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 2,
        assignedTo: EXTERNAL_ID,
      },
      { client: client as never }
    )

    expect(result).toMatchObject({
      status: "in_review",
      assignedTo: EXTERNAL_ID,
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
          assignedTo: EXTERNAL_ID,
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
      ),
    })

    await expect(
      assignInternalSubmission(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          expectedRevision: 2,
          assignedTo: EXTERNAL_ID,
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({
      message: "Submission review has changed. Reload and try again.",
      statusCode: 409,
    })
  })

  it("trims a required change request comment before the atomic transition", async () => {
    const client = createClient({
      submissions: [createAssignedSubmissionRow()],
    })
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("transition_internal_submission")
      expect(args).toMatchObject({
        target_expected_revision: 3,
        target_transition: "needs_changes",
        target_comment: "Please correct the total.",
        target_actor_user_id: MANAGER_ID,
      })
      return {
        data: createAssignedSubmissionRow({
          status: "needs_changes",
          revision: 4,
        }),
        error: null,
      }
    })

    const result = await transitionInternalSubmission(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        expectedRevision: 3,
        targetStatus: "needs_changes",
        comment: "  Please correct the total.  ",
      },
      { client: client as never }
    )

    expect(result).toMatchObject({ status: "needs_changes", revision: 4 })
  })

  it("requires a nonblank note before changes or rejection", async () => {
    const client = createClient({
      submissions: [createAssignedSubmissionRow()],
    })

    await expect(
      transitionInternalSubmission(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          expectedRevision: 3,
          targetStatus: "rejected",
          comment: "   ",
        },
        { client: client as never }
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("lets an assigned external reviewer add a general comment", async () => {
    const client = createClient({
      submissions: [createAssignedSubmissionRow()],
    })
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe("create_internal_submission_comment")
      expect(args).toEqual({
        target_org_id: ORGANIZATION_ID,
        target_submission_id: SUBMISSION_ID,
        target_comment_id: COMMENT_ID,
        target_body: "Please confirm the attachment.",
        target_actor_user_id: EXTERNAL_ID,
      })
      return { data: createCommentRow(), error: null }
    })

    const result = await createInternalSubmissionComment(
      {
        actorUserId: EXTERNAL_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        body: "  Please confirm the attachment.  ",
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
      input,
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
          storage_key: buildExpectedStorageKey(FILE_ID, "Evidence-final.pdf"),
        }),
        error: null,
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
        checksumSha256: CHECKSUM,
      },
      {
        client: client as never,
        createId: () => FILE_ID,
        validateSubmissionUploadRequest: vi.fn(),
        now: () => new Date("2026-07-18T18:00:00.000Z"),
        createSignedSubmissionUploadUrl:
          createSignedSubmissionUploadUrl as never,
      }
    )

    expect(result).toMatchObject({
      file: { id: FILE_ID, status: "upload_pending" },
      uploadUrl: "https://r2.example/upload",
      expiresInSeconds: 300,
    })
    expect(createSignedSubmissionUploadUrl).toHaveBeenCalledOnce()
    expect(client.rpc).toHaveBeenCalledTimes(2)
  })

  it("reuses exact pending metadata without allocating a second row", async () => {
    const client = createClient({
      submission_files: [
        createFileRow({
          original_filename: "Evidence.pdf",
          safe_filename: "Evidence.pdf",
        }),
      ],
    })
    const createId = vi.fn(() => "unexpected")
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe(
        "record_internal_submission_file_upload_window"
      )
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
        checksumSha256: CHECKSUM,
      },
      {
        client: client as never,
        createId,
        validateSubmissionUploadRequest: vi.fn(),
        createSignedSubmissionUploadUrl: vi.fn(async () => ({
          uploadUrl: "https://r2.example/retry",
          storageKey: buildExpectedStorageKey(FILE_ID),
          expiresInSeconds: 300,
        })),
      }
    )

    expect(result.uploadUrl).toBe("https://r2.example/retry")
    expect(client.rpc).toHaveBeenCalledOnce()
    expect(createId).not.toHaveBeenCalled()
  })

  it("byte-verifies the bound checksum before completing the allocation", async () => {
    const client = createClient({
      submission_files: [createFileRow()],
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
        error: null,
      }
    })

    const result = await completeInternalSubmissionFile(
      {
        actorUserId: STAFF_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        fileId: FILE_ID,
      },
      {
        client: client as never,
        verifySubmissionUpload,
      }
    )

    expect(events).toEqual(["verify", "rpc"])
    expect(result.file.status).toBe("available")
  })

  it("rejects a same-metadata retry when the selected bytes changed", async () => {
    const client = createClient({
      submission_files: [createFileRow()],
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
          checksumSha256: "b".repeat(64),
        },
        {
          client: client as never,
          validateSubmissionUploadRequest: vi.fn(),
        }
      )
    ).rejects.toMatchObject({
      message: "Pending submission file metadata does not match this upload.",
      statusCode: 409,
    })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("tombstones an active file before best-effort object cleanup", async () => {
    const client = createClient({
      submission_files: [createFileRow({ status: "available" })],
    })
    const deleteSubmissionStorageObject = vi.fn(async () => undefined)
    client.rpc.mockImplementation(async (functionName) => {
      expect(functionName).toBe("supersede_internal_submission_file")
      return {
        data: {
          ...createFileRow({ status: "superseded" }),
          storage_key: buildExpectedStorageKey(FILE_ID),
        },
        error: null,
      }
    })

    await expect(
      supersedeInternalSubmissionFile(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          fileId: FILE_ID,
        },
        {
          client: client as never,
          deleteSubmissionStorageObject,
        }
      )
    ).resolves.toEqual({
      fileId: FILE_ID,
      storageKey: buildExpectedStorageKey(FILE_ID),
    })
    expect(deleteSubmissionStorageObject).toHaveBeenCalledWith({
      storageKey: buildExpectedStorageKey(FILE_ID),
    })
  })

  it("allows the creator to replace a file after changes are requested", async () => {
    const client = createClient({
      submissions: [
        createAssignedSubmissionRow({
          status: "needs_changes",
          revision: 4,
        }),
      ],
      submission_files: [createFileRow({ status: "available" })],
    })
    client.rpc.mockResolvedValue({
      data: {
        ...createFileRow({ status: "superseded" }),
        storage_key: buildExpectedStorageKey(FILE_ID),
      },
      error: null,
    })

    await expect(
      supersedeInternalSubmissionFile(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          fileId: FILE_ID,
        },
        {
          client: client as never,
          deleteSubmissionStorageObject: vi.fn(async () => undefined),
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
          storage_cleaned_at: null,
        }),
      ],
    })
    const deleteSubmissionStorageObject = vi.fn(async () => undefined)

    await expect(
      completeInternalSubmissionFile(
        {
          actorUserId: STAFF_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          fileId: FILE_ID,
        },
        {
          client: client as never,
          deleteSubmissionStorageObject,
        }
      )
    ).rejects.toMatchObject({
      message: "This submission file upload was cancelled.",
      statusCode: 409,
    })
    expect(deleteSubmissionStorageObject).toHaveBeenCalledWith({
      storageKey: buildExpectedStorageKey(FILE_ID),
    })
  })

  it("signs downloads only for available visible files", async () => {
    const client = createClient({
      submission_files: [createFileRow({ status: "available" })],
    })
    const result = await createInternalSubmissionFileDownloadUrl(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        fileId: FILE_ID,
      },
      {
        client: client as never,
        createSignedSubmissionDownloadUrl: vi.fn(async () => ({
          downloadUrl: "https://r2.example/download",
          expiresInSeconds: 300,
        })),
      }
    )

    expect(result).toEqual({
      downloadUrl: "https://r2.example/download",
      expiresInSeconds: 300,
    })
  })

  it("does not sign a download while the file is pending", async () => {
    const client = createClient({
      submission_files: [createFileRow()],
    })
    const createSignedSubmissionDownloadUrl = vi.fn()

    await expect(
      createInternalSubmissionFileDownloadUrl(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORGANIZATION_ID,
          submissionId: SUBMISSION_ID,
          fileId: FILE_ID,
        },
        {
          client: client as never,
          createSignedSubmissionDownloadUrl,
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
      storage_cleaned_at: null,
    })
    const client = createClient({
      submission_files: [
        dueRow,
        createFileRow({
          id: futureFileId,
          status: "superseded",
          storage_key: buildExpectedStorageKey(futureFileId),
          cleanup_after: "2026-07-18T18:01:00.000Z",
          storage_cleaned_at: null,
        }),
        createFileRow({ status: "available" }),
      ],
    })
    const deleteSubmissionStorageObject = vi.fn(async () => undefined)
    client.rpc.mockImplementation(async (functionName, args) => {
      expect(functionName).toBe(
        "mark_internal_submission_file_storage_cleaned"
      )
      expect(args).toEqual({
        target_file_id: FILE_ID,
        target_storage_key: buildExpectedStorageKey(FILE_ID),
      })
      return {
        data: {
          ...dueRow,
          storage_cleaned_at: "2026-07-18T18:00:00.000Z",
        },
        error: null,
      }
    })

    const result = await cleanupExpiredSubmissionFileObjects(
      {},
      {
        client: client as never,
        deleteSubmissionStorageObject,
        now: () => new Date("2026-07-18T18:00:00.000Z"),
      }
    )

    expect(result).toEqual({ attempted: 1, cleaned: 1, failed: 0 })
    expect(deleteSubmissionStorageObject).toHaveBeenCalledWith({
      storageKey: buildExpectedStorageKey(FILE_ID),
    })
    expect(client.rpc).toHaveBeenCalledOnce()
  })
})

function createClient(overrides: Partial<FakeTables> = {}): FakeClient {
  return new FakeClient({
    organization_memberships: [
      createMembership(MANAGER_ID, "manager"),
      createMembership(STAFF_ID, "staff"),
      createMembership(OTHER_STAFF_ID, "staff"),
      createMembership(EXTERNAL_ID, "external_reviewer"),
    ],
    document_templates: [
      {
        id: TEMPLATE_ID,
        org_id: ORGANIZATION_ID,
        status: "published",
        content: SNAPSHOT,
      },
    ],
    submissions: [
      createSubmissionRow(),
      createSubmissionRow({
        id: OTHER_SUBMISSION_ID,
        created_by: OTHER_STAFF_ID,
        updated_by: OTHER_STAFF_ID,
        updated_at: "2026-07-18T17:00:00.000Z",
      }),
    ],
    submission_files: [],
    submission_comments: [],
    submission_activity_events: [],
    ...overrides,
  })
}

function createMembership(userId: string, role: string): FakeRow {
  return {
    org_id: ORGANIZATION_ID,
    user_id: userId,
    role,
    status: "active",
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
    ...overrides,
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
    ...overrides,
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
    ...overrides,
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
    ...overrides,
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
    ...overrides,
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
    schemaVersion: 1,
    sections: {
      header: { blocks: [] },
      body: {
        blocks: [
          {
            id: "60000000-0000-4000-8000-000000000001",
            type: "text_field",
            fieldKey: "vendor_name",
            label: "Vendor name",
            required: true,
            helpText: null,
            placeholder: null,
            multiline: false,
          },
          {
            id: "60000000-0000-4000-8000-000000000002",
            type: "text_field",
            fieldKey: "notes",
            label: "Notes",
            required: false,
            helpText: null,
            placeholder: null,
            multiline: true,
          },
          {
            id: "60000000-0000-4000-8000-000000000003",
            type: "file_field",
            fieldKey: "evidence",
            label: "Evidence",
            required: true,
            helpText: null,
          },
        ],
      },
      footer: { blocks: [] },
    },
  })
}
