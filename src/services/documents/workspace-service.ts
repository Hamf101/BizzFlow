import { recordDocumentAuditLog } from "@/services/documents/audit"
import {
  getEffectiveDocumentAccess,
  getEffectiveFolderAccess,
  requireDocumentAccess,
  requireFolderAccess,
} from "@/services/documents/access-service"
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
  AccessibleDocumentFolder,
  AccessibleDocumentSummary,
  DocumentDetail,
  DocumentFolder,
  DocumentRow,
  DocumentVersion,
  DocumentVersionRow,
  DocumentWorkspace,
  FolderRow,
} from "@/types/document"

const ACCESS_LOOKUP_CONCURRENCY = 8

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
        await requireFolderAccess(
          {
            actorUserId: input.actorUserId,
            organizationId: input.organizationId,
            folderId: parentFolderId,
            requiredAccess: "contributor",
            operation: "mutation",
          },
          client
        )
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
        .select("id,org_id,parent_folder_id,name,lifecycle_state,created_by,updated_by,archived_by,archived_at,trashed_by,trashed_at,purge_after,pre_trash_lifecycle_state,trash_operation_id,created_at,updated_at")
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
 * Lists accessible folders and documents for one lifecycle workspace view.
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
      lifecycleState: input.lifecycleState ?? "active",
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
      const lifecycleState = input.lifecycleState ?? "active"
      const lifecycleStates =
        lifecycleState === "trashed"
          ? (["trashed", "purge_pending"] as const)
          : [lifecycleState]

      const folderQuery = client
        .from("folders")
        .select("id,org_id,parent_folder_id,name,lifecycle_state,created_by,updated_by,archived_by,archived_at,trashed_by,trashed_at,purge_after,pre_trash_lifecycle_state,trash_operation_id,created_at,updated_at")
        .eq("org_id", input.organizationId)
      const { data: folderData, error: folderError } =
        lifecycleStates.length === 1
          ? await folderQuery
              .eq("lifecycle_state", lifecycleStates[0])
              .order("name", { ascending: true })
          : await folderQuery
              .in("lifecycle_state", [...lifecycleStates])
              .order("name", { ascending: true })

      if (folderError || !folderData) {
        throw createSupabaseServiceError(folderError, "Unable to load folders.")
      }

      const documentQuery = client
        .from("documents")
        .select("id,org_id,folder_id,title,description,current_version_id,source_kind,template_id,template_revision,lifecycle_state,created_by,updated_by,archived_by,archived_at,trashed_by,trashed_at,purge_after,pre_trash_lifecycle_state,trash_operation_id,created_at,updated_at")
        .eq("org_id", input.organizationId)
      const { data: documentData, error: documentError } =
        lifecycleStates.length === 1
          ? await documentQuery
              .eq("lifecycle_state", lifecycleStates[0])
              .order("created_at", { ascending: false })
          : await documentQuery
              .in("lifecycle_state", [...lifecycleStates])
              .order("created_at", { ascending: false })

      if (documentError || !documentData) {
        throw createSupabaseServiceError(
          documentError,
          "Unable to load documents."
        )
      }

      const foldersWithAccess = await mapWithAccessLookupLimit(
        folderData as FolderRow[],
        async (
          row: FolderRow
        ): Promise<AccessibleDocumentFolder | null> => {
          const access = await getEffectiveFolderAccess(
            {
              actorUserId: input.actorUserId,
              organizationId: input.organizationId,
              folderId: row.id,
            },
            client
          )

          return access
            ? {
                ...mapFolder(row),
                accessLevel: access,
              }
            : null
        }
      )
      const visibleFolders = foldersWithAccess.filter(
        (
          folder: AccessibleDocumentFolder | null
        ): folder is AccessibleDocumentFolder => folder !== null
      )
      const visibleFolderIds = new Set(
        visibleFolders.map(
          (folder: AccessibleDocumentFolder): string => folder.id
        )
      )
      const normalizedFolders = visibleFolders.map(
        (
          folder: AccessibleDocumentFolder
        ): AccessibleDocumentFolder =>
          folder.parentFolderId &&
          !visibleFolderIds.has(folder.parentFolderId)
            ? { ...folder, parentFolderId: null }
            : folder
      )
      const documentsWithAccess = await mapWithAccessLookupLimit(
        documentData as DocumentRow[],
        async (
          row: DocumentRow
        ): Promise<AccessibleDocumentSummary | null> => {
          const access = await getEffectiveDocumentAccess(
            {
              actorUserId: input.actorUserId,
              organizationId: input.organizationId,
              documentId: row.id,
            },
            client
          )

          if (!access) {
            return null
          }

          const document: AccessibleDocumentSummary = {
            ...mapDocument(row),
            accessLevel: access,
          }

          // A direct document grant must not disclose an inaccessible parent
          // folder or strand the document outside the visible workspace.
          return document.folderId && !visibleFolderIds.has(document.folderId)
            ? { ...document, folderId: null }
            : document
        }
      )

      return {
        folders: normalizedFolders,
        documents: documentsWithAccess.filter(
          (
            document: AccessibleDocumentSummary | null
          ): document is AccessibleDocumentSummary => document !== null
        ),
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

      const accessLevel = await requireDocumentAccess(
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

      const versions = await listDocumentVersions(
        client,
        input.organizationId,
        input.documentId
      )

      return {
        document: {
          ...document,
          accessLevel,
        },
        versions,
      }
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

async function mapWithAccessLookupLimit<Input, Output>(
  items: readonly Input[],
  mapper: (item: Input) => Promise<Output>
): Promise<Output[]> {
  const results = new Array<Output>(items.length)
  let nextIndex = 0

  const workers = Array.from(
    {
      length: Math.min(ACCESS_LOOKUP_CONCURRENCY, items.length),
    },
    async (): Promise<void> => {
      while (nextIndex < items.length) {
        const itemIndex = nextIndex
        nextIndex += 1
        results[itemIndex] = await mapper(items[itemIndex])
      }
    }
  )

  await Promise.all(workers)
  return results
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
