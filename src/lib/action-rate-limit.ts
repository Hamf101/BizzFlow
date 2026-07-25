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
