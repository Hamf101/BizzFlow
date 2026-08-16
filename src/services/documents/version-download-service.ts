import {
  createSignedDocumentDownloadUrl as defaultCreateSignedDocumentDownloadUrl,
} from "@/services/document-storage-service"
import { requireDocumentAccess } from "@/services/documents/access-service"
import { recordRequiredDocumentAuditLog } from "@/services/documents/audit"
import type {
  CreateDocumentDownloadUrlInput,
  DocumentServiceDeps,
} from "@/services/documents/contracts"
import { DocumentServiceError } from "@/services/documents/errors"
import {
  getClient,
  getDocumentById,
  normalizeNullableId,
  runDocumentOperation,
} from "@/services/documents/shared"
import { getDocumentVersionById } from "@/services/documents/version-shared"
import type { CreateDocumentDownloadUrlResponse } from "@/types/document"

/**
 * Creates a signed download URL for the current or selected document version.
 *
 * @param input - Actor, organization, document, and optional version identifiers.
 * @param deps - Optional service dependencies for tests.
 * @returns Signed download URL and version identifier.
 * @throws DocumentServiceError when the actor lacks access or no available version exists.
 */
export async function createDocumentDownloadUrl(
  input: CreateDocumentDownloadUrlInput,
  deps: DocumentServiceDeps = {}
): Promise<CreateDocumentDownloadUrlResponse> {
  return runDocumentOperation(
    "create_document_download_url",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      documentId: input.documentId,
      versionId: input.versionId ?? null,
    },
    async (): Promise<CreateDocumentDownloadUrlResponse> => {
      const client = getClient(deps)

      await requireDocumentAccess(
        {
          actorUserId: input.actorUserId,
          organizationId: input.organizationId,
          documentId: input.documentId,
          requiredAccess: "viewer",
          operation: "read",
          requiredOrganizationPermissionAction: "documents:view",
        },
        client
      )

      const document = await getDocumentById(
        client,
        input.organizationId,
        input.documentId
      )

      if (
        document.lifecycleState === "trashed" ||
        document.lifecycleState === "purge_pending"
      ) {
        throw new DocumentServiceError("Document was not found.", 404)
      }
      const versionId =
        normalizeNullableId(input.versionId) ?? document.currentVersionId

      if (!versionId) {
        throw new DocumentServiceError(
          "Document has no available version.",
          409
        )
      }

      const version = await getDocumentVersionById(
        client,
        input.organizationId,
        input.documentId,
        versionId
      )

      if (version.status !== "available") {
        throw new DocumentServiceError(
          "Document version is not available.",
          409
        )
      }

      const createSignedDocumentDownloadUrl =
        deps.createSignedDocumentDownloadUrl ??
        defaultCreateSignedDocumentDownloadUrl
      const signedUrl = await createSignedDocumentDownloadUrl({
        storageKey: version.storageKey,
      })

      await recordRequiredDocumentAuditLog(deps, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "document_version.download_url_issued",
        targetType: "document_version",
        targetId: version.id,
        metadata: {
          documentId: document.id,
          versionId: version.id,
          versionNumber: version.versionNumber,
          originalFilename: version.originalFilename,
        },
      })

      return {
        documentId: document.id,
        versionId: version.id,
        downloadUrl: signedUrl.downloadUrl,
        expiresInSeconds: signedUrl.expiresInSeconds,
      }
    }
  )
}
