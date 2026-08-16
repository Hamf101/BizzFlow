import { z } from "zod"

import {
  deleteSubmissionStorageObject as defaultDeleteSubmissionStorageObject,
} from "@/services/submission-storage-service"
import type {
  SubmissionServiceClient,
  SubmissionServiceDeps,
} from "@/services/submissions/contracts"
import {
  createSubmissionDatabaseError,
  getSubmissionClient,
} from "@/services/submissions/shared"

const DEFAULT_CLEANUP_BATCH_SIZE = 100
const MAX_CLEANUP_BATCH_SIZE = 250

const cleanupFileRowSchema = z.object({
  id: z.string().uuid(),
  storage_key: z.string().min(1).max(1_024),
  cleanup_after: z.string().datetime({ offset: true }),
})

type CleanupFileRow = z.infer<typeof cleanupFileRowSchema>

/** Summary returned by one bounded submission-file cleanup pass. */
export type SubmissionFileCleanupResult = {
  attempted: number
  cleaned: number
  failed: number
}

/** Input for one scheduled superseded-object cleanup pass. */
export type CleanupExpiredSubmissionFilesInput = {
  batchSize?: number
}

/**
 * Deletes expired objects retained by superseded submission-file allocations.
 *
 * Each object deletion is idempotent. The database row is marked only after R2
 * accepts the delete, so an interrupted pass is safe to retry on the next run.
 *
 * @param input - Optional bounded batch size.
 * @param deps - Optional trusted database, clock, and storage dependencies.
 * @returns Counts for attempted, completed, and deferred cleanup records.
 * @throws SubmissionServiceError when the due-record query fails.
 */
export async function cleanupExpiredSubmissionFileObjects(
  input: CleanupExpiredSubmissionFilesInput = {},
  deps: SubmissionServiceDeps = {}
): Promise<SubmissionFileCleanupResult> {
  const startedAt = Date.now()
  const client = getSubmissionClient(deps)
  const batchSize = normalizeBatchSize(input.batchSize)
  const now = deps.now?.() ?? new Date()
  const rows = await listExpiredCleanupRows(client, now, batchSize)
  const deleteObject =
    deps.deleteSubmissionStorageObject ?? defaultDeleteSubmissionStorageObject
  let cleaned = 0
  let failed = 0

  for (const row of rows) {
    try {
      await deleteObject({ storageKey: row.storage_key })
      const { data, error } = await client.rpc(
        "mark_internal_submission_file_storage_cleaned",
        {
          target_file_id: row.id,
          target_storage_key: row.storage_key,
        }
      )

      if (error || !data) {
        throw createSubmissionDatabaseError(
          error,
          "Unable to mark a submission file object as cleaned."
        )
      }

      cleaned += 1
    } catch (error: unknown) {
      failed += 1
      console.error("submission_file_scheduled_cleanup_failed", {
        fileId: row.id,
        reason: error instanceof Error ? error.name : "Unknown cleanup error",
      })
    }
  }

  const result = { attempted: rows.length, cleaned, failed }
  console.info("submission_file_scheduled_cleanup_completed", {
    ...result,
    durationMs: Date.now() - startedAt,
  })
  return result
}

async function listExpiredCleanupRows(
  client: SubmissionServiceClient,
  now: Date,
  batchSize: number
): Promise<CleanupFileRow[]> {
  const { data, error } = await client
    .from("submission_files")
    .select("id,storage_key,cleanup_after")
    .eq("status", "superseded")
    .is("storage_cleaned_at", null)
    .lte("cleanup_after", now.toISOString())
    .order("cleanup_after", { ascending: true })
    .limit(batchSize)

  if (error || !data) {
    throw createSubmissionDatabaseError(
      error,
      "Unable to load expired submission file cleanups."
    )
  }

  return cleanupFileRowSchema.array().parse(data)
}

function normalizeBatchSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_CLEANUP_BATCH_SIZE
  }

  if (!Number.isInteger(value) || value < 1 || value > MAX_CLEANUP_BATCH_SIZE) {
    throw new RangeError(
      `Submission cleanup batch size must be between 1 and ${MAX_CLEANUP_BATCH_SIZE}.`
    )
  }

  return value
}
