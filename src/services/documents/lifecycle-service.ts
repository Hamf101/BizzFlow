import { recordDocumentAuditLog } from "@/services/documents/audit"
import {
  requireDocumentAccess,
  requireFolderAccess,
} from "@/services/documents/access-service"
import type {
  DocumentServiceClient,
  DocumentServiceDeps,
  FolderLifecycleInput,
  RestoreDocumentInput,
  TrashDocumentInput,
} from "@/services/documents/contracts"
import { DocumentServiceError } from "@/services/documents/errors"
import {
  createId,
  createSupabaseServiceError,
  getClient,
  getDocumentById,
  getFolderById,
  runDocumentOperation,
} from "@/services/documents/shared"
import type { DocumentFolder, DocumentSummary } from "@/types/document"

type DocumentLifecycleRpc = "restore_document" | "trash_document"
type DocumentLifecycleTransition =
  | {
      rpcName: "restore_document"
      input: RestoreDocumentInput
    }
  | {
      rpcName: "trash_document"
      input: TrashDocumentInput
      trashOperationId: string
    }
type FolderLifecycleRpc =
  | "archive_folder"
  | "restore_folder"
  | "trash_folder"

type SupabaseErrorLike = {
  code?: string
  details?: string
  hint?: string
  message?: string
}

/**
 * Restores an archived document to Active or a trashed document to its
 * pre-trash state.
 *
 * @param input - Actor, organization, and document identifiers.
 * @param deps - Optional service dependencies for tests.
 * @returns Restored document metadata.
 * @throws DocumentServiceError when access, state, or persistence checks fail.
 */
export async function restoreDocument(
  input: RestoreDocumentInput,
  deps: DocumentServiceDeps = {}
): Promise<DocumentSummary> {
  return runDocumentOperation(
    "restore_document",
    input,
    async (): Promise<DocumentSummary> => {
      const client = getClient(deps)

      await requireDocumentAccess(
        {
          ...input,
          requiredAccess: "contributor",
          operation: "mutation",
          requiredOrganizationPermissionAction: "documents:archive",
        },
        client
      )
      const existingDocument = await getDocumentById(
        client,
        input.organizationId,
        input.documentId
      )

      if (existingDocument.lifecycleState === "active") {
        throw new DocumentServiceError("Document is already active.", 409)
      }

      if (existingDocument.lifecycleState === "purge_pending") {
        throw new DocumentServiceError(
          "A purge-pending document cannot be restored.",
          409
        )
      }

      await requireSuccessfulDocumentTransition(
        {
          rpcName: "restore_document",
          input,
        },
        client
      )
      const restoredDocument = await getDocumentById(
        client,
        input.organizationId,
        input.documentId
      )

      await recordDocumentAuditLog(deps, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "document.restored",
        targetType: "document",
        targetId: restoredDocument.id,
        metadata: {
          title: restoredDocument.title,
          lifecycleState: restoredDocument.lifecycleState,
        },
      })

      return restoredDocument
    }
  )
}

/**
 * Moves an active or archived document to Trash with a unique reversible
 * operation identifier.
 *
 * @param input - Actor, organization, and document identifiers.
 * @param deps - Optional service dependencies for tests.
 * @returns Trashed document metadata, including its retention deadline.
 * @throws DocumentServiceError when access, state, or persistence checks fail.
 */
export async function trashDocument(
  input: TrashDocumentInput,
  deps: DocumentServiceDeps = {}
): Promise<DocumentSummary> {
  return runDocumentOperation(
    "trash_document",
    input,
    async (): Promise<DocumentSummary> => {
      const client = getClient(deps)

      await requireDocumentAccess(
        {
          ...input,
          requiredAccess: "contributor",
          operation: "mutation",
          requiredOrganizationPermissionAction: "documents:archive",
        },
        client
      )
      const existingDocument = await getDocumentById(
        client,
        input.organizationId,
        input.documentId
      )

      if (existingDocument.lifecycleState === "trashed") {
        throw new DocumentServiceError("Document is already in Trash.", 409)
      }

      if (existingDocument.lifecycleState === "purge_pending") {
        throw new DocumentServiceError(
          "A purge-pending document cannot be moved to Trash.",
          409
        )
      }

      const trashOperationId = createId(deps)

      await requireSuccessfulDocumentTransition(
        {
          rpcName: "trash_document",
          input,
          trashOperationId,
        },
        client
      )
      const trashedDocument = await getDocumentById(
        client,
        input.organizationId,
        input.documentId
      )

      await recordDocumentAuditLog(deps, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "document.trashed",
        targetType: "document",
        targetId: trashedDocument.id,
        metadata: {
          title: trashedDocument.title,
          purgeAfter: trashedDocument.purgeAfter,
          retentionProtected: trashedDocument.purgeAfter === null,
          trashOperationId,
        },
      })

      return trashedDocument
    }
  )
}

/**
 * Archives a single active folder atomically.
 *
 * @param input - Actor, organization, and folder identifiers.
 * @param deps - Optional service dependencies for tests.
 * @returns The archived root folder.
 * @throws DocumentServiceError when access, state, or persistence checks fail.
 */
export async function archiveFolder(
  input: FolderLifecycleInput,
  deps: DocumentServiceDeps = {}
): Promise<DocumentFolder> {
  return transitionFolder("archive_folder", input, deps)
}

/**
 * Restores a folder subtree changed by the same lifecycle operation.
 *
 * @param input - Actor, organization, and folder identifiers.
 * @param deps - Optional service dependencies for tests.
 * @returns The restored root folder.
 * @throws DocumentServiceError when access, state, or persistence checks fail.
 */
export async function restoreFolder(
  input: FolderLifecycleInput,
  deps: DocumentServiceDeps = {}
): Promise<DocumentFolder> {
  return transitionFolder("restore_folder", input, deps)
}

/**
 * Moves a folder subtree to Trash atomically.
 *
 * @param input - Actor, organization, and folder identifiers.
 * @param deps - Optional service dependencies for tests.
 * @returns The trashed root folder.
 * @throws DocumentServiceError when access, state, or persistence checks fail.
 */
export async function trashFolder(
  input: FolderLifecycleInput,
  deps: DocumentServiceDeps = {}
): Promise<DocumentFolder> {
  return transitionFolder("trash_folder", input, deps)
}

async function transitionFolder(
  rpcName: FolderLifecycleRpc,
  input: FolderLifecycleInput,
  deps: DocumentServiceDeps
): Promise<DocumentFolder> {
  return runDocumentOperation(
    rpcName,
    input,
    async (): Promise<DocumentFolder> => {
      const client = getClient(deps)

      await requireFolderAccess(
        {
          ...input,
          requiredAccess: "contributor",
          operation: "mutation",
          requiredOrganizationPermissionAction: "folders:manage",
        },
        client
      )
      const existingFolder = await getFolderById(
        client,
        input.organizationId,
        input.folderId
      )
      assertFolderTransitionAllowed(rpcName, existingFolder)
      const { data, error } =
        rpcName === "trash_folder"
          ? await client.rpc("trash_folder", {
              target_org_id: input.organizationId,
              target_folder_id: input.folderId,
              target_actor_user_id: input.actorUserId,
              target_trash_operation_id: createId(deps),
            })
          : await client.rpc(rpcName, {
              target_org_id: input.organizationId,
              target_folder_id: input.folderId,
              target_actor_user_id: input.actorUserId,
            })

      if (error) {
        throw createLifecycleMutationError(
          error,
          `Unable to ${getTransitionVerb(rpcName)} folder.`
        )
      }

      if (data !== true) {
        throw new DocumentServiceError(
          `Folder is already ${getTransitionStateLabel(rpcName)}.`,
          409
        )
      }

      return getFolderById(client, input.organizationId, input.folderId)
    }
  )
}

async function requireSuccessfulDocumentTransition(
  transition: DocumentLifecycleTransition,
  client: DocumentServiceClient
): Promise<void> {
  const { input, rpcName } = transition
  const { data, error } =
    transition.rpcName === "trash_document"
      ? await client.rpc("trash_document", {
          target_org_id: input.organizationId,
          target_document_id: input.documentId,
          target_actor_user_id: input.actorUserId,
          target_trash_operation_id: transition.trashOperationId,
        })
      : await client.rpc("restore_document", {
          target_org_id: input.organizationId,
          target_document_id: input.documentId,
          target_actor_user_id: input.actorUserId,
        })

  if (error) {
    throw createLifecycleMutationError(
      error,
      `Unable to ${getTransitionVerb(rpcName)} document.`
    )
  }

  if (data !== true) {
    throw new DocumentServiceError(
      `Document is already ${getTransitionStateLabel(rpcName)}.`,
      409
    )
  }
}

function assertFolderTransitionAllowed(
  rpcName: FolderLifecycleRpc,
  folder: DocumentFolder
): void {
  if (rpcName === "archive_folder" && folder.lifecycleState !== "active") {
    throw new DocumentServiceError(
      "Only active folders can be archived.",
      409
    )
  }

  if (rpcName === "trash_folder") {
    if (folder.lifecycleState === "trashed") {
      throw new DocumentServiceError("Folder is already in Trash.", 409)
    }

    if (folder.lifecycleState === "purge_pending") {
      throw new DocumentServiceError(
        "A purge-pending folder cannot be moved to Trash.",
        409
      )
    }
  }

  if (rpcName === "restore_folder") {
    if (folder.lifecycleState === "active") {
      throw new DocumentServiceError("Folder is already active.", 409)
    }

    if (folder.lifecycleState === "purge_pending") {
      throw new DocumentServiceError(
        "A purge-pending folder cannot be restored.",
        409
      )
    }
  }
}

function createLifecycleMutationError(
  error: unknown,
  fallbackMessage: string
): DocumentServiceError {
  const errorLike = getSupabaseErrorLike(error)
  const message = [
    errorLike?.message,
    errorLike?.details,
    errorLike?.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (errorLike?.code === "P0002") {
    return new DocumentServiceError(
      message.includes("folder")
        ? "Folder was not found."
        : "Document was not found.",
      404
    )
  }

  if (isLifecycleAccessDenied(errorLike, message)) {
    return new DocumentServiceError(
      "You do not have sufficient access for this lifecycle change.",
      403
    )
  }

  if (
    errorLike?.code === "P0001" ||
    errorLike?.code === "23514" ||
    errorLike?.code === "23505"
  ) {
    return new DocumentServiceError(fallbackMessage, 409)
  }

  return createSupabaseServiceError(error, fallbackMessage)
}

function isLifecycleAccessDenied(
  error: SupabaseErrorLike | null,
  searchableMessage: string
): boolean {
  if (error?.code === "42501") {
    return (
      searchableMessage.includes("active organization membership") ||
      searchableMessage.includes(
        "contributor access and a manager role"
      ) ||
      searchableMessage.includes("sufficient access")
    )
  }

  return (
    error?.code === "P0001" &&
    (searchableMessage.includes("required") ||
      searchableMessage.includes("access"))
  )
}

function getSupabaseErrorLike(error: unknown): SupabaseErrorLike | null {
  return error && typeof error === "object"
    ? (error as SupabaseErrorLike)
    : null
}

function getTransitionVerb(
  rpcName: DocumentLifecycleRpc | FolderLifecycleRpc
): string {
  if (rpcName.startsWith("restore_")) {
    return "restore"
  }

  if (rpcName.startsWith("trash_")) {
    return "move to Trash"
  }

  return "archive"
}

function getTransitionStateLabel(
  rpcName: DocumentLifecycleRpc | FolderLifecycleRpc
): string {
  if (rpcName.startsWith("restore_")) {
    return "restored"
  }

  if (rpcName.startsWith("trash_")) {
    return "in Trash"
  }

  return "archived"
}
