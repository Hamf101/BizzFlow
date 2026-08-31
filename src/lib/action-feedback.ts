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
  comment_added: {
    analyticsEvent: "action_outcome",
    durationMs: 5_000,
    persistent: false,
    title: "Comment added",
    tone: "success",
  },
  deletion_queued: {
    analyticsEvent: "action_outcome",
    description: "The item will be removed after the retention check completes.",
    durationMs: 8_000,
    persistent: false,
    title: "Permanent deletion queued",
    tone: "info",
  },
  document_created: {
    analyticsEvent: "action_outcome",
    durationMs: 5_000,
    persistent: false,
    title: "Document created",
    tone: "success",
  },
  document_uploaded: {
    analyticsEvent: "document_uploaded",
    durationMs: 5_000,
    persistent: false,
    title: "Document uploaded",
    tone: "success",
  },
  folder_created: {
    analyticsEvent: "action_outcome",
    durationMs: 5_000,
    persistent: false,
    title: "Folder created",
    tone: "success",
  },
  invalid_input: {
    analyticsEvent: "action_outcome",
    description: "Check the information and try again.",
    durationMs: 8_000,
    persistent: true,
    title: "Some information needs attention",
    tone: "error",
  },
  invite_created_email_failed: {
    analyticsEvent: "action_outcome",
    description: "The invite is ready. Copy its link and share it directly.",
    durationMs: 8_000,
    persistent: true,
    title: "Invite created, but email was not sent",
    tone: "info",
  },
  invite_email_sent: {
    analyticsEvent: "action_outcome",
    durationMs: 5_000,
    persistent: false,
    title: "Invite email sent",
    tone: "success",
  },
  member_role_updated: {
    analyticsEvent: "action_outcome",
    durationMs: 5_000,
    persistent: false,
    title: "Member role updated",
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
  organization_created: {
    analyticsEvent: "action_outcome",
    durationMs: 5_000,
    persistent: false,
    title: "Organization created",
    tone: "success",
  },
  organization_required: {
    analyticsEvent: "action_outcome",
    description: "Set up your workspace from the dashboard to continue.",
    durationMs: 8_000,
    persistent: true,
    title: "Create an organization first",
    tone: "info",
  },
  permission_denied: {
    analyticsEvent: "action_outcome",
    description: "Ask an organization owner if you need access.",
    durationMs: 8_000,
    persistent: true,
    title: "You do not have permission for that action",
    tone: "error",
  },
  public_link_created: {
    analyticsEvent: "action_outcome",
    durationMs: 5_000,
    persistent: false,
    title: "Public form link created",
    tone: "success",
  },
  public_link_disabled: {
    analyticsEvent: "action_outcome",
    durationMs: 5_000,
    persistent: false,
    title: "Public form link disabled",
    tone: "success",
  },
  refresh_required: {
    analyticsEvent: "action_outcome",
    description: "Refresh the page to load the latest version, then try again.",
    durationMs: 8_000,
    persistent: true,
    title: "This item changed",
    tone: "error",
  },
  resource_archived: {
    analyticsEvent: "action_outcome",
    durationMs: 5_000,
    persistent: false,
    title: "Archived",
    tone: "success",
  },
  resource_restored: {
    analyticsEvent: "action_outcome",
    durationMs: 5_000,
    persistent: false,
    title: "Restored",
    tone: "success",
  },
  resource_trashed: {
    analyticsEvent: "action_outcome",
    durationMs: 5_000,
    persistent: false,
    title: "Moved to Trash",
    tone: "success",
  },
  retry_later: {
    analyticsEvent: "action_outcome",
    description: "Wait a moment, then try again.",
    durationMs: 8_000,
    persistent: true,
    title: "Try again in a moment",
    tone: "error",
  },
  sample_content_added: {
    analyticsEvent: "action_outcome",
    durationMs: 5_000,
    persistent: false,
    title: "Sample submissions ready",
    tone: "success",
  },
  starter_content_added: {
    analyticsEvent: "action_outcome",
    durationMs: 5_000,
    persistent: false,
    title: "Starter templates ready",
    tone: "success",
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
