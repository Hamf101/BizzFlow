import { cron } from "inngest"

import { inngest } from "@/inngest/client"
import { monitorCron } from "@/lib/observability"
import { runBackgroundStep, type BackgroundStepRunner } from "@/inngest/functions/shared"
import { finalizeCompletedGeneratedDocuments } from "@/services/generated-document-finalization-service"
import { finalizeCompletedUploads } from "@/services/pdf-signing-service"

const FINALIZE_SWEEP_CRON = "17 * * * *"

/**
 * Scheduled backstop that finalizes completed documents the last signature
 * left as previews: one bounded batch an hour, as one durable step, so a
 * finished batch is never rendered again when a later attempt replays.
 * Finalizing is idempotent, so a document finalized meanwhile is skipped.
 */
export const finalizeCompletedDocumentsFunction = inngest.createFunction(
  {
    id: "finalize-completed-documents",
    name: "Finalize completed documents",
    triggers: [cron(FINALIZE_SWEEP_CRON)],
    concurrency: 1,
    retries: 2,
  },
  ({ step }: { step: BackgroundStepRunner }) =>
    runBackgroundStep(step, "finalize-completed-documents", () =>
      monitorCron("finalize-completed-documents", FINALIZE_SWEEP_CRON, async () => ({
        // Generated documents and signed uploads alike: each finished one gets its signed copy.
        generated: await finalizeCompletedGeneratedDocuments(),
        uploads: await finalizeCompletedUploads(),
      }))
    )
)
