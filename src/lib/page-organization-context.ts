import { getPageErrorMessage } from "@/lib/page-errors"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import type { OrganizationContext } from "@/types/organization"

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
      context: await getCurrentOrganizationContext(input.userId),
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
