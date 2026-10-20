import { createNoStoreResponse, monitoredCronResponse, refuseCronRequest } from "@/app/api/cron/_cron"
import { captureUnexpectedError, describeErrorForLog } from "@/lib/observability"
import {
  cleanupExpiredSubmissionFileObjects,
  expireAbandonedSubmissionFiles,
  type SubmissionFileExpiryResult,
} from "@/services/submission-service"

/** Leaves the batch room to finish rather than be killed mid-delete. */
export const maxDuration = 300

/**
 * Expires abandoned public drafts and dead uploads, then removes the expired
 * R2 objects they and cancelled uploads left behind.
 *
 * @param request - Scheduler request (any host's cron) authenticated with `CRON_SECRET`.
 * @returns Bounded cleanup counts without exposing object keys.
 */
export async function GET(request: Request): Promise<Response> {
  const startedAt = Date.now()
  const refusal = refuseCronRequest(
    request,
    { event: "submission_file_cleanup_cron", notConfigured: "Submission cleanup is not configured." },
    startedAt
  )

  if (refusal) {
    return refusal
  }

  return monitoredCronResponse("submission-file-cleanup", "15 3 * * *", async (): Promise<Response> => {
    try {
      const expiry = await expireAbandonedFilesOrReport(startedAt)
      const cleanup = await cleanupExpiredSubmissionFileObjects()

      if (!expiry) {
        return createNoStoreResponse(
          { error: "Submission file cleanup failed." },
          500
        )
      }

      return createNoStoreResponse({ ...expiry, ...cleanup }, 200)
    } catch (error: unknown) {
      console.error("submission_file_cleanup_cron_failed", {
        durationMs: Date.now() - startedAt,
        ...describeErrorForLog(error),
      })
      captureUnexpectedError(error, { routeName: "cron_submission_file_cleanup" })
      return createNoStoreResponse(
        { error: "Submission file cleanup failed." },
        500
      )
    }
  })
}

// Expiry and cleanup are independent: objects superseded by earlier passes are
// still removed when this pass's expiry fails, and the failure is reported.
async function expireAbandonedFilesOrReport(
  startedAt: number
): Promise<SubmissionFileExpiryResult | null> {
  try {
    return await expireAbandonedSubmissionFiles()
  } catch (error: unknown) {
    console.error("submission_file_expiry_cron_failed", {
      durationMs: Date.now() - startedAt,
      ...describeErrorForLog(error),
    })
    captureUnexpectedError(error, { routeName: "cron_submission_file_expiry" })
    return null
  }
}
