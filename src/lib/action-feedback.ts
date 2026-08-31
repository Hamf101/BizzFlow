import type { ActionFeedbackCode } from "@/lib/action-result"
import type { AnalyticsEventName } from "@/lib/posthog"

type ActionFeedbackDefinition = Readonly<{
  analyticsEvent: AnalyticsEventName
  description?: string
  durationMs: number
  persistent: boolean
  title: string
  tone: "success" | "error" | "info"
}>

export type ResolvedActionFeedback = ActionFeedbackDefinition &
  Readonly<{ code: ActionFeedbackCode }>

/** Fixed, user-safe presentation and analytics metadata for every outcome code. */
export const ACTION_FEEDBACK = {
  changes_saved: {
    analyticsEvent: "action_outcome",
    durationMs: 5_000,
    persistent: false,
    title: "Changes saved",
    tone: "success",
  },
  document_uploaded: {
    analyticsEvent: "document_uploaded",
    durationMs: 5_000,
    persistent: false,
    title: "Document uploaded",
    tone: "success",
  },
  operation_failed: {
    analyticsEvent: "action_outcome",
    description: "Try again. If the problem continues, contact your administrator.",
    durationMs: 8_000,
    persistent: true,
    title: "Action could not be completed",
    tone: "error",
  },
  retry_later: {
    analyticsEvent: "action_outcome",
    description: "Wait a moment, then try again.",
    durationMs: 8_000,
    persistent: true,
    title: "Try again in a moment",
    tone: "error",
  },
  submission_created: {
    analyticsEvent: "submission_created",
    durationMs: 5_000,
    persistent: false,
    title: "Submission created",
    tone: "success",
  },
  submission_submitted: {
    analyticsEvent: "submission_submitted",
    durationMs: 5_000,
    persistent: false,
    title: "Submission sent for review",
    tone: "success",
  },
  task_completed: {
    analyticsEvent: "task_completed",
    durationMs: 5_000,
    persistent: false,
    title: "Task completed",
    tone: "success",
  },
  task_created: {
    analyticsEvent: "task_created",
    durationMs: 5_000,
    persistent: false,
    title: "Task created",
    tone: "success",
  },
  template_created: {
    analyticsEvent: "template_created",
    durationMs: 5_000,
    persistent: false,
    title: "Template created",
    tone: "success",
  },
  template_duplicated: {
    analyticsEvent: "template_duplicated",
    durationMs: 5_000,
    persistent: false,
    title: "Template duplicated",
    tone: "success",
  },
  template_published: {
    analyticsEvent: "template_published",
    durationMs: 5_000,
    persistent: false,
    title: "Template published",
    tone: "success",
  },
} as const satisfies Record<ActionFeedbackCode, ActionFeedbackDefinition>

/**
 * Resolves untrusted runtime input to fixed feedback without echoing the input.
 *
 * @param value - A value read from editable URL state.
 * @returns The fixed registry entry and stable code, or null when unknown.
 */
export function getActionFeedback(
  value: unknown
): ResolvedActionFeedback | null {
  if (
    typeof value !== "string" ||
    !Object.prototype.hasOwnProperty.call(ACTION_FEEDBACK, value)
  ) {
    return null
  }

  const code = value as ActionFeedbackCode
  return { code, ...ACTION_FEEDBACK[code] }
}
