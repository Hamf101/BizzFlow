"use server"

import { redirect } from "next/navigation"

import {
  buildFeedbackRedirect,
  getActionErrorFeedbackCode,
  type ActionFeedbackCode,
} from "@/lib/action-result"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import {
  getCurrentOrganizationContext,
  OrganizationServiceError,
} from "@/services/organization-service"
import {
  deleteSavedView,
  renameSavedView,
  saveListView,
} from "@/services/saved-view-service"
import { savedViewListSchema } from "@/types/saved-view"

type Actor = { actorUserId: string; organizationId: string }

function readQuery(formData: FormData): string {
  return new URLSearchParams(getFormString(formData, "query")).toString()
}

// The way back is rebuilt from the list and its settings, never read from the
// form as a path.
function readDestination(formData: FormData): string {
  const list = savedViewListSchema.safeParse(getFormString(formData, "list"))

  if (!list.success) {
    return "/dashboard"
  }

  const query = readQuery(formData)
  return query ? `/${list.data}?${query}` : `/${list.data}`
}

/**
 * Makes one saved-view change in the member's current workspace, then returns
 * to the list's settings with the outcome.
 */
async function runSavedViewAction(
  formData: FormData,
  success: ActionFeedbackCode,
  change: (actor: Actor) => Promise<unknown>,
  conflict?: ActionFeedbackCode
): Promise<never> {
  const destination = readDestination(formData)

  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      throw new OrganizationServiceError("Choose a workspace first.", 428)
    }

    await change({ actorUserId: user.id, organizationId: context.organization.id })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: destination }))
    }

    const code =
      conflict && error instanceof OrganizationServiceError && error.statusCode === 409
        ? conflict
        : getActionErrorFeedbackCode(error)
    redirect(buildFeedbackRedirect(destination, code))
  }

  redirect(buildFeedbackRedirect(destination, success))
}

/**
 * Saves a list's current settings as one of the member's views.
 *
 * @param formData - The list, its canonical settings, and the view's name.
 * @returns Never returns; redirects back to the list with the outcome.
 */
export async function saveListViewAction(formData: FormData): Promise<void> {
  await runSavedViewAction(
    formData,
    "view_saved",
    (actor: Actor) =>
      saveListView({
        ...actor,
        list: getFormString(formData, "list"),
        name: getFormString(formData, "name"),
        query: readQuery(formData),
      }),
    "view_not_saved"
  )
}

/**
 * Renames one of the member's saved views.
 *
 * @param formData - The list, its settings, the view, and its new name.
 * @returns Never returns; redirects back to the list with the outcome.
 */
export async function renameSavedViewAction(formData: FormData): Promise<void> {
  await runSavedViewAction(
    formData,
    "view_renamed",
    (actor: Actor) =>
      renameSavedView({
        ...actor,
        name: getFormString(formData, "name"),
        viewId: getFormString(formData, "viewId"),
      }),
    "view_not_renamed"
  )
}

/**
 * Deletes one of the member's saved views.
 *
 * @param formData - The list, its settings, and the view.
 * @returns Never returns; redirects back to the list with the outcome.
 */
export async function deleteSavedViewAction(formData: FormData): Promise<void> {
  await runSavedViewAction(formData, "view_deleted", (actor: Actor) =>
    deleteSavedView({ ...actor, viewId: getFormString(formData, "viewId") })
  )
}
