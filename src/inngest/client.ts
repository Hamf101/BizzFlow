import { Inngest, eventType } from "inngest"
import { z } from "zod"

import { getInngestEnv } from "@/lib/env"

/**
 * Event emitted when a task is assigned to an organization member.
 *
 * The payload carries identifiers only. Handlers re-read the task through the
 * service layer, so a replayed or delayed event can never deliver a stale
 * title, due date, or assignee.
 */
export const taskAssignedEvent = eventType("task/assigned", {
  schema: z.object({
    organizationId: z.string().uuid(),
    taskId: z.string().uuid(),
    assignedToUserId: z.string().uuid(),
    assignedByUserId: z.string().uuid(),
  }),
})

/**
 * Shared Inngest client for BizFlow background workflows.
 *
 * The event and signing keys are read from the environment by the SDK itself.
 * When they are unset the client targets the local Dev Server, which is how
 * development and tests run without credentials.
 */
export const inngest = new Inngest({
  id: getInngestEnv().INNGEST_APP_ID,
})
