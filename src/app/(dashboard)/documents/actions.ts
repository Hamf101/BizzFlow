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
import {
  createDocumentComment,
  DocumentCommentServiceError,
} from "@/services/document-comment-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  createGeneratedDocument,
  TemplateServiceError,
} from "@/services/template-service"
import { createBlankTemplateContent } from "@/types/template"

/**
 * Handles folder creation from the Documents page.
 *
 * @param formData - Submitted folder form data.
 * @returns Never returns; redirects to Documents with status.
 */
export async function createFolderAction(formData: FormData): Promise<void> {
  const organizationId = getFormString(formData, "organizationId")
  const returnFolderId = getFormString(formData, "returnFolderId")
  const returnPath = returnFolderId
    ? `/documents?folderId=${encodeURIComponent(returnFolderId)}`
    : "/documents"

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
      redirect(buildRedirect("/login", { next: returnPath }))
    }

    logDocumentActionFailure("create_folder_action_failed", {
      organizationId,
      reason: error instanceof Error ? error.message : "Unknown folder error",
    })

    redirect(
      buildRedirect(returnPath, {
        error: getActionErrorMessage(error, "Unable to create folder."),
      })
    )
  }

  redirect(buildRedirect(returnPath, { message: "Folder created." }))
}

/**
 * Creates an editable generated document from a published template or blank page.
 *
 * @param formData - Organization, folder, source template, and document metadata.
 * @returns Never returns; redirects to the generated document editor.
 */
export async function createGeneratedDocumentAction(
  formData: FormData
): Promise<void> {
  let organizationId = "unavailable"
  const folderId = getFormString(formData, "folderId")
  const templateId = getFormString(formData, "templateId")
  const returnPath = buildRedirect("/documents/new", {
    mode: "create",
    ...(folderId ? { folderId } : {}),
  })
  let createdDocumentId: string

  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      throw new TemplateServiceError(
        "Create an organization before adding documents.",
        403
      )
    }

    organizationId = context.organization.id
    const blankContent = templateId ? undefined : createBlankTemplateContent()

    if (blankContent) {
      blankContent.branding.organizationName = context.organization.name
    }

    const document = await createGeneratedDocument({
      actorUserId: user.id,
      organizationId,
      folderId: folderId || null,
      templateId: templateId || null,
      title: getFormString(formData, "title"),
      description: getFormString(formData, "description") || null,
      content: blankContent,
    })
    createdDocumentId = document.id
    revalidatePath("/documents")
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: returnPath }))
    }

    logDocumentActionFailure("create_generated_document_action_failed", {
      organizationId,
      reason:
        error instanceof Error ? error.message : "Unknown generated document error",
    })
    redirect(
      buildRedirect(returnPath, {
        error: getActionErrorMessage(
          error,
          "Unable to create editable document."
        ),
      })
    )
  }

  redirect(`/documents/${encodeURIComponent(createdDocumentId)}/edit`)
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

/**
 * Adds an immutable comment to a document.
 *
 * @param formData - Organization, document, and comment body fields.
 * @returns Never returns; redirects to document detail with status.
 */
export async function createDocumentCommentAction(
  formData: FormData
): Promise<void> {
  const organizationId = getFormString(formData, "organizationId")
  const documentId = getFormString(formData, "documentId")
  const detailPath = `/documents/${documentId}`

  try {
    const user = await getAuthenticatedUser()
    await createDocumentComment({
      actorUserId: user.id,
      organizationId,
      documentId,
      body: getFormString(formData, "body"),
    })
    revalidatePath(detailPath)
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: detailPath }))
    }

    logDocumentActionFailure("create_document_comment_action_failed", {
      organizationId,
      documentId,
      reason: error instanceof Error ? error.message : "Unknown comment error",
    })

    redirect(
      buildRedirect(detailPath, {
        error: getActionErrorMessage(error, "Unable to add comment."),
      })
    )
  }

  redirect(buildRedirect(detailPath, { message: "Comment added." }))
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

  if (error instanceof DocumentCommentServiceError) {
    return error.message
  }

  if (error instanceof TemplateServiceError) {
    return error.message
  }

  return fallback
}
