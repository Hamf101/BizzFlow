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
const DEFAULT_EXPIRY_BATCH_SIZE = 250
const MAX_EXPIRY_BATCH_SIZE = 1_000

const cleanupFileRowSchema = z.object({
  id: z.string().uuid(),
  storage_key: z.string().min(1).max(1_024),
  cleanup_after: z.string().datetime({ offset: true }),
})

const expiryResultSchema = z.object({
  expired_drafts: z.number().int().nonnegative(),
  expired_files: z.number().int().nonnegative(),
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

/** Summary returned by one bounded abandoned-upload expiry pass. */
export type SubmissionFileExpiryResult = {
  expiredDrafts: number
  expiredFiles: number
}

/** Input for one scheduled abandoned-upload expiry pass. */
export type ExpireAbandonedSubmissionFilesInput = {
  batchSize?: number
}

/**
 * Expires abandoned public drafts and uploads whose window has elapsed.
 *
 * One database pass clears the handle of each public draft nobody has saved or
 * uploaded to for a day, so it can never be resumed or submitted, and hands
 * its files and every dead upload to the superseded-object cleanup. Drafts
 * locked by a submission in progress are left for the next pass.
 *
 * @param input - Optional bounded batch size.
 * @param deps - Optional trusted database dependency.
 * @returns How many drafts and files were expired.
 * @throws RangeError when the batch size is out of bounds.
 * @throws SubmissionServiceError when the database pass fails.
 */
export async function expireAbandonedSubmissionFiles(
  input: ExpireAbandonedSubmissionFilesInput = {},
  deps: SubmissionServiceDeps = {}
): Promise<SubmissionFileExpiryResult> {
  const startedAt = Date.now()
  const batchSize = normalizeBatchSize(input.batchSize, {
    defaultSize: DEFAULT_EXPIRY_BATCH_SIZE,
    label: "Submission expiry",
    maxSize: MAX_EXPIRY_BATCH_SIZE,
  })
  const client = getSubmissionClient(deps)
  const { data, error } = await client.rpc(
    "expire_abandoned_submission_files",
    { target_batch_size: batchSize }
  )

  if (error || !data) {
    throw createSubmissionDatabaseError(
      error,
      "Unable to expire abandoned submission files."
    )
  }

  const expired = expiryResultSchema.parse(data)
  const result = {
    expiredDrafts: expired.expired_drafts,
    expiredFiles: expired.expired_files,
  }

  console.info("submission_file_expiry_completed", {
    ...result,
    durationMs: Date.now() - startedAt,
  })
  return result
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
  const batchSize = normalizeBatchSize(input.batchSize, {
    defaultSize: DEFAULT_CLEANUP_BATCH_SIZE,
    label: "Submission cleanup",
    maxSize: MAX_CLEANUP_BATCH_SIZE,
  })
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

function normalizeBatchSize(
  value: number | undefined,
  bounds: { defaultSize: number; label: string; maxSize: number }
): number {
  if (value === undefined) {
    return bounds.defaultSize
  }

  if (!Number.isInteger(value) || value < 1 || value > bounds.maxSize) {
    throw new RangeError(
      `${bounds.label} batch size must be between 1 and ${bounds.maxSize}.`
    )
  }

  return value
}
