"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import {
  createOrganization,
  getCurrentOrganizationContext,
  OrganizationServiceError,
} from "@/services/organization-service"
import { TemplateServiceError } from "@/services/templates/errors"
import {
  seedSampleSubmissionsForOrganization,
  seedStarterTemplatesForOrganization,
} from "@/services/templates/starter-templates"

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

export async function seedStarterTemplatesAction(): Promise<void> {
  let successMessage: string

  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      throw new SeedActionError("Create an organization before adding starter templates.")
    }

    const { seededCount, skippedCount } = await seedStarterTemplatesForOrganization({
      actorUserId: user.id,
      organizationId: context.organization.id,
    })

    revalidatePath("/dashboard")
    revalidatePath("/templates")

    successMessage =
      seededCount > 0
        ? `Added ${seededCount} starter template${seededCount === 1 ? "" : "s"}.`
        : `All ${skippedCount} starter templates are already in your library.`
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/dashboard" }))
    }

    const reason = error instanceof Error ? error.message : "Unknown seeding error"
    console.warn("seed_starter_templates_action_failed", { reason })

    redirect(
      buildRedirect("/dashboard", {
        error:
          error instanceof SeedActionError || error instanceof TemplateServiceError
            ? error.message
            : "Unable to add starter templates.",
      })
    )
  }

  // Outside the try: redirect() signals by throwing NEXT_REDIRECT, and a catch
  // around it would turn every success into "Unable to add starter templates."
  redirect(buildRedirect("/dashboard", { message: successMessage }))
}

/**
 * Seeds worked example submissions against the seeded starter templates.
 *
 * @returns Never returns; redirects to the dashboard with status.
 */
export async function seedSampleSubmissionsAction(): Promise<void> {
  let successMessage: string

  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      throw new SeedActionError(
        "Create an organization before adding sample submissions."
      )
    }

    const { seededCount, skippedCount } =
      await seedSampleSubmissionsForOrganization({
        actorUserId: user.id,
        organizationId: context.organization.id,
      })

    revalidatePath("/dashboard")
    revalidatePath("/submissions")

    successMessage =
      seededCount > 0
        ? `Added ${seededCount} sample submission${seededCount === 1 ? "" : "s"}.`
        : `All ${skippedCount} sample submissions already exist, or their starter templates have not been added yet.`
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/dashboard" }))
    }

    const reason = error instanceof Error ? error.message : "Unknown seeding error"
    console.warn("seed_sample_submissions_action_failed", { reason })

    redirect(
      buildRedirect("/dashboard", {
        error:
          error instanceof SeedActionError || error instanceof TemplateServiceError
            ? error.message
            : "Unable to add sample submissions.",
      })
    )
  }

  // Outside the try, for the same reason as seedStarterTemplatesAction.
  redirect(buildRedirect("/dashboard", { message: successMessage }))
}

/** Rejection raised by the dashboard seeding action before it reaches a service. */
class SeedActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SeedActionError"
  }
}

function getActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof OrganizationServiceError) {
    return error.message
  }

  return fallback
}
