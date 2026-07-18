import { recordDocumentAuditLog } from "@/services/documents/audit"
import type {
  CreateFolderInput,
  DocumentServiceClient,
  DocumentServiceDeps,
  GetDocumentDetailInput,
  ListDocumentWorkspaceInput,
} from "@/services/documents/contracts"
import { DocumentServiceError } from "@/services/documents/errors"
import {
  createId,
  createSupabaseServiceError,
  getClient,
  getDocumentById,
  mapDocument,
  mapDocumentVersion,
  mapFolder,
  normalizeNullableId,
  requireActiveFolder,
  requirePermission,
  runDocumentOperation,
} from "@/services/documents/shared"
import type {
  DocumentDetail,
  DocumentFolder,
  DocumentRow,
  DocumentVersion,
  DocumentVersionRow,
  DocumentWorkspace,
  FolderRow,
} from "@/types/document"

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
        .select("id,org_id,folder_id,title,description,current_version_id,source_kind,template_id,template_revision,created_by,updated_by,archived_by,archived_at,created_at,updated_at")
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
