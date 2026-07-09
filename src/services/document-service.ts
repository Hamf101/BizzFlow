import { randomUUID } from "node:crypto"

import {
  createAdminClient,
  type AdminSupabaseClient,
} from "@/lib/supabase/admin"
import {
  canPerformOrganizationAction,
  isOrganizationRole,
  type OrganizationPermissionAction,
  type OrganizationRole,
} from "@/lib/permissions"
import { recordAuditLog as defaultRecordAuditLog } from "@/services/audit-service"
import {
  buildDocumentObjectKey as defaultBuildDocumentObjectKey,
  createSignedDocumentDownloadUrl as defaultCreateSignedDocumentDownloadUrl,
  createSignedDocumentUploadUrl as defaultCreateSignedDocumentUploadUrl,
  validateDocumentUploadRequest as defaultValidateDocumentUploadRequest,
} from "@/services/document-storage-service"
import type {
  AuditLogAction,
  AuditLogTargetType,
  AuditMetadata,
} from "@/types/audit"
import type {
  CreateDocumentDownloadUrlResponse,
  CreateDocumentUploadUrlResponse,
  DocumentDetail,
  DocumentFolder,
  DocumentRow,
  DocumentSummary,
  DocumentVersion,
  DocumentVersionRow,
  DocumentVersionStatus,
  DocumentWorkspace,
  FolderRow,
} from "@/types/document"
import type { OrganizationMembership } from "@/types/organization"

type DocumentServiceClient = Pick<AdminSupabaseClient, "from">

type LogValue = string | number | boolean | null | undefined

type SupabaseErrorLike = {
  code?: string
  details?: string
  hint?: string
  message?: string
}

type DocumentAuditLogInput = {
  organizationId: string
  actorUserId: string | null
  action: AuditLogAction
  targetType: AuditLogTargetType
  targetId: string
  metadata: AuditMetadata
}

type MembershipRow = {
  id: string
  org_id: string
  user_id: string
  role: string
  status: string
  created_at: string
  updated_at: string
}

export type CreateFolderInput = {
  actorUserId: string
  organizationId: string
  name: string
  parentFolderId?: string | null
}

export type ListDocumentWorkspaceInput = {
  actorUserId: string
  organizationId: string
}

export type GetDocumentDetailInput = {
  actorUserId: string
  organizationId: string
  documentId: string
}

export type CreateDocumentUploadUrlInput = {
  actorUserId: string
  organizationId: string
  folderId?: string | null
  title: string
  description?: string | null
  originalFilename: string
  contentType: string
  byteSize: number
  checksumSha256?: string | null
}

export type CompleteDocumentUploadInput = {
  actorUserId: string
  organizationId: string
  documentId: string
  versionId: string
}

export type ArchiveDocumentInput = {
  actorUserId: string
  organizationId: string
  documentId: string
}

export type CreateDocumentDownloadUrlInput = {
  actorUserId: string
  organizationId: string
  documentId: string
}

export type DocumentServiceDeps = {
  client?: DocumentServiceClient
  createId?: () => string
  now?: () => string
  recordAuditLog?: (input: DocumentAuditLogInput) => Promise<unknown>
  validateDocumentUploadRequest?: typeof defaultValidateDocumentUploadRequest
  buildDocumentObjectKey?: typeof defaultBuildDocumentObjectKey
  createSignedDocumentUploadUrl?: typeof defaultCreateSignedDocumentUploadUrl
  createSignedDocumentDownloadUrl?: typeof defaultCreateSignedDocumentDownloadUrl
}

/**
 * Error type raised by document service operations.
 */
export class DocumentServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates a document service error with an HTTP-style status code.
   *
   * @param message - User-safe error message.
   * @param statusCode - HTTP-style status code for route/action translation.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "DocumentServiceError"
    this.statusCode = statusCode
  }
}

/**
 * Creates a tenant-scoped folder.
 *
 * @param input - Actor, organization, and folder metadata.
 * @param deps - Optional service dependencies for tests.
 * @returns Created folder DTO.
 * @throws DocumentServiceError when validation, permission, or writes fail.
 */
export async function createFolder(
  input: CreateFolderInput,
  deps: DocumentServiceDeps = {}
): Promise<DocumentFolder> {
  return runDocumentOperation(
    "create_folder",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      parentFolderId: input.parentFolderId ?? null,
    },
    async (): Promise<DocumentFolder> => {
      const client = getClient(deps)
      const actorMembership = await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "folders:manage",
        "You cannot manage folders."
      )
      const folderId = createId(deps)
      const parentFolderId = normalizeNullableId(input.parentFolderId)

      if (parentFolderId) {
        await requireActiveFolder(client, input.organizationId, parentFolderId)
      }

      const { data, error } = await client
        .from("folders")
        .insert({
          id: folderId,
          org_id: input.organizationId,
          parent_folder_id: parentFolderId,
          name: normalizeFolderName(input.name),
          created_by: input.actorUserId,
          updated_by: input.actorUserId,
          archived_by: null,
          archived_at: null,
        })
        .select("id,org_id,parent_folder_id,name,created_by,updated_by,archived_by,archived_at,created_at,updated_at")
        .single()

      if (error || !data) {
        throw createSupabaseServiceError(error, "Unable to create folder.")
      }

      const folder = mapFolder(data as FolderRow)

      await recordDocumentAuditLog(deps, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "folder.created",
        targetType: "folder",
        targetId: folder.id,
        metadata: {
          name: folder.name,
          role: actorMembership.role,
        },
      })

      return folder
    }
  )
}

/**
 * Lists active folders and non-archived documents for a workspace.
 *
 * @param input - Actor and organization identifiers.
 * @param deps - Optional service dependencies for tests.
 * @returns Workspace folders and active documents.
 * @throws DocumentServiceError when the actor lacks access or reads fail.
 */
export async function listDocumentWorkspace(
  input: ListDocumentWorkspaceInput,
  deps: DocumentServiceDeps = {}
): Promise<DocumentWorkspace> {
  return runDocumentOperation(
    "list_document_workspace",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
    },
    async (): Promise<DocumentWorkspace> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:view",
        "You cannot view documents."
      )

      const { data: folderData, error: folderError } = await client
        .from("folders")
        .select("id,org_id,parent_folder_id,name,created_by,updated_by,archived_by,archived_at,created_at,updated_at")
        .eq("org_id", input.organizationId)
        .is("archived_at", null)
        .order("name", { ascending: true })

      if (folderError || !folderData) {
        throw createSupabaseServiceError(folderError, "Unable to load folders.")
      }

      const { data: documentData, error: documentError } = await client
        .from("documents")
        .select("id,org_id,folder_id,title,description,current_version_id,created_by,updated_by,archived_by,archived_at,created_at,updated_at")
        .eq("org_id", input.organizationId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })

      if (documentError || !documentData) {
        throw createSupabaseServiceError(
          documentError,
          "Unable to load documents."
        )
      }

      return {
        folders: (folderData as FolderRow[]).map(mapFolder),
        documents: (documentData as DocumentRow[]).map(mapDocument),
      }
    }
  )
}

/**
 * Loads a document and all version metadata.
 *
 * @param input - Actor, organization, and document identifiers.
 * @param deps - Optional service dependencies for tests.
 * @returns Document detail with versions ordered newest first.
 * @throws DocumentServiceError when the actor lacks access or reads fail.
 */
export async function getDocumentDetail(
  input: GetDocumentDetailInput,
  deps: DocumentServiceDeps = {}
): Promise<DocumentDetail> {
  return runDocumentOperation(
    "get_document_detail",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      documentId: input.documentId,
    },
    async (): Promise<DocumentDetail> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:view",
        "You cannot view documents."
      )

      const document = await getDocumentById(
        client,
        input.organizationId,
        input.documentId
      )
      const versions = await listDocumentVersions(
        client,
        input.organizationId,
        input.documentId
      )

      return { document, versions }
    }
  )
}

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
        throw new DocumentServiceError("You cannot create document versions.", 403)
      }

      const folderId = normalizeNullableId(input.folderId)

      if (folderId) {
        await requireActiveFolder(client, input.organizationId, folderId)
      }

      const documentId = createId(deps)
      const versionId = createId(deps)
      const validateDocumentUploadRequest =
        deps.validateDocumentUploadRequest ?? defaultValidateDocumentUploadRequest
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
        checksum_sha256: normalizeOptionalText(input.checksumSha256),
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

      const createSignedDocumentUploadUrl =
        deps.createSignedDocumentUploadUrl ?? defaultCreateSignedDocumentUploadUrl
      const signedUrl = await createSignedDocumentUploadUrl({
        organizationId: input.organizationId,
        documentId: document.id,
        versionId: version.id,
        contentType: version.contentType,
        byteSize: version.byteSize,
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
        throw new DocumentServiceError("Archived documents cannot be updated.", 409)
      }

      const version = await getDocumentVersionById(
        client,
        input.organizationId,
        input.documentId,
        input.versionId
      )

      if (version.status !== "upload_pending") {
        throw new DocumentServiceError("Document version is not pending upload.", 409)
      }

      const { data: versionData, error: versionError } = await client
        .from("document_versions")
        .update({ status: "available" })
        .eq("id", input.versionId)
        .eq("org_id", input.organizationId)
        .eq("document_id", input.documentId)
        .select("id,org_id,document_id,version_number,status,storage_key,original_filename,content_type,byte_size,checksum_sha256,uploaded_by,created_at,updated_at")
        .single()

      if (versionError || !versionData) {
        throw createSupabaseServiceError(
          versionError,
          "Unable to complete document upload."
        )
      }

      const { error: documentError } = await client
        .from("documents")
        .update({
          current_version_id: input.versionId,
          updated_by: input.actorUserId,
        })
        .eq("id", input.documentId)
        .eq("org_id", input.organizationId)
        .select("id")
        .single()

      if (documentError) {
        throw createSupabaseServiceError(
          documentError,
          "Unable to update current document version."
        )
      }

      return mapDocumentVersion(versionData as DocumentVersionRow)
    }
  )
}

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

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:archive",
        "You cannot archive documents."
      )

      const existingDocument = await getDocumentById(
        client,
        input.organizationId,
        input.documentId
      )

      if (existingDocument.archivedAt) {
        throw new DocumentServiceError("Document is already archived.", 409)
      }

      const archivedAt = getNow(deps)
      const { data, error } = await client
        .from("documents")
        .update({
          archived_at: archivedAt,
          archived_by: input.actorUserId,
          updated_by: input.actorUserId,
        })
        .eq("id", input.documentId)
        .eq("org_id", input.organizationId)
        .select("id,org_id,folder_id,title,description,current_version_id,created_by,updated_by,archived_by,archived_at,created_at,updated_at")
        .single()

      if (error || !data) {
        throw createSupabaseServiceError(error, "Unable to archive document.")
      }

      const document = mapDocument(data as DocumentRow)

      await recordDocumentAuditLog(deps, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "document.archived",
        targetType: "document",
        targetId: document.id,
        metadata: {
          title: document.title,
          archivedAt,
        },
      })

      return document
    }
  )
}

/**
 * Creates a signed download URL for the current available document version.
 *
 * @param input - Actor, organization, and document identifiers.
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
    },
    async (): Promise<CreateDocumentDownloadUrlResponse> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:view",
        "You cannot download documents."
      )

      const document = await getDocumentById(
        client,
        input.organizationId,
        input.documentId
      )

      if (!document.currentVersionId) {
        throw new DocumentServiceError("Document has no available version.", 409)
      }

      const version = await getDocumentVersionById(
        client,
        input.organizationId,
        input.documentId,
        document.currentVersionId
      )

      if (version.status !== "available") {
        throw new DocumentServiceError("Document version is not available.", 409)
      }

      const createSignedDocumentDownloadUrl =
        deps.createSignedDocumentDownloadUrl ??
        defaultCreateSignedDocumentDownloadUrl
      const signedUrl = await createSignedDocumentDownloadUrl({
        storageKey: version.storageKey,
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

async function runDocumentOperation<T>(
  operationName: string,
  identifiers: Record<string, LogValue>,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now()

  try {
    const result = await operation()
    console.info("document_service_success", {
      operationName,
      durationMs: Date.now() - startedAt,
      ...identifiers,
    })
    return result
  } catch (error: unknown) {
    if (error instanceof DocumentServiceError) {
      console.warn("document_service_rejected", {
        operationName,
        durationMs: Date.now() - startedAt,
        statusCode: error.statusCode,
        reason: error.message,
        ...identifiers,
      })
      throw error
    }

    const setupError = createDocumentSetupError(error)

    if (setupError) {
      console.warn("document_service_rejected", {
        operationName,
        durationMs: Date.now() - startedAt,
        statusCode: setupError.statusCode,
        reason: setupError.message,
        ...identifiers,
      })
      throw setupError
    }

    console.error("document_service_failed", {
      operationName,
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : "Unknown service error",
      ...identifiers,
    })
    throw new DocumentServiceError("Document service failed.", 500)
  }
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
    .select("id,org_id,folder_id,title,description,current_version_id,created_by,updated_by,archived_by,archived_at,created_at,updated_at")
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

async function requirePermission(
  client: DocumentServiceClient,
  organizationId: string,
  actorUserId: string,
  action: OrganizationPermissionAction,
  rejectionMessage: string
): Promise<OrganizationMembership> {
  const membership = await getActiveMembership(client, organizationId, actorUserId)

  if (!membership || !canPerformOrganizationAction(membership.role, action)) {
    throw new DocumentServiceError(rejectionMessage, 403)
  }

  return membership
}

async function getActiveMembership(
  client: DocumentServiceClient,
  organizationId: string,
  userId: string
): Promise<OrganizationMembership | null> {
  const { data, error } = await client
    .from("organization_memberships")
    .select("id,org_id,user_id,role,status,created_at,updated_at")
    .eq("org_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle()

  if (error) {
    throw createSupabaseServiceError(
      error,
      "Unable to load organization membership."
    )
  }

  return data ? mapMembership(data as MembershipRow) : null
}

async function requireActiveFolder(
  client: DocumentServiceClient,
  organizationId: string,
  folderId: string
): Promise<DocumentFolder> {
  const { data, error } = await client
    .from("folders")
    .select("id,org_id,parent_folder_id,name,created_by,updated_by,archived_by,archived_at,created_at,updated_at")
    .eq("id", folderId)
    .eq("org_id", organizationId)
    .is("archived_at", null)
    .maybeSingle()

  if (error) {
    throw createSupabaseServiceError(error, "Unable to load folder.")
  }

  if (!data) {
    throw new DocumentServiceError("Folder was not found.", 404)
  }

  return mapFolder(data as FolderRow)
}

async function getDocumentById(
  client: DocumentServiceClient,
  organizationId: string,
  documentId: string
): Promise<DocumentSummary> {
  const { data, error } = await client
    .from("documents")
    .select("id,org_id,folder_id,title,description,current_version_id,created_by,updated_by,archived_by,archived_at,created_at,updated_at")
    .eq("id", documentId)
    .eq("org_id", organizationId)
    .maybeSingle()

  if (error) {
    throw createSupabaseServiceError(error, "Unable to load document.")
  }

  if (!data) {
    throw new DocumentServiceError("Document was not found.", 404)
  }

  return mapDocument(data as DocumentRow)
}

async function getDocumentVersionById(
  client: DocumentServiceClient,
  organizationId: string,
  documentId: string,
  versionId: string
): Promise<DocumentVersion> {
  const { data, error } = await client
    .from("document_versions")
    .select("id,org_id,document_id,version_number,status,storage_key,original_filename,content_type,byte_size,checksum_sha256,uploaded_by,created_at,updated_at")
    .eq("id", versionId)
    .eq("org_id", organizationId)
    .eq("document_id", documentId)
    .maybeSingle()

  if (error) {
    throw createSupabaseServiceError(error, "Unable to load document version.")
  }

  if (!data) {
    throw new DocumentServiceError("Document version was not found.", 404)
  }

  return mapDocumentVersion(data as DocumentVersionRow)
}

async function listDocumentVersions(
  client: DocumentServiceClient,
  organizationId: string,
  documentId: string
): Promise<DocumentVersion[]> {
  const { data, error } = await client
    .from("document_versions")
    .select("id,org_id,document_id,version_number,status,storage_key,original_filename,content_type,byte_size,checksum_sha256,uploaded_by,created_at,updated_at")
    .eq("org_id", organizationId)
    .eq("document_id", documentId)
    .order("version_number", { ascending: false })

  if (error || !data) {
    throw createSupabaseServiceError(error, "Unable to load document versions.")
  }

  return (data as DocumentVersionRow[]).map(mapDocumentVersion)
}

async function recordDocumentAuditLog(
  deps: DocumentServiceDeps,
  input: DocumentAuditLogInput
): Promise<void> {
  const recordAuditLog = deps.recordAuditLog ?? defaultRecordAuditLog

  try {
    await recordAuditLog(input)
  } catch (error: unknown) {
    console.warn("document_audit_log_failed", {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      reason: error instanceof Error ? error.message : "Unknown audit error",
    })
  }
}

function getClient(deps: DocumentServiceDeps): DocumentServiceClient {
  return deps.client ?? createAdminClient()
}

function createId(deps: DocumentServiceDeps): string {
  return deps.createId ? deps.createId() : randomUUID()
}

function getNow(deps: DocumentServiceDeps): string {
  return deps.now ? deps.now() : new Date().toISOString()
}

function mapFolder(row: FolderRow): DocumentFolder {
  return {
    id: row.id,
    organizationId: row.org_id,
    parentFolderId: row.parent_folder_id,
    name: row.name,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    archivedBy: row.archived_by,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapDocument(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    organizationId: row.org_id,
    folderId: row.folder_id,
    title: row.title,
    description: row.description,
    currentVersionId: row.current_version_id,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    archivedBy: row.archived_by,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapDocumentVersion(row: DocumentVersionRow): DocumentVersion {
  return {
    id: row.id,
    organizationId: row.org_id,
    documentId: row.document_id,
    versionNumber: row.version_number,
    status: parseDocumentVersionStatus(row.status),
    storageKey: row.storage_key,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    byteSize: row.byte_size,
    checksumSha256: row.checksum_sha256,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapMembership(row: MembershipRow): OrganizationMembership {
  return {
    id: row.id,
    organizationId: row.org_id,
    userId: row.user_id,
    role: parseOrganizationRole(row.role),
    status: parseMembershipStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseOrganizationRole(value: string): OrganizationRole {
  if (!isOrganizationRole(value)) {
    throw new DocumentServiceError("Database returned an unsupported role.", 500)
  }

  return value
}

function parseMembershipStatus(value: string): "active" | "disabled" {
  if (value === "active" || value === "disabled") {
    return value
  }

  throw new DocumentServiceError(
    "Database returned an unsupported membership status.",
    500
  )
}

function parseDocumentVersionStatus(value: string): DocumentVersionStatus {
  if (value === "upload_pending" || value === "available") {
    return value
  }

  throw new DocumentServiceError(
    "Database returned an unsupported document version status.",
    500
  )
}

function createDocumentSetupError(error: unknown): DocumentServiceError | null {
  if (!(error instanceof Error)) {
    return null
  }

  if (error.message.includes("Invalid admin Supabase environment")) {
    return new DocumentServiceError(
      "Supabase server credentials are not configured.",
      500
    )
  }

  if (error.message.includes("Invalid R2 environment")) {
    return new DocumentServiceError("Cloudflare R2 is not configured.", 500)
  }

  if (error.message.includes("Invalid file upload policy environment")) {
    return new DocumentServiceError("File upload policy is not configured.", 500)
  }

  return null
}

function createSupabaseServiceError(
  error: unknown,
  fallbackMessage: string,
  fallbackStatusCode = 500
): DocumentServiceError {
  const setupMessage = getSupabaseSetupFailureMessage(error)

  if (setupMessage) {
    return new DocumentServiceError(setupMessage, 500)
  }

  return new DocumentServiceError(fallbackMessage, fallbackStatusCode)
}

function getSupabaseSetupFailureMessage(error: unknown): string | null {
  const errorLike = getSupabaseErrorLike(error)
  const searchableMessage = [
    errorLike?.code,
    errorLike?.message,
    errorLike?.details,
    errorLike?.hint,
    error instanceof Error ? error.message : null,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (!searchableMessage) {
    return null
  }

  if (
    searchableMessage.includes("invalid api key") ||
    searchableMessage.includes("provided api key")
  ) {
    return "Supabase server credentials are invalid. Re-copy SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY from the Supabase dashboard."
  }

  if (
    errorLike?.code === "42P01" ||
    searchableMessage.includes("does not exist") ||
    searchableMessage.includes("could not find the table") ||
    searchableMessage.includes("schema cache")
  ) {
    return "Supabase database schema is not installed or exposed. Apply the Sprint 2, Sprint 3, and Sprint 4 migrations."
  }

  if (
    searchableMessage.includes("permission denied for table") ||
    searchableMessage.includes("permission denied for schema")
  ) {
    return "Supabase table permissions are incomplete. Apply the latest migrations."
  }

  return null
}

function getSupabaseErrorLike(error: unknown): SupabaseErrorLike | null {
  if (!error || typeof error !== "object") {
    return null
  }

  return error as SupabaseErrorLike
}

function normalizeFolderName(name: string): string {
  const normalizedName = name.trim().replace(/\s+/g, " ")

  if (normalizedName.length < 1 || normalizedName.length > 120) {
    throw new DocumentServiceError(
      "Folder name must be between 1 and 120 characters.",
      400
    )
  }

  return normalizedName
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

function normalizeOriginalFilename(filename: string): string {
  const normalizedFilename = filename.trim().replace(/\s+/g, " ")

  if (normalizedFilename.length < 1 || normalizedFilename.length > 255) {
    throw new DocumentServiceError(
      "Original filename must be between 1 and 255 characters.",
      400
    )
  }

  return normalizedFilename
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim()

  return normalizedValue ? normalizedValue : null
}

function normalizeNullableId(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim()

  return normalizedValue ? normalizedValue : null
}
