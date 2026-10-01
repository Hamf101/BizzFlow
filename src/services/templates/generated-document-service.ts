import {
  GENERATED_DOCUMENT_COLUMNS,
  type GeneratedDocumentRow
} from "@/services/generated-documents/generated-document-persistence"
import {
  requireDocumentAccess,
  requireFolderAccess,
} from "@/services/documents/access-service"
import { DocumentServiceError } from "@/services/documents/errors"
import { retrySerializationFailure } from "@/services/serialization-retry"
import {
  createBlankTemplateContent,
  parseTemplateContent,
  type DocumentRecentAccessRow,
  type DocumentTemplate,
  type GeneratedDocument
} from "@/types/template"

import type {
  CreateGeneratedDocumentInput,
  RecordDocumentRecentAccessInput,
  TemplateServiceClient,
  TemplateServiceDeps
} from "./contracts"
import { requireTemplateAccess } from "./access"
import { TemplateServiceError } from "./errors"
import {
  createDatabaseError,
  createId,
  getClient,
  getPublishedTemplateById,
  getTemplateById,
  mapGeneratedDocument,
  normalizeDescription,
  normalizeNullableId,
  normalizeTitle,
  nowIso,
  requireActiveFolder,
  requirePermission,
  requireTenantDocument,
  runTemplateOperation
} from "./shared"
import { withoutImageUrls } from "@/types/template-images"

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
        await requireTemplateFolderContributor(
          client,
          input.organizationId,
          folderId,
          input.actorUserId
        )
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

        await requireTemplateAccess(
          client,
          { actorUserId: input.actorUserId, organizationId: input.organizationId, templateId },
          "user",
          "You cannot use document templates."
        )
        const { status } = await getTemplateById(client, input.organizationId, templateId)

        if (status !== "published") {
          throw new TemplateServiceError(
            "Only published templates can create documents.",
            409
          )
        }

        // What was published, not the working copy an author may be changing.
        template = await getPublishedTemplateById(client, input.organizationId, templateId)
      }

      const snapshot = withoutImageUrls(
        parseTemplateContent(template?.content ?? input.content ?? createBlankTemplateContent())
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
      // The insert takes the folder tree's lock without waiting, so a
      // colleague's write at the same instant asks for a retry.
      const { data, error } = await retrySerializationFailure(() =>
        client
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
      )

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
      await requireTemplateDocumentAccess(
        client,
        {
          actorUserId: input.actorUserId,
          organizationId: input.organizationId,
          documentId: input.documentId,
          requiredAccess: "viewer",
          operation: "read",
        }
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

async function requireTemplateFolderContributor(
  client: TemplateServiceClient,
  organizationId: string,
  folderId: string,
  actorUserId: string
): Promise<void> {
  try {
    await requireFolderAccess(
      {
        actorUserId,
        organizationId,
        folderId,
        requiredAccess: "contributor",
        operation: "mutation",
      },
      client
    )
  } catch (error: unknown) {
    throw translateDocumentAccessError(error)
  }
}

async function requireTemplateDocumentAccess(
  client: TemplateServiceClient,
  input: Parameters<typeof requireDocumentAccess>[0]
): Promise<void> {
  try {
    await requireDocumentAccess(input, client)
  } catch (error: unknown) {
    throw translateDocumentAccessError(error)
  }
}

function translateDocumentAccessError(error: unknown): Error {
  if (error instanceof DocumentServiceError) {
    return new TemplateServiceError(error.message, error.statusCode)
  }

  return error instanceof Error
    ? error
    : new TemplateServiceError("Unable to verify document access.", 500)
}
