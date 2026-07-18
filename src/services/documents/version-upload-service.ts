import { canPerformOrganizationAction } from "@/lib/permissions"
import {
  buildDocumentObjectKey as defaultBuildDocumentObjectKey,
  createSignedDocumentUploadUrl as defaultCreateSignedDocumentUploadUrl,
  validateDocumentUploadRequest as defaultValidateDocumentUploadRequest,
  verifyDocumentUpload as defaultVerifyDocumentUpload,
} from "@/services/document-storage-service"
import { recordDocumentAuditLog } from "@/services/documents/audit"
import type {
  CompleteDocumentUploadInput,
  CreateDocumentUploadUrlInput,
  DocumentServiceClient,
  DocumentServiceDeps,
} from "@/services/documents/contracts"
import { DocumentServiceError } from "@/services/documents/errors"
import {
  createId,
  createSupabaseServiceError,
  getClient,
  getDocumentById,
  mapDocument,
  mapDocumentVersion,
  normalizeNullableId,
  requireActiveFolder,
  requirePermission,
  runDocumentOperation,
} from "@/services/documents/shared"
import {
  createVersionMutationError,
  getDocumentVersionById,
  normalizeOriginalFilename,
  requireMatchingStorageKey,
} from "@/services/documents/version-shared"
import type {
  CreateDocumentUploadUrlResponse,
  DocumentRow,
  DocumentSummary,
  DocumentVersion,
  DocumentVersionRow,
  DocumentVersionStatus,
} from "@/types/document"

/**
 * Creates document metadata, an upload-pending version, and a signed PUT URL.
 *
 * @param input - Actor, organization, document metadata, and file metadata.
 * @param deps - Optional service dependencies for tests.
 * @returns Signed upload URL and created document/version identifiers.
 * @throws DocumentServiceError when validation, permission, writes, or signing fail.
 */
export async function createDocumentUploadUrl(
  input: CreateDocumentUploadUrlInput,
  deps: DocumentServiceDeps = {}
): Promise<CreateDocumentUploadUrlResponse> {
  return runDocumentOperation(
    "create_document_upload_url",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      folderId: input.folderId ?? null,
      contentType: input.contentType,
      byteSize: input.byteSize,
    },
    async (): Promise<CreateDocumentUploadUrlResponse> => {
      const client = getClient(deps)
      const actorMembership = await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:create",
        "You cannot create documents."
      )

      if (
        !canPerformOrganizationAction(
          actorMembership.role,
          "document_versions:create"
        )
      ) {
        throw new DocumentServiceError(
          "You cannot create document versions.",
          403
        )
      }

      const folderId = normalizeNullableId(input.folderId)

      if (folderId) {
        await requireActiveFolder(client, input.organizationId, folderId)
      }

      const documentId = createId(deps)
      const versionId = createId(deps)
      const validateDocumentUploadRequest =
        deps.validateDocumentUploadRequest ??
        defaultValidateDocumentUploadRequest
      const buildDocumentObjectKey =
        deps.buildDocumentObjectKey ?? defaultBuildDocumentObjectKey

      validateDocumentUploadRequest({
        contentType: input.contentType,
        byteSize: input.byteSize,
      })

      const storageKey = buildDocumentObjectKey({
        organizationId: input.organizationId,
        documentId,
        versionId,
        contentType: input.contentType,
      })
      const createSignedDocumentUploadUrl =
        deps.createSignedDocumentUploadUrl ??
        defaultCreateSignedDocumentUploadUrl
      const signedUrl = await createSignedDocumentUploadUrl({
        organizationId: input.organizationId,
        documentId,
        versionId,
        contentType: input.contentType,
        byteSize: input.byteSize,
      })

      requireMatchingStorageKey(storageKey, signedUrl.storageKey)

      const document = await insertDocument(client, {
        id: documentId,
        org_id: input.organizationId,
        folder_id: folderId,
        title: normalizeDocumentTitle(input.title),
        description: normalizeOptionalText(input.description),
        current_version_id: null,
        created_by: input.actorUserId,
        updated_by: input.actorUserId,
        archived_by: null,
        archived_at: null,
      })
      const version = await insertDocumentVersion(client, {
        id: versionId,
        org_id: input.organizationId,
        document_id: document.id,
        version_number: 1,
        status: "upload_pending",
        storage_key: storageKey,
        original_filename: normalizeOriginalFilename(input.originalFilename),
        content_type: input.contentType,
        byte_size: input.byteSize,
        checksum_sha256: null,
        uploaded_by: input.actorUserId,
      })

      await recordDocumentAuditLog(deps, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "document.created",
        targetType: "document",
        targetId: document.id,
        metadata: {
          title: document.title,
          role: actorMembership.role,
        },
      })
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

/**
 * Marks a document version as available after the browser uploads the object.
 *
 * @param input - Actor, organization, document, and version identifiers.
 * @param deps - Optional service dependencies for tests.
 * @returns Available document version DTO.
 * @throws DocumentServiceError when the actor lacks access or updates fail.
 */
export async function completeDocumentUpload(
  input: CompleteDocumentUploadInput,
  deps: DocumentServiceDeps = {}
): Promise<DocumentVersion> {
  return runDocumentOperation(
    "complete_document_upload",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      documentId: input.documentId,
      versionId: input.versionId,
    },
    async (): Promise<DocumentVersion> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "document_versions:create",
        "You cannot complete document uploads."
      )

      const document = await getDocumentById(
        client,
        input.organizationId,
        input.documentId
      )

      if (document.archivedAt) {
        throw new DocumentServiceError(
          "Archived documents cannot be updated.",
          409
        )
      }

      const version = await getDocumentVersionById(
        client,
        input.organizationId,
        input.documentId,
        input.versionId
      )

      if (version.status === "available") {
        return version
      }

      if (version.status !== "upload_pending") {
        throw new DocumentServiceError(
          "Document version is not pending upload.",
          409
        )
      }

      const verifyDocumentUpload =
        deps.verifyDocumentUpload ?? defaultVerifyDocumentUpload

      await verifyDocumentUpload({
        storageKey: version.storageKey,
        contentType: version.contentType,
        byteSize: version.byteSize,
      })

      const { data: completed, error: completionError } = await client.rpc(
        "complete_document_version",
        {
          target_org_id: input.organizationId,
          target_document_id: input.documentId,
          target_version_id: input.versionId,
          target_actor_user_id: input.actorUserId,
        }
      )

      if (completionError) {
        throw createVersionMutationError(
          completionError,
          "Unable to complete document upload."
        )
      }

      if (completed !== true) {
        throw new DocumentServiceError(
          "Document version could not be completed.",
          409
        )
      }

      return getDocumentVersionById(
        client,
        input.organizationId,
        input.documentId,
        input.versionId
      )
    }
  )
}

async function insertDocument(
  client: DocumentServiceClient,
  row: {
    id: string
    org_id: string
    folder_id: string | null
    title: string
    description: string | null
    current_version_id: string | null
    created_by: string
    updated_by: string
    archived_by: string | null
    archived_at: string | null
  }
): Promise<DocumentSummary> {
  const { data, error } = await client
    .from("documents")
    .insert(row)
    .select("id,org_id,folder_id,title,description,current_version_id,source_kind,template_id,template_revision,created_by,updated_by,archived_by,archived_at,created_at,updated_at")
    .single()

  if (error || !data) {
    throw createSupabaseServiceError(error, "Unable to create document.")
  }

  return mapDocument(data as DocumentRow)
}

async function insertDocumentVersion(
  client: DocumentServiceClient,
  row: {
    id: string
    org_id: string
    document_id: string
    version_number: number
    status: DocumentVersionStatus
    storage_key: string
    original_filename: string
    content_type: string
    byte_size: number
    checksum_sha256: string | null
    uploaded_by: string
  }
): Promise<DocumentVersion> {
  const { data, error } = await client
    .from("document_versions")
    .insert(row)
    .select("id,org_id,document_id,version_number,status,storage_key,original_filename,content_type,byte_size,checksum_sha256,uploaded_by,created_at,updated_at")
    .single()

  if (error || !data) {
    throw createSupabaseServiceError(
      error,
      "Unable to create document version."
    )
  }

  return mapDocumentVersion(data as DocumentVersionRow)
}

function normalizeDocumentTitle(title: string): string {
  const normalizedTitle = title.trim().replace(/\s+/g, " ")

  if (normalizedTitle.length < 1 || normalizedTitle.length > 180) {
    throw new DocumentServiceError(
      "Document title must be between 1 and 180 characters.",
      400
    )
  }

  return normalizedTitle
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim()

  return normalizedValue ? normalizedValue : null
}
