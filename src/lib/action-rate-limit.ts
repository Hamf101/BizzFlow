import { redirect } from "next/navigation"

import {
  buildFeedbackRedirect,
  type ActionFeedbackCode,
} from "@/lib/action-result"
import { buildRedirect } from "@/lib/form-utils"
import {
  checkRateLimit,
  RateLimitError,
  type RateLimitBucket,
} from "@/lib/rate-limit"

/**
 * Enforces a rate-limit bucket inside a server action.
 *
 * Dashboard actions use a stable feedback code; routes without the dashboard
 * bridge may provide their own fixed inline message.
 * Call this OUTSIDE any try/catch: the redirect works by throwing.
 *
 * @param input - Bucket, caller key, redirect target, and closed rejection form.
 */
type ActionRateLimitInput = {
  bucket: RateLimitBucket
  key: string
  redirectPath: string
} & (
  | { feedbackCode: ActionFeedbackCode; message?: never }
  | { feedbackCode?: never; message: string }
)

export async function enforceActionRateLimit(
  input: ActionRateLimitInput
): Promise<void> {
  try {
    await checkRateLimit(input.bucket, input.key)
  } catch (error: unknown) {
    if (!(error instanceof RateLimitError)) {
      throw error
    }

    redirect(
      input.feedbackCode
        ? buildFeedbackRedirect(input.redirectPath, input.feedbackCode)
        : buildRedirect(input.redirectPath, { error: input.message })
    )
  }
}

/**
 * Enforces the hourly burst and daily ceiling budgets for a mail-sending action.
 *
 * Keyed on the authenticated member rather than an organization id, because
 * every one of these actions reads its organization from submitted form data,
 * which stays unverified until the service checks membership.
 *
 * Call this OUTSIDE any try/catch: rejection redirects, which works by throwing.
 *
 * @param input - Authenticated member id and the path to redirect back to.
 */
export async function enforceOutboundEmailRateLimit(input: {
  userId: string
  redirectPath: string
}): Promise<void> {
  await enforceActionRateLimit({
    bucket: "outbound_email",
    feedbackCode: "retry_later",
    key: input.userId,
    redirectPath: input.redirectPath,
  })
  await enforceActionRateLimit({
    bucket: "outbound_email_daily",
    feedbackCode: "retry_later",
    key: input.userId,
    redirectPath: input.redirectPath,
  })
}
