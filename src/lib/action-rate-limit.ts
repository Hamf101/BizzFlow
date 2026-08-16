import { redirect } from "next/navigation"

import { buildRedirect } from "@/lib/form-utils"
import {
  checkRateLimit,
  RateLimitError,
  type RateLimitBucket,
} from "@/lib/rate-limit"

/**
 * Enforces a rate-limit bucket inside a server action.
 *
 * Server actions surface rejections as redirects with an `error` query param
 * (never thrown errors), so a denied check redirects with the given message.
 * Call this OUTSIDE any try/catch: the redirect works by throwing.
 *
 * @param input - Bucket, caller key, redirect target, and user-safe message.
 */
export async function enforceActionRateLimit(input: {
  bucket: RateLimitBucket
  key: string
  redirectPath: string
  message: string
}): Promise<void> {
  try {
    await checkRateLimit(input.bucket, input.key)
  } catch (error: unknown) {
    if (!(error instanceof RateLimitError)) {
      throw error
    }

    redirect(buildRedirect(input.redirectPath, { error: input.message }))
  }
}

/** Shared rejection copy for every mail-sending server action. */
const OUTBOUND_EMAIL_THROTTLE_MESSAGE =
  "Too many emails sent from this account. Wait a little while and try again."

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
    key: input.userId,
    redirectPath: input.redirectPath,
    message: OUTBOUND_EMAIL_THROTTLE_MESSAGE,
  })
  await enforceActionRateLimit({
    bucket: "outbound_email_daily",
    key: input.userId,
    redirectPath: input.redirectPath,
    message: OUTBOUND_EMAIL_THROTTLE_MESSAGE,
  })
}
