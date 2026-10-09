"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import {
  FILES_LAYOUT_COOKIE,
  FILES_LAYOUT_COOKIE_MAX_AGE,
  FILES_PATH,
  isFilesReturnPath,
  parseFilesLayout,
} from "@/components/files/file-list-view"
import type { ActionFeedbackCode } from "@/lib/action-result"
import { getAuthenticatedUser } from "@/lib/auth"
import {
  loadActionContext,
  loadActionContextOrSignIn,
  runFormAction,
  type ActionActor,
} from "@/lib/form-action"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import {
  archiveDocument,
  archiveFolder,
  createFolder,
  moveDocument,
  moveFolder,
  requestDocumentPurge,
  requestFolderPurge,
  restoreDocument,
  restoreFolder,
  trashDocument,
  trashFolder,
} from "@/services/document-service"
import {
  createDocumentComment,
} from "@/services/document-comment-service"
import { createGeneratedDocument } from "@/services/template-service"
import { createEmptyDocumentContent } from "@/types/template"

const NO_ORGANIZATION = "Create an organization before managing documents."

/**
 * Handles folder creation from the Documents page.
 *
 * @param formData - Submitted folder form data.
 * @returns Never returns; redirects to Documents with status.
 */
export async function createFolderAction(formData: FormData): Promise<void> {
  const organizationId = getFormString(formData, "organizationId")
  const returnFolderId = getFormString(formData, "returnFolderId")

  await runFormAction({
    event: "create_folder_action",
    log: { organizationId },
    path: returnFolderId
      ? `/documents?folderId=${encodeURIComponent(returnFolderId)}`
      : "/documents",
    success: "folder_created",
    run: async () => {
      const user = await getAuthenticatedUser()
      await createFolder({
        actorUserId: user.id,
        organizationId,
        name: getFormString(formData, "name"),
        parentFolderId: getFormString(formData, "parentFolderId") || null,
      })
      revalidatePath("/documents")
    },
  })
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
  const folderId = getFormString(formData, "folderId")
  const templateId = getFormString(formData, "templateId")

  await runFormAction({
    event: "create_generated_document_action",
    path: buildRedirect("/documents/new", folderId ? { folderId } : {}),
    success: "document_created",
    run: async () => {
      const { actor, organization } = await loadActionContext(
        "Create an organization before adding documents.",
        403
      )
      const blankContent = templateId ? undefined : createEmptyDocumentContent()

      if (blankContent) {
        blankContent.branding.organizationName = organization.name
      }

      const document = await createGeneratedDocument({
        ...actor,
        folderId: folderId || null,
        templateId: templateId || null,
        title: getFormString(formData, "title"),
        description: getFormString(formData, "description") || null,
        content: blankContent,
      })
      revalidatePath("/documents")
      return { path: `/documents/${encodeURIComponent(document.id)}/edit` }
    },
  })
}

/**
 * Handles document archival from the document detail page.
 *
 * @param formData - Submitted archive form data.
 * @returns Never returns; redirects to document detail with status.
 */
export async function archiveDocumentAction(formData: FormData): Promise<void> {
  await runDocumentAction(formData, "archive_document_action", "resource_archived", archiveDocument)
}

/**
 * Restores an archived or trashed document from the document detail page.
 *
 * @param formData - Submitted restore form data.
 * @returns Never returns; redirects to document detail with status.
 */
export async function restoreDocumentAction(formData: FormData): Promise<void> {
  await runDocumentAction(formData, "restore_document_action", "resource_restored", restoreDocument)
}

/**
 * Moves a document to Trash from the document detail page.
 *
 * @param formData - Submitted trash form data.
 * @returns Never returns; redirects to document detail with status.
 */
export async function trashDocumentAction(formData: FormData): Promise<void> {
  await runDocumentAction(formData, "trash_document_action", "resource_trashed", trashDocument)
}

/**
 * Archives a folder from the Documents workspace.
 *
 * @param formData - Folder identifiers and safe workspace return values.
 * @returns Never returns; redirects to the Documents workspace with status.
 */
export async function archiveFolderAction(formData: FormData): Promise<void> {
  await runFolderAction(formData, "archive_folder_action", "resource_archived", archiveFolder)
}

/**
 * Restores an archived or trashed folder from the Documents workspace.
 *
 * @param formData - Folder identifiers and safe workspace return values.
 * @returns Never returns; redirects to the Documents workspace with status.
 */
export async function restoreFolderAction(formData: FormData): Promise<void> {
  await runFolderAction(formData, "restore_folder_action", "resource_restored", restoreFolder)
}

/**
 * Moves a folder subtree to Trash from the Documents workspace.
 *
 * @param formData - Folder identifiers and safe workspace return values.
 * @returns Never returns; redirects to the Documents workspace with status.
 */
export async function trashFolderAction(formData: FormData): Promise<void> {
  await runFolderAction(formData, "trash_folder_action", "resource_trashed", trashFolder)
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
  await runDocumentAction(formData, "request_document_purge_action", "deletion_queued", (input) =>
    requestDocumentPurge({
      ...input,
      confirmationTitle: getFormString(formData, "confirmationTitle"),
    })
  )
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
  await runFolderAction(formData, "request_folder_purge_action", "deletion_queued", (input) =>
    requestFolderPurge({
      ...input,
      confirmationName: getFormString(formData, "confirmationName"),
    })
  )
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
  const detailPath = `/documents/${encodeURIComponent(documentId)}`

  await runFormAction({
    event: "create_document_comment_action",
    log: { documentId, organizationId },
    path: detailPath,
    success: "comment_added",
    run: async () => {
      const user = await getAuthenticatedUser()
      await createDocumentComment({
        actorUserId: user.id,
        organizationId,
        documentId,
        body: getFormString(formData, "body"),
      })
      revalidatePath(detailPath)
    },
  })
}

// Workspace rows submit the return view so the actor stays in the list they
// acted from. Detail-page forms omit it and fall back to the document itself,
// which is the only safe target once a document has been trashed; a purged
// one has no detail page left, so its rows always send a return view.
async function runDocumentAction(
  formData: FormData,
  event: string,
  success: ActionFeedbackCode,
  change: (input: ActionActor & { documentId: string }) => Promise<unknown>
): Promise<never> {
  const documentId = getFormString(formData, "documentId")
  const detailPath = `/documents/${encodeURIComponent(documentId)}`

  return runFormAction({
    event,
    log: { documentId },
    path: getFormString(formData, "returnView")
      ? getDocumentsReturnPath(formData)
      : detailPath,
    success,
    run: async () => {
      const { actor } = await loadActionContext(NO_ORGANIZATION, 403)
      await change({ ...actor, documentId })
      revalidatePath("/documents")
      revalidatePath(detailPath)
    },
  })
}

async function runFolderAction(
  formData: FormData,
  event: string,
  success: ActionFeedbackCode,
  change: (input: ActionActor & { folderId: string }) => Promise<unknown>
): Promise<never> {
  const folderId = getFormString(formData, "folderId")

  return runFormAction({
    event,
    log: { folderId },
    path: getDocumentsReturnPath(formData),
    success,
    run: async () => {
      const { actor } = await loadActionContext(NO_ORGANIZATION, 403)
      await change({ ...actor, folderId })
      revalidatePath("/documents")
    },
  })
}

// ponytail: one request changes or moves at most 500 folders and 500
// documents, one at a time, and a larger selection fails whole. Chunk it on the
// client, or move the loop into one database call, once folders that large
// need bulk changes.
const fileSelectionSchema = z.object({
  documentIds: z.array(z.string().uuid()).max(500),
  folderIds: z.array(z.string().uuid()).max(500),
})
const fileLifecycleChangeSchema = fileSelectionSchema.extend({
  change: z.enum(["archive", "restore", "trash"]),
})

/** One lifecycle change for several of the Files selection's items at once. */
export type FileLifecycleChange = z.infer<typeof fileLifecycleChangeSchema>

/** Which items changed, so the page can offer Undo, and how many could not. */
export type FileLifecycleResult = {
  documentIds: string[]
  failed: number
  folderIds: string[]
}

const FOLDER_CHANGES = {
  archive: archiveFolder,
  restore: restoreFolder,
  trash: trashFolder,
} as const
const DOCUMENT_CHANGES = {
  archive: archiveDocument,
  restore: restoreDocument,
  trash: trashDocument,
} as const

/**
 * Changes several files at once for the Files selection. Each item goes
 * through the same checks and audit trail as a single change; one that fails
 * is counted and the rest still change, so the page can say what happened and
 * offer Undo for exactly what moved.
 *
 * @param input - The change, and the selected folders and documents.
 * @returns The items that changed and how many could not.
 */
export async function changeFilesLifecycleAction(
  input: FileLifecycleChange
): Promise<FileLifecycleResult> {
  const { change, documentIds, folderIds } = fileLifecycleChangeSchema.parse(input)
  const { actor } = await loadActionContextOrSignIn("/documents", NO_ORGANIZATION, 403)

  return changeEachFile(actor, `bulk_${change}`, { documentIds, folderIds }, {
    document: (documentId) => DOCUMENT_CHANGES[change]({ ...actor, documentId }),
    folder: (folderId) => FOLDER_CHANGES[change]({ ...actor, folderId }),
  })
}

const fileMoveSchema = fileSelectionSchema.extend({
  destinationFolderId: z.string().uuid().nullable(),
})

/** Where the Files selection should go. */
export type FileMove = z.infer<typeof fileMoveSchema>

/**
 * Moves several of the Files selection's items into one folder, or out to the
 * top level. Each item goes through the same checks and audit trail as a
 * single move; one that fails is counted and the rest still move, so the page
 * can say what happened and offer Undo for exactly what moved.
 *
 * @param input - The destination, and the selected folders and documents.
 * @returns The items that moved and how many could not.
 */
export async function moveFilesAction(input: FileMove): Promise<FileLifecycleResult> {
  const { destinationFolderId, documentIds, folderIds } = fileMoveSchema.parse(input)
  const { actor } = await loadActionContextOrSignIn("/documents", NO_ORGANIZATION, 403)

  return changeEachFile(actor, "bulk_move", { documentIds, folderIds }, {
    document: (documentId) => moveDocument({ ...actor, documentId, folderId: destinationFolderId }),
    folder: (folderId) => moveFolder({ ...actor, folderId, parentFolderId: destinationFolderId }),
  })
}

// Folders first, then documents, one at a time; one that fails is counted
// and logged, and the rest still change.
async function changeEachFile(
  actor: ActionActor,
  event: string,
  selection: { documentIds: string[]; folderIds: string[] },
  change: Record<"document" | "folder", (id: string) => Promise<unknown>>
): Promise<FileLifecycleResult> {
  const result: FileLifecycleResult = { documentIds: [], failed: 0, folderIds: [] }
  const batches = [
    ["folder", selection.folderIds, result.folderIds],
    ["document", selection.documentIds, result.documentIds],
  ] as const

  for (const [kind, ids, changed] of batches) {
    for (const id of ids) {
      try {
        await change[kind](id)
        changed.push(id)
      } catch (error: unknown) {
        result.failed += 1
        console.warn(`${event}_${kind}_failed`, {
          organizationId: actor.organizationId,
          reason: error instanceof Error ? error.message : `Unknown ${kind} error`,
        })
      }
    }
  }

  revalidatePath("/documents")
  return result
}

/**
 * Remembers the layout a person picked in Files, as Finder does, and returns
 * them to the same folder and item.
 *
 * @param formData - The chosen layout and the Files address to return to.
 * @returns Never returns; redirects back to Files.
 */
export async function setFilesLayoutAction(formData: FormData): Promise<void> {
  const returnTo = getFormString(formData, "returnTo")
  const cookieStore = await cookies()

  cookieStore.set(
    FILES_LAYOUT_COOKIE,
    parseFilesLayout(getFormString(formData, "layout")),
    {
      httpOnly: true,
      maxAge: FILES_LAYOUT_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    }
  )

  redirect(isFilesReturnPath(returnTo) ? returnTo : FILES_PATH)
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
