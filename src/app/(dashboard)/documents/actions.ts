"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import {
  archiveDocument,
  archiveFolder,
  createFolder,
  DocumentServiceError,
  requestDocumentPurge,
  requestFolderPurge,
  restoreDocument,
  restoreFolder,
  trashDocument,
  trashFolder,
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
  return runDocumentLifecycleAction(formData, {
    operation: archiveDocument,
    failureEvent: "archive_document_action_failed",
    fallbackError: "Unable to archive document.",
    successMessage: "Document archived.",
  })
}

/**
 * Restores an archived or trashed document from the document detail page.
 *
 * @param formData - Submitted restore form data.
 * @returns Never returns; redirects to document detail with status.
 */
export async function restoreDocumentAction(formData: FormData): Promise<void> {
  return runDocumentLifecycleAction(formData, {
    operation: restoreDocument,
    failureEvent: "restore_document_action_failed",
    fallbackError: "Unable to restore document.",
    successMessage: "Document restored.",
  })
}

/**
 * Moves a document to Trash from the document detail page.
 *
 * @param formData - Submitted trash form data.
 * @returns Never returns; redirects to document detail with status.
 */
export async function trashDocumentAction(formData: FormData): Promise<void> {
  return runDocumentLifecycleAction(formData, {
    operation: trashDocument,
    failureEvent: "trash_document_action_failed",
    fallbackError: "Unable to move document to Trash.",
    successMessage: "Document moved to Trash.",
  })
}

/**
 * Archives a folder from the Documents workspace.
 *
 * @param formData - Folder identifiers and safe workspace return values.
 * @returns Never returns; redirects to the Documents workspace with status.
 */
export async function archiveFolderAction(formData: FormData): Promise<void> {
  return runFolderLifecycleAction(formData, {
    operation: archiveFolder,
    failureEvent: "archive_folder_action_failed",
    fallbackError: "Unable to archive folder.",
    successMessage: "Folder archived.",
  })
}

/**
 * Restores an archived or trashed folder from the Documents workspace.
 *
 * @param formData - Folder identifiers and safe workspace return values.
 * @returns Never returns; redirects to the Documents workspace with status.
 */
export async function restoreFolderAction(formData: FormData): Promise<void> {
  return runFolderLifecycleAction(formData, {
    operation: restoreFolder,
    failureEvent: "restore_folder_action_failed",
    fallbackError: "Unable to restore folder.",
    successMessage: "Folder restored.",
  })
}

/**
 * Moves a folder subtree to Trash from the Documents workspace.
 *
 * @param formData - Folder identifiers and safe workspace return values.
 * @returns Never returns; redirects to the Documents workspace with status.
 */
export async function trashFolderAction(formData: FormData): Promise<void> {
  return runFolderLifecycleAction(formData, {
    operation: trashFolder,
    failureEvent: "trash_folder_action_failed",
    fallbackError: "Unable to move folder to Trash.",
    successMessage: "Folder moved to Trash.",
  })
}

/**
 * Queues permanent deletion of a trashed document from its detail page.
 *
 * @param formData - Document identifier and the exact confirmation title.
 * @returns Never returns; redirects to document detail with status.
 */
export async function requestDocumentPurgeAction(
  formData: FormData
): Promise<void> {
  const documentId = getFormString(formData, "documentId")
  const detailPath = `/documents/${encodeURIComponent(documentId)}`

  return runResourcePurgeAction({
    failureEvent: "request_document_purge_action_failed",
    logContext: { documentId },
    requestPurge: (scope: ResourcePurgeActionScope): Promise<unknown> =>
      requestDocumentPurge({
        ...scope,
        documentId,
        confirmationTitle: getFormString(formData, "confirmationTitle"),
      }),
    returnPath: detailPath,
    revalidatePaths: ["/documents", detailPath],
  })
}

/**
 * Queues permanent deletion of a trashed folder subtree from the workspace.
 *
 * @param formData - Folder identifier, exact confirmation name, and safe
 * workspace return values.
 * @returns Never returns; redirects to the Documents workspace with status.
 */
export async function requestFolderPurgeAction(
  formData: FormData
): Promise<void> {
  const folderId = getFormString(formData, "folderId")

  return runResourcePurgeAction({
    failureEvent: "request_folder_purge_action_failed",
    logContext: { folderId },
    requestPurge: (scope: ResourcePurgeActionScope): Promise<unknown> =>
      requestFolderPurge({
        ...scope,
        folderId,
        confirmationName: getFormString(formData, "confirmationName"),
      }),
    returnPath: getDocumentsReturnPath(formData),
    revalidatePaths: ["/documents"],
  })
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

type DocumentLifecycleOperation = (input: {
  actorUserId: string
  organizationId: string
  documentId: string
}) => Promise<unknown>

type FolderLifecycleOperation = (input: {
  actorUserId: string
  organizationId: string
  folderId: string
}) => Promise<unknown>

type LifecycleActionConfig<Operation> = {
  operation: Operation
  failureEvent: string
  fallbackError: string
  successMessage: string
}

async function runDocumentLifecycleAction(
  formData: FormData,
  config: LifecycleActionConfig<DocumentLifecycleOperation>
): Promise<void> {
  let organizationId = "unavailable"
  const documentId = getFormString(formData, "documentId")
  const detailPath = `/documents/${encodeURIComponent(documentId)}`

  try {
    const actionContext = await loadLifecycleActionContext()
    organizationId = actionContext.organizationId
    await config.operation({
      actorUserId: actionContext.actorUserId,
      organizationId,
      documentId,
    })
    revalidatePath("/documents")
    revalidatePath(detailPath)
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: detailPath }))
    }

    logDocumentActionFailure(config.failureEvent, {
      organizationId,
      documentId,
      reason:
        error instanceof Error
          ? error.message
          : "Unknown document lifecycle error",
    })

    redirect(
      buildRedirect(detailPath, {
        error: getActionErrorMessage(error, config.fallbackError),
      })
    )
  }

  redirect(buildRedirect(detailPath, { message: config.successMessage }))
}

async function runFolderLifecycleAction(
  formData: FormData,
  config: LifecycleActionConfig<FolderLifecycleOperation>
): Promise<void> {
  let organizationId = "unavailable"
  const folderId = getFormString(formData, "folderId")
  const returnPath = getDocumentsReturnPath(formData)

  try {
    const actionContext = await loadLifecycleActionContext()
    organizationId = actionContext.organizationId
    await config.operation({
      actorUserId: actionContext.actorUserId,
      organizationId,
      folderId,
    })
    revalidatePath("/documents")
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: returnPath }))
    }

    logDocumentActionFailure(config.failureEvent, {
      organizationId,
      folderId,
      reason:
        error instanceof Error
          ? error.message
          : "Unknown folder lifecycle error",
    })

    redirect(
      buildRedirect(returnPath, {
        error: getActionErrorMessage(error, config.fallbackError),
      })
    )
  }

  redirect(buildRedirect(returnPath, { message: config.successMessage }))
}

type ResourcePurgeActionScope = {
  actorUserId: string
  organizationId: string
}

type ResourcePurgeActionConfig = {
  failureEvent: string
  logContext: Record<string, string>
  requestPurge: (scope: ResourcePurgeActionScope) => Promise<unknown>
  returnPath: string
  revalidatePaths: string[]
}

async function runResourcePurgeAction(
  config: ResourcePurgeActionConfig
): Promise<void> {
  let organizationId = "unavailable"

  try {
    const actionContext = await loadLifecycleActionContext()
    organizationId = actionContext.organizationId
    await config.requestPurge({
      actorUserId: actionContext.actorUserId,
      organizationId,
    })

    for (const revalidatedPath of config.revalidatePaths) {
      revalidatePath(revalidatedPath)
    }
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: config.returnPath }))
    }

    logDocumentActionFailure(config.failureEvent, {
      organizationId,
      ...config.logContext,
      reason:
        error instanceof Error ? error.message : "Unknown purge request error",
    })

    redirect(
      buildRedirect(config.returnPath, {
        error: getActionErrorMessage(
          error,
          "Unable to queue permanent deletion."
        ),
      })
    )
  }

  redirect(
    buildRedirect(config.returnPath, {
      message: "Permanent deletion queued.",
    })
  )
}

async function loadLifecycleActionContext(): Promise<{
  actorUserId: string
  organizationId: string
}> {
  const user = await getAuthenticatedUser()
  const context = await getCurrentOrganizationContext(user.id)

  if (!context) {
    throw new DocumentServiceError(
      "Create an organization before managing documents.",
      403
    )
  }

  return {
    actorUserId: user.id,
    organizationId: context.organization.id,
  }
}

function getDocumentsReturnPath(formData: FormData): string {
  const returnFolderId = getFormString(formData, "returnFolderId")
  const returnView = getFormString(formData, "returnView")
  const safeView =
    returnView === "archived" || returnView === "trash"
      ? returnView
      : "active"

  return buildRedirect("/documents", {
    ...(safeView === "active" ? {} : { view: safeView }),
    ...(returnFolderId ? { folderId: returnFolderId } : {}),
  })
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
