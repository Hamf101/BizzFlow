import { recordDocumentAuditLog } from "@/services/documents/audit"
import {
  getEffectiveDocumentAccessLevels,
  getEffectiveFolderAccessLevels,
  parseAccessLevel,
  requireDocumentAccess,
  requireFolderAccess,
} from "@/services/documents/access-service"
import type {
  CreateFolderInput,
  DocumentServiceClient,
  DocumentServiceDeps,
  GetDocumentDetailInput,
  ListFolderDocumentsInput,
  ListRecentDocumentsInput,
  ListWorkspaceFoldersInput,
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
import {
  type BatchResponse,
  escapeLikePattern,
  POSTGREST_BATCH_SIZE,
  readAllInBatches,
} from "@/services/postgrest-paging"
import { retrySerializationFailure } from "@/services/serialization-retry"
import type {
  AccessibleDocumentFolder,
  AccessibleDocumentSummary,
  DocumentDetail,
  DocumentFolder,
  DocumentLifecycleState,
  DocumentRow,
  DocumentVersion,
  DocumentVersionRow,
  FolderRow,
} from "@/types/document"

/**
 * Most folders one lifecycle view lists, or documents one Files view draws.
 * More is refused rather than cut short, so a missing file never passes for a
 * deleted one.
 */
const MAX_WORKSPACE_ROWS = 10_000

const DOCUMENT_COLUMNS =
  "id,org_id,folder_id,title,description,current_version_id,source_kind,template_id,template_revision,lifecycle_state,created_by,updated_by,archived_by,archived_at,trashed_by,trashed_at,purge_after,pre_trash_lifecycle_state,trash_operation_id,created_at,updated_at"

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

      // The insert takes the folder tree's lock without waiting, so a
      // colleague's write at the same instant asks for a retry.
      const { data, error } = await retrySerializationFailure(() =>
        client
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
      )

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
 * Lists the folders of one lifecycle view the member may see.
 *
 * A folder whose parent is hidden from them is listed at the top of Files, so
 * the view never strands it out of reach.
 *
 * @param input - Actor, organization, and which lifecycle view.
 * @param deps - Optional service dependencies for tests.
 * @returns The visible folders, by name.
 * @throws DocumentServiceError when the actor lacks access or reads fail.
 */
export async function listWorkspaceFolders(
  input: ListWorkspaceFoldersInput,
  deps: DocumentServiceDeps = {}
): Promise<AccessibleDocumentFolder[]> {
  return runDocumentOperation(
    "list_workspace_folders",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      lifecycleState: input.lifecycleState ?? "active",
    },
    async (): Promise<AccessibleDocumentFolder[]> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:view",
        "You cannot view documents."
      )

      const folderRows = await readWorkspaceRows<FolderRow>(client, {
        columns:
          "id,org_id,parent_folder_id,name,lifecycle_state,created_by,updated_by,archived_by,archived_at,trashed_by,trashed_at,purge_after,pre_trash_lifecycle_state,trash_operation_id,created_at,updated_at",
        lifecycleStates: getLifecycleStates(input.lifecycleState),
        organizationId: input.organizationId,
        table: "folders",
      })
      const folderAccess = await getEffectiveFolderAccessLevels(
        {
          actorUserId: input.actorUserId,
          ids: folderRows.map((row: FolderRow): string => row.id),
          organizationId: input.organizationId,
        },
        client
      )
      const visibleFolders = folderRows
        .flatMap((row: FolderRow): AccessibleDocumentFolder[] => {
          const accessLevel = folderAccess.get(row.id)

          return accessLevel ? [{ ...mapFolder(row), accessLevel }] : []
        })
        .sort(
          (
            first: AccessibleDocumentFolder,
            second: AccessibleDocumentFolder
          ): number => first.name.localeCompare(second.name)
        )
      const visibleFolderIds = new Set(
        visibleFolders.map(
          (folder: AccessibleDocumentFolder): string => folder.id
        )
      )

      return visibleFolders.map(
        (folder: AccessibleDocumentFolder): AccessibleDocumentFolder =>
          folder.parentFolderId && !visibleFolderIds.has(folder.parentFolderId)
            ? { ...folder, parentFolderId: null }
            : folder
      )
    }
  )
}

/** One document the database answered with, and what the member may do. */
type ScopedDocumentRow = {
  access_level: unknown
  document: DocumentRow
}

/**
 * Lists the documents filed in the folders a Files view draws, newest first.
 *
 * The database applies the member's access while it reads, so neither a
 * document they may not open nor a folder they are not looking at is ever
 * carried back. A document whose folder they cannot see is listed at the top
 * of Files rather than disclosing where it is filed. A search looks through
 * the whole lifecycle view instead of those folders.
 *
 * @param input - Actor, organization, lifecycle view, the folders drawn, and
 *   what is being searched for.
 * @param deps - Optional service dependencies for tests.
 * @returns Those folders' documents, newest first, each with its access.
 * @throws DocumentServiceError when the actor lacks access or reads fail.
 */
export async function listFolderDocuments(
  input: ListFolderDocumentsInput,
  deps: DocumentServiceDeps = {}
): Promise<AccessibleDocumentSummary[]> {
  return runDocumentOperation(
    "list_folder_documents",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      lifecycleState: input.lifecycleState ?? "active",
      folderCount: input.folderIds.length,
      includeRoot: input.includeRoot,
      searching: Boolean(input.query),
    },
    async (): Promise<AccessibleDocumentSummary[]> => {
      const query = input.query?.trim()
        ? `%${escapeLikePattern(input.query.trim())}%`
        : null

      if (query === null && input.folderIds.length === 0 && !input.includeRoot) {
        return []
      }

      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:view",
        "You cannot view documents."
      )

      const rows = await readAllInBatches<ScopedDocumentRow>(
        async (
          previous: ScopedDocumentRow | undefined
        ): Promise<BatchResponse<ScopedDocumentRow>> => {
          const { data, error } = await client.rpc("list_workspace_documents", {
            after_document_id: previous?.document.id ?? null,
            row_limit: POSTGREST_BATCH_SIZE,
            target_actor_user_id: input.actorUserId,
            target_folder_ids: [...input.folderIds],
            target_include_root: input.includeRoot,
            target_lifecycle_states: [
              ...getLifecycleStates(input.lifecycleState),
            ],
            target_org_id: input.organizationId,
            target_query: query,
            // Only the top of Files takes in what sits elsewhere.
            target_visible_folder_ids: input.includeRoot
              ? [...input.visibleFolderIds]
              : [],
          })

          return {
            data: data as unknown as ScopedDocumentRow[] | null,
            error,
          }
        },
        {
          fail: (error: unknown): Error =>
            createSupabaseServiceError(error, "Unable to load documents."),
          maxRows: MAX_WORKSPACE_ROWS,
          tooMany: (): Error =>
            new DocumentServiceError(
              query === null
                ? "This folder holds more documents than can be listed at once."
                : "Too many files match this search. Narrow it down.",
              413
            ),
        }
      )
      const visibleFolderIds = new Set(input.visibleFolderIds)

      return rows
        .flatMap((row: ScopedDocumentRow): AccessibleDocumentSummary[] => {
          const accessLevel = parseAccessLevel(row.access_level, "document")

          if (!accessLevel) {
            return []
          }

          const document: AccessibleDocumentSummary = {
            ...mapDocument(row.document),
            accessLevel,
          }

          // A direct document grant must not disclose an inaccessible parent
          // folder or strand the document outside the visible workspace.
          return [
            document.folderId && !visibleFolderIds.has(document.folderId)
              ? { ...document, folderId: null }
              : document,
          ]
        })
        // Newest first, as the workspace has always answered.
        .sort(
          (
            first: AccessibleDocumentSummary,
            second: AccessibleDocumentSummary
          ): number => second.createdAt.localeCompare(first.createdAt)
        )
    }
  )
}

function getLifecycleStates(
  lifecycleState: ListWorkspaceFoldersInput["lifecycleState"]
): readonly DocumentLifecycleState[] {
  return lifecycleState === "trashed"
    ? (["trashed", "purge_pending"] as const)
    : [lifecycleState ?? "active"]
}

/**
 * Lists the active documents a member may open, most recently changed first,
 * without reading the whole workspace.
 *
 * @param input - Actor, organization, how many, and optionally only the
 *   generated documents one member created.
 * @param deps - Optional service dependencies for tests.
 * @returns Up to `limit` documents, each with the member's access. Where a
 *   document is filed is left out, since its folder may be hidden from them.
 * @throws DocumentServiceError when the actor lacks access or reads fail.
 */
export async function listRecentDocuments(
  input: ListRecentDocumentsInput,
  deps: DocumentServiceDeps = {}
): Promise<AccessibleDocumentSummary[]> {
  return runDocumentOperation(
    "list_recent_documents",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      limit: input.limit,
    },
    async (): Promise<AccessibleDocumentSummary[]> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:view",
        "You cannot view documents."
      )

      let query = client
        .from("documents")
        .select(DOCUMENT_COLUMNS)
        .eq("org_id", input.organizationId)
        .eq("lifecycle_state", "active")

      if (input.generatedBy) {
        query = query.eq("created_by", input.generatedBy).eq("source_kind", "generated")
      }

      // ponytail: reads three times the limit and keeps what the member may
      // open, so someone shut out of most new documents sees fewer; page on
      // when that matters.
      const { data, error } = await query
        .order("updated_at", { ascending: false })
        .limit(input.limit * 3)

      if (error) {
        throw createSupabaseServiceError(error, "Unable to load documents.")
      }

      const rows = (data ?? []) as unknown as DocumentRow[]
      const access = await getEffectiveDocumentAccessLevels(
        {
          actorUserId: input.actorUserId,
          ids: rows.map((row: DocumentRow): string => row.id),
          organizationId: input.organizationId,
        },
        client
      )

      return rows
        .flatMap((row: DocumentRow): AccessibleDocumentSummary[] => {
          const accessLevel = access.get(row.id)

          return accessLevel ? [{ ...mapDocument(row), accessLevel, folderId: null }] : []
        })
        .slice(0, input.limit)
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

/**
 * Reads every folder in some lifecycle states, one keyset batch after another,
 * so a deployment's response cap never cuts the list short.
 *
 * @param client - Injected Supabase service client.
 * @param source - The table, its columns, the organization, and the states.
 * @returns Every matching row.
 * @throws DocumentServiceError when a read fails or the view is too large.
 */
async function readWorkspaceRows<TRow extends { id: string }>(
  client: DocumentServiceClient,
  source: {
    columns: string
    lifecycleStates: readonly DocumentLifecycleState[]
    organizationId: string
    table: "folders"
  }
): Promise<TRow[]> {
  return readAllInBatches(
    async (previous: TRow | undefined): Promise<BatchResponse<TRow>> => {
      let query = client
        .from(source.table)
        .select(source.columns)
        .eq("org_id", source.organizationId)
        .in("lifecycle_state", [...source.lifecycleStates])

      if (previous !== undefined) {
        query = query.gt("id", previous.id)
      }

      const { data, error } = await query
        .order("id", { ascending: true })
        .limit(POSTGREST_BATCH_SIZE)

      return { data: data as unknown as TRow[] | null, error }
    },
    {
      fail: (error: unknown): Error =>
        createSupabaseServiceError(error, `Unable to load ${source.table}.`),
      maxRows: MAX_WORKSPACE_ROWS,
      tooMany: (): Error =>
        new DocumentServiceError(
          `This view holds more ${source.table} than can be listed at once.`,
          413
        ),
    }
  )
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
