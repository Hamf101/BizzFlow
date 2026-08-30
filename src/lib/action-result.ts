/** Stable feedback codes that may cross the server-action redirect boundary. */
export type ActionFeedbackCode =
  | "changes_saved"
  | "document_uploaded"
  | "operation_failed"
  | "retry_later"
  | "submission_created"
  | "submission_submitted"
  | "task_completed"
  | "task_created"
  | "template_created"
  | "template_duplicated"
  | "template_published"

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
