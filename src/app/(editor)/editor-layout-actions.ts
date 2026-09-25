"use server"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { saveEditorLayout } from "@/services/editor-layout-service"
import { OrganizationServiceError } from "@/services/organizations/errors"

/**
 * Keeps where the signed-in person put the editor's tools, for every device
 * they use.
 *
 * @param layout - The dock's and zoom's spots, validated by the service.
 * @returns An error to show, when the layout could not be kept.
 */
export async function saveEditorLayoutAction(layout: unknown): Promise<{ error?: string }> {
  try {
    const user = await getAuthenticatedUser()
    await saveEditorLayout({ actorUserId: user.id, layout })
    return {}
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof OrganizationServiceError) {
      return { error: error.message }
    }
    console.error("editor_layout_action_failed", { reason: error instanceof Error ? error.message : "Unknown error" })
    return { error: "Unable to keep where the tools are." }
  }
}
