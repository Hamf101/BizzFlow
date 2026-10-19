import type { ActionFeedbackCode } from "@/lib/action-result"
import { TEMPLATE_ANSWERED_MESSAGE } from "@/types/template-trash"
import type { AnalyticsEventName } from "@/lib/posthog"

type ActionFeedbackDefinition = Readonly<{
  analyticsEvent: AnalyticsEventName
  description?: string
  durationMs: number
  persistent: boolean
  /** Counted, but no toast: the page it lands on already says it. */
  quiet?: boolean
  title: string
  tone: "success" | "error" | "info"
}>

export type ResolvedActionFeedback = ActionFeedbackDefinition &
  Readonly<{ code: ActionFeedbackCode }>

const done = (
  title: string,
  analyticsEvent: AnalyticsEventName = "action_outcome"
): ActionFeedbackDefinition => ({
  analyticsEvent,
  durationMs: 5_000,
  persistent: false,
  title,
  tone: "success",
})

const problem = (
  title: string,
  description: string,
  tone: "error" | "info" = "error"
): ActionFeedbackDefinition => ({
  analyticsEvent: "action_outcome",
  description,
  durationMs: 8_000,
  persistent: true,
  title,
  tone,
})

/** Fixed, user-safe presentation and analytics metadata for every outcome code. */
export const ACTION_FEEDBACK = {
  changes_saved: done("Changes saved"),
  changes_suggested: done("Changes suggested"),
  comment_added: done("Comment added"),
  deletion_queued: {
    ...problem("Permanent deletion queued", "The item will be removed after the retention check completes.", "info"),
    persistent: false,
  },
  // The new document or template opening is the notice; a toast would cover its format bar.
  document_created: { ...done("Document created"), quiet: true },
  document_uploaded: done("Document uploaded", "document_uploaded"),
  folder_created: done("Folder created"),
  invalid_input: problem("Some information needs attention", "Check the information and try again."),
  invite_accepted: done("You joined the workspace"),
  invite_already_member: problem("That person is already a member or invited", "Find them in People. No invite was sent."),
  invite_email_failed: problem("Couldn't send the invite email", "Nothing was sent, so no invite is waiting. Invite them again to resend it."),
  invite_email_sent: done("Invite email sent"),
  invite_deleted: done("Invite deleted"),
  member_access_updated: done("Member updated"),
  member_role_updated: done("Member role updated"),
  operation_failed: problem("Action could not be completed", "Try again. If the problem continues, contact your administrator."),
  organization_created: done("Workspace created"),
  password_updated: done("Password updated"),
  organization_required: problem("Create an organization first", "Set up your workspace from the dashboard to continue.", "info"),
  permission_denied: problem("You do not have permission for that action", "Ask an organization owner if you need access."),
  public_link_created: done("Public form link created"),
  public_link_disabled: done("Public form link disabled"),
  refresh_required: problem("This item changed", "Refresh the page to load the latest version, then try again."),
  resource_archived: done("Archived"),
  resource_restored: done("Restored"),
  resource_trashed: done("Moved to Trash"),
  retry_later: problem("Try again in a moment", "Wait a moment, then try again."),
  role_created: done("Role created"),
  role_in_use: problem("This role is still in use", "Reassign its members and active invitations, then try again.", "info"),
  role_removed: done("Role removed"),
  role_updated: done("Role updated"),
  sample_content_added: done("Sample submissions ready"),
  signing_cancelled: done("Signing cancelled"),
  signing_invitation_resent: done("Signing invitation resent"),
  signing_invitations_sent: done("Signing invitations sent"),
  signing_invitations_partly_sent: problem(
    "Sent for signing",
    "We couldn't email everyone. Use Resend in the signers list for anyone who didn't get it.",
    "info"
  ),
  starter_content_added: done("Starter templates ready"),
  template_deleted: done("Template deleted"),
  template_has_answers: problem("This template can't be deleted", TEMPLATE_ANSWERED_MESSAGE, "info"),
  submission_assigned: done("Submission assigned"),
  submission_created: done("Submission created", "submission_created"),
  submission_review_updated: done("Submission review updated"),
  submission_reviewed_next: { ...done("Review saved"), description: "Here's the next one waiting." },
  submission_shared: done("Sharing updated"),
  submission_submitted: done("Submission sent for review", "submission_submitted"),
  task_completed: done("Task completed", "task_completed"),
  task_created: done("Task created", "task_created"),
  task_status_updated: done("Task status updated"),
  template_created: { ...done("Template created", "template_created"), quiet: true },
  template_duplicated: done("Template duplicated", "template_duplicated"),
  template_published: done("Template published", "template_published"),
  template_updated: done("Template updated", "template_published"),
  view_deleted: done("View deleted"),
  view_not_renamed: problem("View not renamed", "Choose a name you haven't used on this list."),
  view_not_saved: problem("View not saved", "Choose a name you haven't used on this list, or delete a view first; a list keeps up to 20."),
  view_renamed: done("View renamed"),
  view_saved: done("View saved"),
} satisfies Record<ActionFeedbackCode, ActionFeedbackDefinition>

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
