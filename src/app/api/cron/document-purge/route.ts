import { createNoStoreResponse, refuseCronRequest } from "@/app/api/cron/_cron"
import { captureUnexpectedError, describeErrorForLog } from "@/lib/observability"
import { processDueResourcePurges } from "@/services/document-service"

/** Leaves the batch room to finish rather than be killed mid-delete. */
export const maxDuration = 300

/**
 * Processes a bounded batch of due document and folder purge work.
 *
 * @param request - Scheduler request (any host's cron) authenticated with `CRON_SECRET`.
 * @returns Content-free queue, object, retry, and finalization counts.
 */
export async function GET(request: Request): Promise<Response> {
  const startedAt = Date.now()
  const refusal = refuseCronRequest(
    request,
    { event: "document_purge_cron", notConfigured: "Document purge is not configured." },
    startedAt
  )

  if (refusal) {
    return refusal
  }

  try {
    const result = await processDueResourcePurges()
    return createNoStoreResponse(result, 200)
  } catch (error: unknown) {
    console.error("document_purge_cron_failed", {
      durationMs: Date.now() - startedAt,
      ...describeErrorForLog(error),
    })
    captureUnexpectedError(error, { routeName: "cron_document_purge" })
    return createNoStoreResponse({ error: "Document purge failed." }, 500)
  }
}
