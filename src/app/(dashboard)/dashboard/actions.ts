"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import {
  buildFeedbackRedirect,
  getActionErrorFeedbackCode,
} from "@/lib/action-result"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import {
  createOrganization,
  getCurrentOrganizationContext,
  OrganizationServiceError,
  updateProfile,
} from "@/services/organization-service"
import {
  seedSampleSubmissionsForOrganization,
  seedStarterTemplatesForOrganization,
} from "@/services/templates/starter-templates"
import { profileSchema } from "@/types/profile"

/**
 * Creates the new account's workspace, the last step of signing up, and saves
 * the owner's name and phone number with it.
 *
 * @param formData - The owner's name and optional phone, and the workspace name.
 * @returns Never returns; redirects to the dashboard, or back to /welcome with the reason.
 */
export async function createOrganizationAction(formData: FormData): Promise<void> {
  const profile = profileSchema.safeParse({
    displayName: getFormString(formData, "displayName"),
    phoneNumber: getFormString(formData, "phoneNumber"),
  })

  if (!profile.success) {
    redirect(buildRedirect("/welcome", { error: profile.error.issues[0]?.message ?? "Check the form and try again." }))
  }

  let userId: string

  try {
    const user = await getAuthenticatedUser()
    await createOrganization({
      userId: user.id,
      userEmail: user.email,
      name: getFormString(formData, "name"),
    })
    userId = user.id
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/welcome" }))
    }

    const reason =
      error instanceof Error ? error.message : "Unknown organization error"
    const logContext = { reason }

    if (error instanceof OrganizationServiceError) {
      console.warn("create_organization_action_failed", logContext)
    } else {
      console.error("create_organization_action_failed", logContext)
    }

    // Only the name rule is written for people; other detail stays in the logs.
    redirect(
      buildRedirect("/welcome", {
        error:
          error instanceof OrganizationServiceError && error.statusCode === 400
            ? error.message
            : "Unable to create the workspace. Try again.",
      })
    )
  }

  // The workspace made their profile row, so the name follows it. One that
  // fails to save (the service logs why) can go in from Settings instead.
  await updateProfile({ actorUserId: userId, ...profile.data }).catch(() => undefined)

  redirect(buildFeedbackRedirect("/dashboard", "organization_created"))
}

export async function seedStarterTemplatesAction(): Promise<void> {
  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      throw new SeedActionError("Create an organization before adding starter templates.")
    }

    await seedStarterTemplatesForOrganization({
      actorUserId: user.id,
      organizationId: context.organization.id,
    })

    revalidatePath("/dashboard")
    revalidatePath("/templates")
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/dashboard" }))
    }

    const reason = error instanceof Error ? error.message : "Unknown seeding error"
    console.warn("seed_starter_templates_action_failed", { reason })

    redirect(
      buildFeedbackRedirect(
        "/dashboard",
        error instanceof SeedActionError
          ? "organization_required"
          : getActionErrorFeedbackCode(error)
      )
    )
  }

  // Outside the try: redirect() signals by throwing NEXT_REDIRECT, and a catch
  // around it would turn every success into "Unable to add starter templates."
  redirect(buildFeedbackRedirect("/dashboard", "starter_content_added"))
}

/**
 * Seeds worked example submissions against the seeded starter templates.
 *
 * @returns Never returns; redirects to the dashboard with status.
 */
export async function seedSampleSubmissionsAction(): Promise<void> {
  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      throw new SeedActionError(
        "Create an organization before adding sample submissions."
      )
    }

    await seedSampleSubmissionsForOrganization({
      actorUserId: user.id,
      organizationId: context.organization.id,
    })

    revalidatePath("/dashboard")
    revalidatePath("/submissions")
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/dashboard" }))
    }

    const reason = error instanceof Error ? error.message : "Unknown seeding error"
    console.warn("seed_sample_submissions_action_failed", { reason })

    redirect(
      buildFeedbackRedirect(
        "/dashboard",
        error instanceof SeedActionError
          ? "organization_required"
          : getActionErrorFeedbackCode(error)
      )
    )
  }

  // Outside the try, for the same reason as seedStarterTemplatesAction.
  redirect(buildFeedbackRedirect("/dashboard", "sample_content_added"))
}

/** Rejection raised by the dashboard seeding action before it reaches a service. */
class SeedActionError extends Error {
  readonly statusCode = 403

  constructor(message: string) {
    super(message)
    this.name = "SeedActionError"
  }
}
