import { cache } from "react"

import { createClient } from "@/lib/supabase/server"

export type AuthenticatedUser = {
  id: string
  email: string | null
}

/**
 * Error raised when the current request has no authenticated user.
 */
export class AuthenticationError extends Error {
  /**
   * Creates an authentication error.
   *
   * @param message - User-safe authentication failure message.
   */
  constructor(message: string) {
    super(message)
    this.name = "AuthenticationError"
  }
}

/**
 * Loads the authenticated Supabase user from the current request cookies.
 *
 * Wrapped in React `cache()` so the layout and every page in a single request
 * share one claims verification instead of repeating the round-trip.
 *
 * @returns Authenticated user id and email.
 * @throws AuthenticationError when the request has no valid user claims.
 * @throws Error when Supabase environment configuration is missing.
 */
export const getAuthenticatedUser = cache(
  async (): Promise<AuthenticatedUser> => {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getClaims()

    if (error || !data?.claims) {
      console.warn("auth_claims_missing", {
        reason: error?.message ?? "No claims returned",
      })
      throw new AuthenticationError("Sign in to continue.")
    }

    const claims = data.claims as Record<string, unknown>
    const userId = typeof claims.sub === "string" ? claims.sub : null
    const email = typeof claims.email === "string" ? claims.email : null

    if (!userId) {
      console.warn("auth_claims_missing_subject", {
        hasEmail: Boolean(email),
      })
      throw new AuthenticationError("Sign in to continue.")
    }

    return { id: userId, email }
  }
)
