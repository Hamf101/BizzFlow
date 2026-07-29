import {
  buildDocumentObjectKey as defaultBuildDocumentObjectKey,
  createSignedDocumentUploadUrl as defaultCreateSignedDocumentUploadUrl,
  validateDocumentUploadRequest as defaultValidateDocumentUploadRequest,
} from "@/services/document-storage-service"
import { requireDocumentAccess } from "@/services/documents/access-service"
import { recordDocumentAuditLog } from "@/services/documents/audit"
import type {
  CreateDocumentReplacementUploadUrlInput,
  DocumentServiceDeps,
} from "@/services/documents/contracts"
import { DocumentServiceError } from "@/services/documents/errors"
import {
  createId,
  getClient,
  getDocumentById,
  normalizeNullableId,
  requirePermission,
  runDocumentOperation,
} from "@/services/documents/shared"
import {
  createVersionMutationError,
  getDocumentVersionById,
  normalizeOriginalFilename,
  requireMatchingStorageKey,
} from "@/services/documents/version-shared"
import type { CreateDocumentUploadUrlResponse } from "@/types/document"

/**
 * Creates the next pending version or refreshes upload access for that version.
 *
 * @param input - Actor, document, file metadata, and optional pending version id.
 * @param deps - Optional service dependencies for tests.
 * @returns Signed upload URL and the new or resumed version identifier.
 * @throws DocumentServiceError when validation, permission, allocation, or signing fails.
 */
export async function createDocumentReplacementUploadUrl(
  input: CreateDocumentReplacementUploadUrlInput,
  deps: DocumentServiceDeps = {}
): Promise<CreateDocumentUploadUrlResponse> {
  return runDocumentOperation(
    "create_document_replacement_upload_url",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      documentId: input.documentId,
      pendingVersionId: input.pendingVersionId ?? null,
      contentType: input.contentType,
      byteSize: input.byteSize,
    },
    async (): Promise<CreateDocumentUploadUrlResponse> => {
      const client = getClient(deps)
      const actorMembership = await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "document_versions:create",
        "You cannot create document versions."
      )
      await requireDocumentAccess(
        {
          actorUserId: input.actorUserId,
          organizationId: input.organizationId,
          documentId: input.documentId,
          requiredAccess: "contributor",
          operation: "mutation",
        },
        client
      )
      const document = await getDocumentById(
        client,
        input.organizationId,
        input.documentId
      )

      if (document.lifecycleState !== "active") {
        throw new DocumentServiceError(
          "Only active documents can be replaced.",
          409
        )
      }

      const validateDocumentUploadRequest =
        deps.validateDocumentUploadRequest ??
        defaultValidateDocumentUploadRequest
      const buildDocumentObjectKey =
        deps.buildDocumentObjectKey ?? defaultBuildDocumentObjectKey
      const createSignedDocumentUploadUrl =
        deps.createSignedDocumentUploadUrl ??
        defaultCreateSignedDocumentUploadUrl
      const originalFilename = normalizeOriginalFilename(
        input.originalFilename
      )

      validateDocumentUploadRequest({
        contentType: input.contentType,
        byteSize: input.byteSize,
      })

      const pendingVersionId = normalizeNullableId(input.pendingVersionId)

      if (pendingVersionId) {
        const pendingVersion = await getDocumentVersionById(
          client,
          input.organizationId,
          document.id,
          pendingVersionId
        )

        if (pendingVersion.status !== "upload_pending") {
          throw new DocumentServiceError(
            "Only pending document versions can refresh upload access.",
            409
          )
        }

        if (pendingVersion.uploadedBy !== input.actorUserId) {
          throw new DocumentServiceError(
            "You can only resume your own pending document version.",
            403
          )
        }

        if (
          pendingVersion.originalFilename !== originalFilename ||
          pendingVersion.contentType !== input.contentType ||
          pendingVersion.byteSize !== input.byteSize
        ) {
          throw new DocumentServiceError(
            "Pending version metadata does not match the replacement file.",
            409
          )
        }

        const refreshedUrl = await createSignedDocumentUploadUrl({
          organizationId: input.organizationId,
          documentId: document.id,
          versionId: pendingVersion.id,
          contentType: pendingVersion.contentType,
          byteSize: pendingVersion.byteSize,
        })

        requireMatchingStorageKey(
          pendingVersion.storageKey,
          refreshedUrl.storageKey
        )

        return {
          documentId: document.id,
          versionId: pendingVersion.id,
          uploadUrl: refreshedUrl.uploadUrl,
          storageKey: refreshedUrl.storageKey,
          expiresInSeconds: refreshedUrl.expiresInSeconds,
        }
      }

      const versionId = createId(deps)
      const storageKey = buildDocumentObjectKey({
        organizationId: input.organizationId,
        documentId: document.id,
        versionId,
        contentType: input.contentType,
      })
      const signedUrl = await createSignedDocumentUploadUrl({
        organizationId: input.organizationId,
        documentId: document.id,
        versionId,
        contentType: input.contentType,
        byteSize: input.byteSize,
      })

      requireMatchingStorageKey(storageKey, signedUrl.storageKey)

      const { data: createdVersionId, error: allocationError } =
        await client.rpc("create_pending_document_version", {
          target_org_id: input.organizationId,
          target_document_id: document.id,
          target_version_id: versionId,
          target_storage_key: storageKey,
          target_original_filename: originalFilename,
          target_content_type: input.contentType,
          target_byte_size: input.byteSize,
          target_checksum_sha256: null,
          target_uploaded_by: input.actorUserId,
        })

      if (allocationError || createdVersionId !== versionId) {
        throw createVersionMutationError(
          allocationError,
          "Unable to create replacement version."
        )
      }

      const version = await getDocumentVersionById(
        client,
        input.organizationId,
        document.id,
        versionId
      )

      await recordDocumentAuditLog(deps, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "document_version.created",
        targetType: "document_version",
        targetId: version.id,
        metadata: {
          documentId: document.id,
          versionNumber: version.versionNumber,
          contentType: version.contentType,
          byteSize: version.byteSize,
          role: actorMembership.role,
        },
      })

      return {
        documentId: document.id,
        versionId: version.id,
        uploadUrl: signedUrl.uploadUrl,
        storageKey: signedUrl.storageKey,
        expiresInSeconds: signedUrl.expiresInSeconds,
      }
    }
  )
}
