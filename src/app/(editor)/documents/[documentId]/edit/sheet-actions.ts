"use server"

import { revalidatePath } from "next/cache"

import type { SaveResult } from "@/components/editor/use-autosave"
import { getAuthenticatedUser } from "@/lib/auth"
import { resolveDocumentOrganizationId } from "@/lib/document-organization"
import { ActionError, loadActionContext, requireFormId, runFormAction } from "@/lib/form-action"
import { buildRedirect } from "@/lib/form-utils"
import { toSaveFailure } from "@/lib/save-failure"
import { createSheet, renameSheet, updateSheetContent } from "@/services/sheet-service"

/** What the sheet editor saves: its new name, its cells, or both, over the version it holds. */
export type SheetSaveInput = {
  content?: unknown
  documentId: string
  expectedUpdatedAt: string
  title?: string
}

/**
 * Starts an empty sheet in a Files folder and opens it.
 *
 * @param folderId - The folder, or null for the top of Files.
 * @returns Never returns; redirects to the new sheet, or back to Files with why not.
 */
export async function createSheetAction(folderId: string | null): Promise<void> {
  const folder = typeof folderId === "string" && folderId ? folderId : null

  await runFormAction({
    event: "create_sheet_action",
    path: buildRedirect("/documents", folder ? { folderId: folder } : {}),
    success: "sheet_created",
    run: async () => {
      const { actor } = await loadActionContext("Create an organization before adding sheets.")
      const sheet = await createSheet({ ...actor, folderId: folder, title: "Untitled sheet" })

      revalidatePath("/documents")
      return { path: `/documents/${encodeURIComponent(sheet.id)}/edit` }
    },
  })
}

/**
 * Saves a sheet from its editor, a member's or a guest Editor's, without
 * leaving the page. A new name and new cells save in one write.
 *
 * @param input - The sheet, the version the editor holds, and what changed.
 * @returns The version to save from next, or why the save was refused.
 */
export async function saveSheetAction(input: SheetSaveInput): Promise<SaveResult> {
  try {
    const documentId = requireFormId(String(input.documentId ?? ""), "Sheet id")
    const user = await getAuthenticatedUser()
    const organizationId = await resolveDocumentOrganizationId(user.id, documentId)

    if (!organizationId) {
      throw new ActionError("Create an organization before editing sheets.", 428)
    }

    const target = { actorUserId: user.id, organizationId, documentId }
    const expectedUpdatedAt = String(input.expectedUpdatedAt ?? "")
    const title = typeof input.title === "string" ? input.title : undefined
    // A new name and new cells go in one write, so a refused save leaves neither behind.
    const { updatedAt: version } =
      input.content !== undefined
        ? await updateSheetContent({ ...target, content: input.content, expectedUpdatedAt, title })
        : title !== undefined
          ? await renameSheet({ ...target, title, expectedUpdatedAt })
          : { updatedAt: expectedUpdatedAt }

    revalidatePath("/documents")
    return { ok: true, version }
  } catch (error: unknown) {
    return toSaveFailure(error, "sheet_save_failed", String(input?.documentId ?? ""))
  }
}
