import { createNoStoreResponse, monitoredCronResponse, refuseCronRequest } from "@/app/api/cron/_cron"
import { captureUnexpectedError, describeErrorForLog } from "@/lib/observability"
import { cleanupAbandonedDocumentUploads, processDueResourcePurges } from "@/services/document-service"
import { cleanupAbandonedSigningAttachments } from "@/services/pdf-signing-service"
import { purgeDueTrashedTemplates } from "@/services/template-service"

/** Leaves the batch room to finish rather than be killed mid-delete. */
export const maxDuration = 300

/**
 * Processes a bounded batch of due document and folder purge work, then
 * empties Trash of templates that have been there 30 days.
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

  return monitoredCronResponse("document-purge", "45 3 * * *", async (): Promise<Response> => {
    // Each runs whatever the others do, so one failing never stalls the rest.
    const [documents, templates, uploads, attachments] = await Promise.allSettled([
      processDueResourcePurges(),
      purgeDueTrashedTemplates(),
      cleanupAbandonedDocumentUploads(),
      cleanupAbandonedSigningAttachments(),
    ])

    if (documents.status === "fulfilled" && templates.status === "fulfilled" && uploads.status === "fulfilled" && attachments.status === "fulfilled") {
      return createNoStoreResponse(
        { ...documents.value, templatesPurged: templates.value, abandonedUploads: uploads.value, abandonedSigningAttachments: attachments.value },
        200
      )
    }

    for (const failed of [documents, templates, uploads, attachments]) {
      if (failed.status === "rejected") {
        console.error("document_purge_cron_failed", {
          durationMs: Date.now() - startedAt,
          ...describeErrorForLog(failed.reason),
        })
        captureUnexpectedError(failed.reason, { routeName: "cron_document_purge" })
      }
    }

    return createNoStoreResponse({ error: "Document purge failed." }, 500)
  })
}
