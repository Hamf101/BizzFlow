import { recordDocumentAuditLog } from "@/services/documents/audit"
import { requireDocumentAccess } from "@/services/documents/access-service"
import type {
  ArchiveDocumentInput,
  DocumentServiceDeps,
} from "@/services/documents/contracts"
import { DocumentServiceError } from "@/services/documents/errors"
import {
  createSupabaseServiceError,
  getClient,
  getDocumentById,
  runDocumentOperation,
  isLifecycleAccessRefusal,
} from "@/services/documents/shared"
import type { DocumentSummary } from "@/types/document"
import { asSupabaseError, searchableErrorText } from "@/services/supabase-error"


/**
 * Archives a document by setting archive metadata.
 *
 * @param input - Actor, organization, and document identifiers.
 * @param deps - Optional service dependencies for tests.
 * @returns Archived document DTO.
 * @throws DocumentServiceError when the actor lacks access or updates fail.
 */
export async function archiveDocument(
  input: ArchiveDocumentInput,
  deps: DocumentServiceDeps = {}
): Promise<DocumentSummary> {
  return runDocumentOperation(
    "archive_document",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      documentId: input.documentId,
    },
    async (): Promise<DocumentSummary> => {
      const client = getClient(deps)

      await requireDocumentAccess(
        {
          actorUserId: input.actorUserId,
          organizationId: input.organizationId,
          documentId: input.documentId,
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

      if (existingDocument.lifecycleState !== "active") {
        throw new DocumentServiceError(
          "Only active documents can be archived.",
          409
        )
      }

      const { data: archived, error: archiveError } = await client.rpc(
        "archive_document",
        {
          target_org_id: input.organizationId,
          target_document_id: input.documentId,
          target_actor_user_id: input.actorUserId,
        }
      )

      if (archiveError) {
        throw createArchiveMutationError(archiveError)
      }

      if (archived !== true) {
        throw new DocumentServiceError("Document is already archived.", 409)
      }

      const document = await getDocumentById(
        client,
        input.organizationId,
        input.documentId
      )

      await recordDocumentAuditLog(deps, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "document.archived",
        targetType: "document",
        targetId: document.id,
        metadata: {
          title: document.title,
          archivedAt: document.archivedAt,
        },
      })

      return document
    }
  )
}

function createArchiveMutationError(error: unknown): DocumentServiceError {
  const errorLike = asSupabaseError(error)

  if (errorLike?.code === "P0002") {
    return new DocumentServiceError("Document was not found.", 404)
  }

  if (isLifecycleAccessRefusal(errorLike, searchableErrorText(errorLike))) {
    return new DocumentServiceError(
      "You do not have sufficient access to archive this document.",
      403
    )
  }

  if (
    errorLike?.code === "P0001" ||
    errorLike?.code === "23514" ||
    errorLike?.code === "23505" ||
    errorLike?.code === "40001"
  ) {
    return new DocumentServiceError(
      "The document lifecycle changed before it could be archived.",
      409
    )
  }

  return createSupabaseServiceError(error, "Unable to archive document.")
}

