"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import {
  archiveDocument,
  createFolder,
  DocumentServiceError,
} from "@/services/document-service"

/**
 * Handles folder creation from the Documents page.
 *
 * @param formData - Submitted folder form data.
 * @returns Never returns; redirects to Documents with status.
 */
export async function createFolderAction(formData: FormData): Promise<void> {
  const organizationId = getFormString(formData, "organizationId")

  try {
    const user = await getAuthenticatedUser()
    await createFolder({
      actorUserId: user.id,
      organizationId,
      name: getFormString(formData, "name"),
      parentFolderId: getFormString(formData, "parentFolderId") || null,
    })
    revalidatePath("/documents")
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/documents" }))
    }

    logDocumentActionFailure("create_folder_action_failed", {
      organizationId,
      reason: error instanceof Error ? error.message : "Unknown folder error",
    })

    redirect(
      buildRedirect("/documents", {
        error: getActionErrorMessage(error, "Unable to create folder."),
      })
    )
  }

  redirect(buildRedirect("/documents", { message: "Folder created." }))
}

/**
 * Handles document archival from the document detail page.
 *
 * @param formData - Submitted archive form data.
 * @returns Never returns; redirects to document detail with status.
 */
export async function archiveDocumentAction(formData: FormData): Promise<void> {
  const organizationId = getFormString(formData, "organizationId")
  const documentId = getFormString(formData, "documentId")
  const detailPath = `/documents/${documentId}`

  try {
    const user = await getAuthenticatedUser()
    await archiveDocument({
      actorUserId: user.id,
      organizationId,
      documentId,
    })
    revalidatePath("/documents")
    revalidatePath(detailPath)
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: detailPath }))
    }

    logDocumentActionFailure("archive_document_action_failed", {
      organizationId,
      documentId,
      reason: error instanceof Error ? error.message : "Unknown archive error",
    })

    redirect(
      buildRedirect(detailPath, {
        error: getActionErrorMessage(error, "Unable to archive document."),
      })
    )
  }

  redirect(buildRedirect(detailPath, { message: "Document archived." }))
}

function logDocumentActionFailure(
  eventName: string,
  context: Record<string, string>
): void {
  if (context.reason) {
    console.warn(eventName, context)
  }
}

function getActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DocumentServiceError) {
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return fallback
}
