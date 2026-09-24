"use server"

import { revalidatePath } from "next/cache"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { getNavigationPreferences, renameNavigationTab, saveNavigationOrder } from "@/services/navigation-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import { OrganizationServiceError } from "@/services/organizations/errors"
import { navigationOrderSchema, renameNavigationSchema, type NavigationPreferences } from "@/types/navigation"

type NavigationActionResult = { preferences: NavigationPreferences; error?: never } | { error: string; preferences?: never }

/** Validates a navigation mutation and saves it as the authenticated member of the selected workspace. */
export async function updateNavigationAction(input: { organizationId: string; change: unknown }): Promise<NavigationActionResult> {
  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)
    if (!context || context.organization.id !== input.organizationId) {
      return { error: "Your workspace changed. Refresh and try again." }
    }
    const actor = { actorUserId: user.id, organizationId: context.organization.id }
    const rename = renameNavigationSchema.safeParse(input.change)
    const order = navigationOrderSchema.safeParse(input.change)
    if (rename.success) await renameNavigationTab({ ...actor, ...rename.data })
    else if (order.success) await saveNavigationOrder({ ...actor, order: order.data })
    else return { error: "Choose a valid tab name or order." }
    const preferences = await getNavigationPreferences(actor)
    revalidatePath("/", "layout")
    return { preferences }
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof OrganizationServiceError) return { error: error.message }
    console.error("navigation_action_failed", { reason: error instanceof Error ? error.message : "Unknown error" })
    return { error: "Unable to save navigation changes. Please try again." }
  }
}
