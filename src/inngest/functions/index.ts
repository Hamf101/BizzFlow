import type { InngestFunction } from "inngest"

import { finalizeCompletedDocumentsFunction } from "@/inngest/functions/finalize-completed-documents"
import { processDueRemindersFunction } from "@/inngest/functions/process-due-reminders"
import { taskAssignedFunction } from "@/inngest/functions/task-assigned"

/**
 * Every background function served at the Inngest endpoint.
 *
 * The serve handler registers exactly this list, so a function is only live
 * once it appears here.
 */
export const inngestFunctions: InngestFunction.Any[] = [
  finalizeCompletedDocumentsFunction,
  processDueRemindersFunction,
  taskAssignedFunction,
]
