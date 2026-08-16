import { cache } from "react"

import { getPageErrorMessage } from "@/lib/page-errors"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import type { OrganizationContext } from "@/types/organization"

// Keyed by the primitive userId (an input object would defeat cache()'s
// identity-based memoization), so a layout and its page share one lookup
// per request instead of repeating the round trip.
const getCachedOrganizationContext = cache(
  async (userId: string): Promise<OrganizationContext | null> =>
    getCurrentOrganizationContext(userId)
)

type PageOrganizationContextLogDetails = Readonly<
  Record<string, string | number | boolean | null | undefined>
>

export type LoadPageOrganizationContextInput = {
  userId: string
  failureEvent: string
  failureDetails?: PageOrganizationContextLogDetails
}

export type PageOrganizationContextResult = {
  context: OrganizationContext | null
  errorMessage: string | null
}

/**
 * Loads a server page's current organization and normalizes load failures.
 *
 * @param input - User id plus the page-specific log event and safe identifiers.
 * @returns Organization context, or a null context with an optional safe error.
 */
export async function loadPageOrganizationContext(
  input: LoadPageOrganizationContextInput
): Promise<PageOrganizationContextResult> {
  try {
    return {
      context: await getCachedOrganizationContext(input.userId),
      errorMessage: null,
    }
  } catch (error: unknown) {
    const errorMessage = getPageErrorMessage(
      error,
      "Unable to load organization context."
    )

    console.warn(input.failureEvent, {
      ...input.failureDetails,
      userId: input.userId,
      reason: errorMessage,
    })

    return {
      context: null,
      errorMessage,
    }
  }
}
