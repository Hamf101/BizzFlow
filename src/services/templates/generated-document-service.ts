import {
  GENERATED_DOCUMENT_COLUMNS,
  type GeneratedDocumentRow
} from "@/services/generated-documents/generated-document-persistence"
import {
  createBlankTemplateContent,
  parseTemplateContent,
  type DocumentRecentAccessRow,
  type DocumentTemplate,
  type GeneratedDocument,
  type RecentDocument
} from "@/types/template"

import type {
  CreateGeneratedDocumentInput,
  ListRecentDocumentsInput,
  RecordDocumentRecentAccessInput,
  TemplateServiceDeps
} from "./contracts"
import { TemplateServiceError } from "./errors"
import {
  createDatabaseError,
  createId,
  getClient,
  getTemplateById,
  mapGeneratedDocument,
  normalizeDescription,
  normalizeNullableId,
  normalizeRecentLimit,
  normalizeTitle,
  nowIso,
  parseDocumentSourceKind,
  requireActiveFolder,
  requirePermission,
  requireTenantDocument,
  runTemplateOperation
} from "./shared"

type RecentDocumentRow = Record<string, unknown> & {
  id: string
  org_id: string
  folder_id: string | null
  title: string
  description: string | null
  source_kind: string
  archived_at: string | null
}

/**
 * Creates a generated document and an immutable content snapshot.
 *
 * A template-backed document always snapshots a published revision. A blank
 * document snapshots supplied valid content or a fresh empty free-form document.
 *
 * @param input - Actor, tenant, optional template/folder, and document metadata.
 * @param deps - Optional injected dependencies for tests.
 * @returns Created generated-document metadata and detached snapshot.
 * @throws TemplateServiceError when validation, permission, or persistence fails.
 */
export async function createGeneratedDocument(
  input: CreateGeneratedDocumentInput,
  deps: TemplateServiceDeps = {}
): Promise<GeneratedDocument> {
  return runTemplateOperation(
    "create_generated_document",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      folderId: input.folderId ?? null,
      templateId: input.templateId ?? null
    },
    async (): Promise<GeneratedDocument> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:create",
        "You cannot create documents."
      )
      const folderId = normalizeNullableId(input.folderId)

      if (folderId) {
        await requireActiveFolder(client, input.organizationId, folderId)
      }

      const templateId = normalizeNullableId(input.templateId)
      let template: DocumentTemplate | null = null

      if (templateId) {
        if (input.content !== undefined) {
          throw new TemplateServiceError(
            "Template-backed documents must use the published template content.",
            400
          )
        }

        await requirePermission(
          client,
          input.organizationId,
          input.actorUserId,
          "templates:view",
          "You cannot use document templates."
        )
        template = await getTemplateById(
          client,
          input.organizationId,
          templateId
        )

        if (template.status !== "published") {
          throw new TemplateServiceError(
            "Only published templates can create documents.",
            409
          )
        }
      }

      const snapshot = parseTemplateContent(
        template?.content ?? input.content ?? createBlankTemplateContent()
      )

      if (containsFileField(snapshot)) {
        throw new TemplateServiceError(
          "File upload fields are only supported in internal submissions.",
          409
        )
      }

      const documentId = createId(deps)
      const title = normalizeTitle(
        input.title ?? template?.title ?? "Untitled document"
      )
      const description = Object.prototype.hasOwnProperty.call(
        input,
        "description"
      )
        ? normalizeDescription(input.description)
        : (template?.description ?? null)
      const { data, error } = await client
        .from("documents")
        .insert({
          id: documentId,
          org_id: input.organizationId,
          folder_id: folderId,
          title,
          description,
          current_version_id: null,
          source_kind: "generated",
          template_id: template?.id ?? null,
          template_revision: template?.revision ?? null,
          template_snapshot: snapshot,
          created_by: input.actorUserId,
          updated_by: input.actorUserId,
          archived_by: null,
          archived_at: null
        })
        .select(GENERATED_DOCUMENT_COLUMNS)
        .single()

      if (error || !data) {
        throw createDatabaseError(error, "Unable to create generated document.")
      }

      const { error: answerError } = await client
        .from("document_answers")
        .insert({
          document_id: documentId,
          org_id: input.organizationId,
          values: {},
          workflow_status: "draft"
        })

      if (answerError) {
        const { error: cleanupError } = await client
          .from("documents")
          .delete()
          .eq("id", documentId)
          .eq("org_id", input.organizationId)

        if (cleanupError) {
          console.error("generated_document_cleanup_failed", {
            organizationId: input.organizationId,
            documentId,
            actorUserId: input.actorUserId
          })
        }

        throw createDatabaseError(
          answerError,
          "Unable to initialize generated document answers."
        )
      }

      return mapGeneratedDocument(data as GeneratedDocumentRow)
    }
  )
}

function containsFileField(
  content: ReturnType<typeof parseTemplateContent>
): boolean {
  return content.blocks.some((block): boolean => block.type === "file_field")
}

/**
 * Atomically records the current user's latest open time for a document.
 *
 * @param input - Actor, tenant, and document identifiers.
 * @param deps - Optional injected dependencies for tests.
 * @returns Persisted recent-access row.
 * @throws TemplateServiceError when access is denied or the document is absent.
 */
export async function recordDocumentRecentAccess(
  input: RecordDocumentRecentAccessInput,
  deps: TemplateServiceDeps = {}
): Promise<DocumentRecentAccessRow> {
  return runTemplateOperation(
    "record_document_recent_access",
    input,
    async (): Promise<DocumentRecentAccessRow> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:view",
        "You cannot view documents."
      )
      await requireTenantDocument(
        client,
        input.organizationId,
        input.documentId
      )

      const { data, error } = await client
        .from("document_recent_accesses")
        .upsert(
          {
            org_id: input.organizationId,
            user_id: input.actorUserId,
            document_id: input.documentId,
            last_opened_at: nowIso(deps)
          },
          { onConflict: "org_id,user_id,document_id" }
        )
        .select("org_id,user_id,document_id,last_opened_at")
        .single()

      if (error || !data) {
        throw createDatabaseError(
          error,
          "Unable to record recent document access."
        )
      }

      return data as DocumentRecentAccessRow
    }
  )
}

/**
 * Lists the current user's most recently opened active documents.
 *
 * @param input - Actor, tenant, and optional bounded result limit.
 * @param deps - Optional injected dependencies for tests.
 * @returns Recent documents in last-opened order.
 * @throws TemplateServiceError when permission or persistence fails.
 */
export async function listRecentDocuments(
  input: ListRecentDocumentsInput,
  deps: TemplateServiceDeps = {}
): Promise<RecentDocument[]> {
  return runTemplateOperation(
    "list_recent_documents",
    input,
    async (): Promise<RecentDocument[]> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "documents:view",
        "You cannot view documents."
      )
      const requestedLimit = normalizeRecentLimit(input.limit)
      const { data: recentData, error: recentError } = await client
        .from("document_recent_accesses")
        .select("org_id,user_id,document_id,last_opened_at")
        .eq("org_id", input.organizationId)
        .eq("user_id", input.actorUserId)
        .order("last_opened_at", { ascending: false })
        // Over-fetch so archived documents do not displace older active recents.
        .limit(Math.min(requestedLimit * 5, 100))

      if (recentError || !recentData) {
        throw createDatabaseError(
          recentError,
          "Unable to load recent documents."
        )
      }

      const accessRows = recentData as DocumentRecentAccessRow[]

      if (accessRows.length === 0) {
        return []
      }

      const { data: documentData, error: documentError } = await client
        .from("documents")
        .select("id,org_id,folder_id,title,description,source_kind,archived_at")
        .eq("org_id", input.organizationId)
        .in(
          "id",
          accessRows.map(
            (row: DocumentRecentAccessRow): string => row.document_id
          )
        )
        .is("archived_at", null)

      if (documentError || !documentData) {
        throw createDatabaseError(
          documentError,
          "Unable to load recent documents."
        )
      }

      const documentById = new Map<string, RecentDocumentRow>(
        (documentData as RecentDocumentRow[]).map(
          (row: RecentDocumentRow): [string, RecentDocumentRow] => [row.id, row]
        )
      )

      return accessRows
        .flatMap((access: DocumentRecentAccessRow): RecentDocument[] => {
          const document = documentById.get(access.document_id)

          if (!document) {
            return []
          }

          return [
            {
              organizationId: access.org_id,
              userId: access.user_id,
              documentId: access.document_id,
              lastOpenedAt: access.last_opened_at,
              title: document.title,
              description: document.description,
              folderId: document.folder_id,
              sourceKind: parseDocumentSourceKind(document.source_kind)
            }
          ]
        })
        .slice(0, requestedLimit)
    }
  )
}
