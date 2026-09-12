/** Stable feedback codes that may cross the server-action redirect boundary. */
export const ACTION_FEEDBACK_CODES = [
  "changes_saved",
  "comment_added",
  "deletion_queued",
  "document_created",
  "document_uploaded",
  "folder_created",
  "invalid_input",
  "invite_created_email_failed",
  "invite_email_sent",
  "invite_deleted",
  "member_access_updated",
  "member_role_updated",
  "operation_failed",
  "organization_created",
  "organization_required",
  "permission_denied",
  "public_link_created",
  "public_link_disabled",
  "refresh_required",
  "resource_archived",
  "resource_restored",
  "resource_trashed",
  "retry_later",
  "role_created",
  "role_in_use",
  "role_removed",
  "role_updated",
  "sample_content_added",
  "signing_invitation_resent",
  "signing_invitations_sent",
  "starter_content_added",
  "submission_assigned",
  "submission_created",
  "submission_review_updated",
  "submission_submitted",
  "task_completed",
  "task_created",
  "task_status_updated",
  "template_created",
  "template_duplicated",
  "template_published",
] as const

export type ActionFeedbackCode = (typeof ACTION_FEEDBACK_CODES)[number]

/** Field-specific validation copy that remains beside the owning form control. */
export type ActionFieldErrors = Readonly<Record<string, readonly string[]>>

/**
 * A completed server-action result without raw exception or provider text.
 *
 * The stable code is resolved to user-facing copy by the client feedback registry.
 */
export type ActionOutcome = Readonly<{
  status: "success" | "error"
  code: ActionFeedbackCode
  fieldErrors?: ActionFieldErrors
  destination?: string
}>

type FeedbackRedirectParams = Readonly<
  Record<string, string | null | undefined>
> &
  Readonly<{
    error?: never
    feedback?: never
    message?: never
  }>

const RAW_FLASH_PARAMETERS = new Set(["error", "feedback", "message"])

/**
 * Builds a same-application redirect containing one stable feedback code.
 *
 * @param pathname - Application path, including any validated query or hash state.
 * @param code - Closed feedback code resolved to fixed copy in the browser.
 * @param existingParams - Additional caller-validated route state to preserve.
 * @returns A relative application URL with raw flash-copy parameters removed.
 */
export function buildFeedbackRedirect(
  pathname: string,
  code: ActionFeedbackCode,
  existingParams: FeedbackRedirectParams = {}
): string {
  const redirectUrl = new URL(pathname, "https://bizflow.invalid")

  for (const key of RAW_FLASH_PARAMETERS) {
    redirectUrl.searchParams.delete(key)
  }

  for (const [key, value] of Object.entries(existingParams)) {
    if (RAW_FLASH_PARAMETERS.has(key)) continue

    if (value === null || value === undefined) {
      redirectUrl.searchParams.delete(key)
    } else {
      redirectUrl.searchParams.set(key, value)
    }
  }

  redirectUrl.searchParams.set("feedback", code)
  return `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`
}

/**
 * Maps an unknown action exception to a fixed presentation code.
 *
 * @param error - Service or action exception that may expose an HTTP-style status.
 * @param fallback - Closed code used when the exception has no recognized status.
 * @returns A stable code that never includes exception copy.
 */
export function getActionErrorFeedbackCode(
  error: unknown,
  fallback: ActionFeedbackCode = "operation_failed"
): ActionFeedbackCode {
  const statusCode = getErrorStatusCode(error)

  if (statusCode === 400 || statusCode === 422) return "invalid_input"
  if (statusCode === 401 || statusCode === 403) return "permission_denied"
  if (statusCode === 409) return "refresh_required"
  if (statusCode === 428) return "organization_required"
  if (statusCode === 429) return "retry_later"

  return fallback
}

function getErrorStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return null
  }

  return typeof error.statusCode === "number" ? error.statusCode : null
}
