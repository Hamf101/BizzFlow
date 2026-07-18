"use server"

import { redirect } from "next/navigation"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import {
  createOrganization,
  OrganizationServiceError,
} from "@/services/organization-service"

/**
 * Handles organization creation from the dashboard setup form.
 *
 * @param formData - Submitted organization form data.
 * @returns Never returns; redirects to the dashboard with status.
 */
export async function createOrganizationAction(formData: FormData): Promise<void> {
  try {
    const user = await getAuthenticatedUser()
    await createOrganization({
      userId: user.id,
      userEmail: user.email,
      name: getFormString(formData, "name"),
    })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/dashboard" }))
    }

    const reason =
      error instanceof Error ? error.message : "Unknown organization error"
    const logContext = { reason }

    if (error instanceof OrganizationServiceError) {
      console.warn("create_organization_action_failed", logContext)
    } else {
      console.error("create_organization_action_failed", logContext)
    }

    redirect(
      buildRedirect("/dashboard", {
        error: getActionErrorMessage(error, "Unable to create organization."),
      })
    )
  }

  redirect(buildRedirect("/dashboard", { message: "Organization created." }))
}

function getActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof OrganizationServiceError) {
    return error.message
  }

  return fallback
}
