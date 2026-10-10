"use server"

import type { ActionFeedbackCode } from "@/lib/action-result"
import { loadActionContext, runFormAction, type ActionActor } from "@/lib/form-action"
import { getFormString } from "@/lib/form-utils"
import { OrganizationServiceError } from "@/services/organization-service"
import {
  deleteSavedView,
  renameSavedView,
  saveListView,
} from "@/services/organizations/saved-view-service"
import { savedViewListSchema } from "@/types/saved-view"

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
  change: (actor: ActionActor) => Promise<unknown>,
  conflict?: ActionFeedbackCode
): Promise<never> {
  return runFormAction({
    event: `saved_${success}_action`,
    path: readDestination(formData),
    success,
    failure: (error) =>
      conflict && error instanceof OrganizationServiceError && error.statusCode === 409
        ? conflict
        : undefined,
    run: async () => {
      const { actor } = await loadActionContext("Choose a workspace first.")
      await change(actor)
    },
  })
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
    (actor: ActionActor) =>
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
    (actor: ActionActor) =>
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
  await runSavedViewAction(formData, "view_deleted", (actor: ActionActor) =>
    deleteSavedView({ ...actor, viewId: getFormString(formData, "viewId") })
  )
}
