import {
  requireDocumentAccess,
  requireFolderAccess,
} from "@/services/documents/access-service"
import { recordDocumentAuditLog } from "@/services/documents/audit"
import type {
  DocumentServiceClient,
  DocumentServiceDeps,
  MoveDocumentInput,
  MoveFolderInput,
} from "@/services/documents/contracts"
import { DocumentServiceError } from "@/services/documents/errors"
import {
  createSupabaseServiceError,
  getClient,
  getDocumentById,
  getFolderById,
  mapDocument,
  mapFolder,
  normalizeNullableId,
  requireActiveFolder,
  requirePermission,
  runDocumentOperation,
} from "@/services/documents/shared"
import { retrySerializationFailure } from "@/services/serialization-retry"
import type {
  DocumentFolder,
  DocumentRow,
  DocumentSummary,
  FolderRow,
} from "@/types/document"

const CYCLE_MESSAGE = "A folder cannot move inside itself."
const DOCUMENT_COLUMNS =
  "id,org_id,folder_id,title,description,current_version_id,source_kind,template_id,template_revision,lifecycle_state,created_by,updated_by,archived_by,archived_at,trashed_by,trashed_at,purge_after,pre_trash_lifecycle_state,trash_operation_id,created_at,updated_at"
const FOLDER_COLUMNS =
  "id,org_id,parent_folder_id,name,lifecycle_state,created_by,updated_by,archived_by,archived_at,trashed_by,trashed_at,purge_after,pre_trash_lifecycle_state,trash_operation_id,created_at,updated_at"

/**
 * Moves an active file into a folder, or out to the top level.
 *
 * @param input - Actor, organization, file, and destination folder.
 * @param deps - Optional service dependencies for tests.
 * @returns The file in its new place.
 * @throws DocumentServiceError when access, state, or persistence checks fail.
 */
export async function moveDocument(
  input: MoveDocumentInput,
  deps: DocumentServiceDeps = {}
): Promise<DocumentSummary> {
  return runDocumentOperation(
    "move_document",
    {
      actorUserId: input.actorUserId,
      documentId: input.documentId,
      folderId: input.folderId ?? null,
      organizationId: input.organizationId,
    },
    async (): Promise<DocumentSummary> => {
      const client = getClient(deps)

      await requireDocumentAccess(
        {
          actorUserId: input.actorUserId,
          documentId: input.documentId,
          operation: "mutation",
          organizationId: input.organizationId,
          requiredAccess: "contributor",
          requiredOrganizationPermissionAction: "documents:create",
        },
        client
      )

      const document = await getDocumentById(
        client,
        input.organizationId,
        input.documentId
      )

      if (document.lifecycleState !== "active") {
        throw new DocumentServiceError("Only an active file can move.", 409)
      }

      const folderId = await resolveDestination(client, input, input.folderId)

      if (folderId === document.folderId) {
        return document
      }

      const { data, error } = await retrySerializationFailure(() =>
        client
          .from("documents")
          .update({ folder_id: folderId, updated_by: input.actorUserId })
          .eq("id", input.documentId)
          .eq("org_id", input.organizationId)
          .eq("lifecycle_state", "active")
          .select(DOCUMENT_COLUMNS)
          .single()
      )

      if (error || !data) {
        throw createMoveError(error, "Unable to move the file.")
      }

      const moved = mapDocument(data as DocumentRow)

      await recordDocumentAuditLog(deps, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "document.moved",
        targetType: "document",
        targetId: moved.id,
        metadata: {
          fromFolderId: document.folderId,
          title: moved.title,
          toFolderId: moved.folderId,
        },
      })

      return moved
    }
  )
}

/**
 * Moves an active folder under another one, or out to the top level. The
 * database refuses a move into the folder's own branch.
 *
 * @param input - Actor, organization, folder, and destination parent.
 * @param deps - Optional service dependencies for tests.
 * @returns The folder in its new place.
 * @throws DocumentServiceError when access, state, or persistence checks fail.
 */
export async function moveFolder(
  input: MoveFolderInput,
  deps: DocumentServiceDeps = {}
): Promise<DocumentFolder> {
  return runDocumentOperation(
    "move_folder",
    {
      actorUserId: input.actorUserId,
      folderId: input.folderId,
      organizationId: input.organizationId,
      parentFolderId: input.parentFolderId ?? null,
    },
    async (): Promise<DocumentFolder> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "folders:manage",
        "You cannot manage folders."
      )
      await requireFolderAccess(
        {
          actorUserId: input.actorUserId,
          folderId: input.folderId,
          operation: "mutation",
          organizationId: input.organizationId,
          requiredAccess: "contributor",
        },
        client
      )

      const folder = await getFolderById(
        client,
        input.organizationId,
        input.folderId
      )

      if (folder.lifecycleState !== "active") {
        throw new DocumentServiceError("Only an active folder can move.", 409)
      }

      const parentFolderId = await resolveDestination(
        client,
        input,
        input.parentFolderId
      )

      if (parentFolderId === input.folderId) {
        throw new DocumentServiceError(CYCLE_MESSAGE, 409)
      }

      if (parentFolderId === folder.parentFolderId) {
        return folder
      }

      // The update takes the folder tree's lock without waiting, so a
      // colleague's write at the same instant asks for a retry.
      const { data, error } = await retrySerializationFailure(() =>
        client
          .from("folders")
          .update({
            parent_folder_id: parentFolderId,
            updated_by: input.actorUserId,
          })
          .eq("id", input.folderId)
          .eq("org_id", input.organizationId)
          .eq("lifecycle_state", "active")
          .select(FOLDER_COLUMNS)
          .single()
      )

      if (error || !data) {
        throw createMoveError(error, "Unable to move the folder.")
      }

      const moved = mapFolder(data as FolderRow)

      await recordDocumentAuditLog(deps, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "folder.moved",
        targetType: "folder",
        targetId: moved.id,
        metadata: {
          fromFolderId: folder.parentFolderId,
          name: moved.name,
          toFolderId: moved.parentFolderId,
        },
      })

      return moved
    }
  )
}

/**
 * Checks that the destination is a folder the member may add to, and is
 * still active. The top level needs no check beyond the member's own role.
 *
 * @param client - Supabase client used for the checks.
 * @param actor - Who is moving the item, and where they work.
 * @param destination - The destination folder, or null for the top level.
 * @returns The destination folder identifier, or null.
 * @throws DocumentServiceError when the destination cannot take the item.
 */
async function resolveDestination(
  client: DocumentServiceClient,
  actor: { actorUserId: string; organizationId: string },
  destination: string | null | undefined
): Promise<string | null> {
  const folderId = normalizeNullableId(destination)

  if (!folderId) {
    return null
  }

  await requireFolderAccess(
    {
      actorUserId: actor.actorUserId,
      folderId,
      operation: "mutation",
      organizationId: actor.organizationId,
      requiredAccess: "contributor",
    },
    client
  )
  await requireActiveFolder(client, actor.organizationId, folderId)

  return folderId
}

/**
 * Turns the database's answer into words a person can act on. The folder
 * triggers answer 23514 for a move into the item's own branch.
 *
 * @param error - The database error, if there was one.
 * @param fallbackMessage - What to say for anything else.
 * @returns The error to throw.
 */
function createMoveError(
  error: unknown,
  fallbackMessage: string
): DocumentServiceError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23514"
  ) {
    return new DocumentServiceError(CYCLE_MESSAGE, 409)
  }

  return createSupabaseServiceError(error, fallbackMessage)
}
