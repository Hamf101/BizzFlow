import { canPerformOrganizationAction } from "@/lib/permissions"
import {
  buildDocumentObjectKey as defaultBuildDocumentObjectKey,
  createSignedDocumentUploadUrl as defaultCreateSignedDocumentUploadUrl,
  deleteDocumentStorageObject as defaultDeleteDocumentStorageObject,
  validateDocumentUploadRequest as defaultValidateDocumentUploadRequest,
  verifyDocumentUpload as defaultVerifyDocumentUpload,
} from "@/services/document-storage-service"
import {
  requireDocumentAccess,
  requireFolderAccess,
} from "@/services/documents/access-service"
import { recordDocumentAuditLog } from "@/services/documents/audit"
import type {
  ArchiveDocumentInput,
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
  DOCUMENT_COLUMNS,
  DOCUMENT_VERSION_COLUMNS,
} from "@/services/documents/shared"
import {
  createVersionMutationError,
  getDocumentVersionById,
  normalizeOriginalFilename,
  requireMatchingStorageKey,
} from "@/services/documents/version-shared"
import { type ClientFile, toClientFile } from "@/lib/r2/stored-file"
import { retrySerializationFailure } from "@/services/serialization-retry"
import type {
  CreateDocumentUploadUrlResponse,
  DocumentRow,
  DocumentSummary,
  DocumentVersion,
  DocumentVersionRow,
  DocumentVersionStatus,
} from "@/types/document"
import { normalizeName } from "@/services/input"

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
          actorMembership,
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
        await requireFolderAccess(
          {
            actorUserId: input.actorUserId,
            organizationId: input.organizationId,
            folderId,
            requiredAccess: "contributor",
            operation: "mutation",
          },
          client
        )
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
      // Everything is checked before a URL is signed or a row is written.
      const title = normalizeDocumentTitle(input.title)
      const description = normalizeOptionalText(input.description)
      const originalFilename = normalizeOriginalFilename(input.originalFilename)

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
        title,
        description,
        current_version_id: null,
        created_by: input.actorUserId,
        updated_by: input.actorUserId,
        archived_by: null,
        archived_at: null,
      })
      // The two inserts are not one transaction, so a document whose first
      // version could not be stored is taken back rather than left empty.
      const version = await insertDocumentVersion(client, {
        id: versionId,
        org_id: input.organizationId,
        document_id: document.id,
        version_number: 1,
        status: "upload_pending",
        storage_key: storageKey,
        original_filename: originalFilename,
        content_type: input.contentType,
        byte_size: input.byteSize,
        checksum_sha256: null,
        uploaded_by: input.actorUserId,
        upload_authorization_expires_at: signedUrl.expiresAt,
      }).catch(async (error: unknown) => {
        await client.from("documents").delete().eq("id", document.id).eq("org_id", input.organizationId)
        throw error
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
): Promise<ClientFile<DocumentVersion>> {
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

      await requireDocumentAccess(
        {
          actorUserId: input.actorUserId,
          organizationId: input.organizationId,
          documentId: input.documentId,
          requiredAccess: "contributor",
          operation: "mutation",
          requiredOrganizationPermissionAction: "document_versions:create",
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
          "Only active documents can be updated.",
          409
        )
      }

      // A generated document's versions are its finalized paper alone, and a
      // sheet's cells live in the document itself.
      if (document.sourceKind !== "upload") {
        throw new DocumentServiceError(
          "Only an uploaded file can take a new upload.",
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

      const checksumSha256 = await verifyDocumentUpload({
        storageKey: version.storageKey,
        contentType: version.contentType,
        byteSize: version.byteSize,
      })
      // The object is create-only, so the bytes just hashed are the bytes kept.
      const { error: checksumError } = await client
        .from("document_versions")
        .update({ checksum_sha256: checksumSha256 })
        .eq("id", input.versionId)
        .eq("org_id", input.organizationId)
        .eq("status", "upload_pending")

      if (checksumError) {
        throw createVersionMutationError(
          checksumError,
          "Unable to complete document upload."
        )
      }

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
  ).then(toClientFile)
}

/**
 * Takes back a member's own new document whose first upload never completed,
 * as when they stop it partway: the document and its pending version go, and
 * any bytes that reached storage after them. A document with a completed
 * version, someone else's, or one in another workspace is not found.
 *
 * @param input - Actor, organization, and document identifiers.
 * @param deps - Optional service dependencies for tests.
 * @throws DocumentServiceError 403 without the right to add documents, 404 when there is no such upload.
 */
export async function discardPendingDocumentUpload(
  input: ArchiveDocumentInput,
  deps: DocumentServiceDeps = {}
): Promise<void> {
  return runDocumentOperation("discard_pending_document_upload", input, async (): Promise<void> => {
    const client = getClient(deps)

    await requirePermission(client, input.organizationId, input.actorUserId, "documents:create", "You cannot create documents.")

    const { data: versions, error: versionError } = await client
      .from("document_versions")
      .select("storage_key")
      .eq("document_id", input.documentId)
      .eq("org_id", input.organizationId)
      .eq("status", "upload_pending")

    if (versionError) {
      throw createSupabaseServiceError(versionError, "Unable to discard the upload.")
    }

    // One statement, so an upload completing at the same moment keeps its document.
    const { data: discarded, error } = await client
      .from("documents")
      .delete()
      .eq("id", input.documentId)
      .eq("org_id", input.organizationId)
      .eq("created_by", input.actorUserId)
      .eq("source_kind", "upload")
      .eq("lifecycle_state", "active")
      .is("current_version_id", null)
      .select("id,title")

    if (error) {
      throw createSupabaseServiceError(error, "Unable to discard the upload.")
    }

    if (!discarded?.length) {
      throw new DocumentServiceError("Pending upload was not found.", 404)
    }

    // ponytail: best effort; bytes a stopped PUT lands after this stay unreferenced in the private bucket until a sweep exists.
    for (const { storage_key: storageKey } of (versions ?? []) as Array<{ storage_key: string }>) {
      await (deps.deleteDocumentStorageObject ?? defaultDeleteDocumentStorageObject)({ storageKey }).catch(() => undefined)
    }

    await recordDocumentAuditLog(deps, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "document.purged",
      targetType: "document",
      targetId: input.documentId,
      metadata: { title: String(discarded[0]?.title ?? ""), uploadDiscarded: true },
    })
  })
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
  // The insert takes the folder tree's lock without waiting, so a colleague's
  // write at the same instant asks for a retry.
  const { data, error } = await retrySerializationFailure(() =>
    // tenant-scope: row is typed with org_id; the caller sets it to input.organizationId
    client
      .from("documents")
      .insert(row)
      .select(DOCUMENT_COLUMNS)
      .single()
  )

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
    upload_authorization_expires_at: string
  }
): Promise<DocumentVersion> {
  // tenant-scope: row is typed with org_id; the caller sets it to input.organizationId
  const { data, error } = await client
    .from("document_versions")
    .insert(row)
    .select(DOCUMENT_VERSION_COLUMNS)
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
  return normalizeName(title, "Document title", 1, 180, (message) => new DocumentServiceError(message, 400))
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim()

  return normalizedValue ? normalizedValue : null
}
