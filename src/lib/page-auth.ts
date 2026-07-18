import { redirect } from "next/navigation"

import {
  AuthenticationError,
  getAuthenticatedUser,
  type AuthenticatedUser,
} from "@/lib/auth"
import { buildRedirect } from "@/lib/form-utils"

/**
 * Loads the current user for a protected server page or redirects to sign-in.
 *
 * @param nextPath - Relative page path restored after successful sign-in.
 * @returns The authenticated application user.
 * @throws Unknown authentication failures that are not expected signed-out states.
 */
export async function loadAuthenticatedPageUser(
  nextPath: string
): Promise<AuthenticatedUser> {
  try {
    return await getAuthenticatedUser()
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: nextPath }))
    }

    throw error
  }
}
