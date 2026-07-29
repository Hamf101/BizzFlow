import { canPerformOrganizationAction } from "@/lib/permissions"
import {
  createBlankTemplateContent,
  parseTemplateContent,
  upgradeV2TemplateContentToV3,
  type DocumentTemplate,
  type DocumentTemplateRow,
  type TemplateContent,
} from "@/types/template"

import type {
  ChangeDocumentTemplateStatusInput,
  CreateDocumentTemplateInput,
  GetDocumentTemplateInput,
  ListDocumentTemplatesInput,
  PublishDocumentTemplateInput,
  TemplateServiceDeps,
  UpdateDocumentTemplateInput,
} from "./contracts"
import { TemplateServiceError } from "./errors"
import { evaluateTemplateQuality } from "./template-quality-service"
import {
  assertRevision,
  createDatabaseError,
  createId,
  getClient,
  getTemplateById,
  mapDocumentTemplate,
  normalizeDescription,
  normalizeTitle,
  nowIso,
  requirePermission,
  runTemplateOperation,
  TEMPLATE_COLUMNS,
} from "./shared"

/**
 * Lists templates visible to an active organization member.
 *
 * Managers and owners receive every status; staff receive published templates only.
 *
 * @param input - Actor and organization identifiers.
 * @param deps - Optional injected dependencies for tests.
 * @returns Visible templates ordered by most recently updated.
 * @throws TemplateServiceError when permission or database access fails.
 */
export async function listDocumentTemplates(
  input: ListDocumentTemplatesInput,
  deps: TemplateServiceDeps = {}
): Promise<DocumentTemplate[]> {
  return runTemplateOperation(
    "list_document_templates",
    input,
    async (): Promise<DocumentTemplate[]> => {
      const client = getClient(deps)
      const role = await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "templates:view",
        "You cannot view document templates."
      )
      let query = client
        .from("document_templates")
        .select(TEMPLATE_COLUMNS)
        .eq("org_id", input.organizationId)

      if (!canPerformOrganizationAction(role, "templates:manage")) {
        query = query.eq("status", "published")
      }

      const { data, error } = await query.order("updated_at", {
        ascending: false,
      })

      if (error || !data) {
        throw createDatabaseError(error, "Unable to load document templates.")
      }

      return (data as DocumentTemplateRow[]).map(mapDocumentTemplate)
    }
  )
}

/**
 * Loads one tenant-scoped template visible to the actor.
 *
 * @param input - Actor, organization, and template identifiers.
 * @param deps - Optional injected dependencies for tests.
 * @returns The requested template.
 * @throws TemplateServiceError when access is denied or the template is absent.
 */
export async function getDocumentTemplate(
  input: GetDocumentTemplateInput,
  deps: TemplateServiceDeps = {}
): Promise<DocumentTemplate> {
  return runTemplateOperation(
    "get_document_template",
    input,
    async (): Promise<DocumentTemplate> => {
      const client = getClient(deps)
      const role = await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "templates:view",
        "You cannot view document templates."
      )
      const template = await getTemplateById(
        client,
        input.organizationId,
        input.templateId
      )

      if (
        template.status !== "published" &&
        !canPerformOrganizationAction(role, "templates:manage")
      ) {
        throw new TemplateServiceError("Document template was not found.", 404)
      }

      return template
    }
  )
}

/**
 * Creates a draft organization template at revision one.
 *
 * @param input - Actor, organization, metadata, and optional initial content.
 * @param deps - Optional injected dependencies for tests.
 * @returns Created draft template.
 * @throws TemplateServiceError when validation, permission, or persistence fails.
 */
export async function createDocumentTemplate(
  input: CreateDocumentTemplateInput,
  deps: TemplateServiceDeps = {}
): Promise<DocumentTemplate> {
  return runTemplateOperation(
    "create_document_template",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
    },
    async (): Promise<DocumentTemplate> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "templates:manage",
        "You cannot manage document templates."
      )

      const { data, error } = await client
        .from("document_templates")
        .insert({
          id: createId(deps),
          org_id: input.organizationId,
          title: normalizeTitle(input.title),
          description: normalizeDescription(input.description),
          status: "draft",
          revision: 1,
          content: upgradeV2TemplateContentToV3(
            parseTemplateContent(
              input.content ?? createBlankTemplateContent()
            )
          ),
          created_by: input.actorUserId,
          updated_by: input.actorUserId,
          published_by: null,
          archived_by: null,
          published_at: null,
          archived_at: null,
        })
        .select(TEMPLATE_COLUMNS)
        .single()

      if (error || !data) {
        throw createDatabaseError(error, "Unable to create document template.")
      }

      return mapDocumentTemplate(data as DocumentTemplateRow)
    }
  )
}

/**
 * Updates editable template fields using optimistic revision matching.
 *
 * @param input - Actor, template, expected revision, and fields to update.
 * @param deps - Optional injected dependencies for tests.
 * @returns Updated template with its revision incremented exactly once.
 * @throws TemplateServiceError for invalid content, archived templates, or conflicts.
 */
export async function updateDocumentTemplate(
  input: UpdateDocumentTemplateInput,
  deps: TemplateServiceDeps = {}
): Promise<DocumentTemplate> {
  return runTemplateOperation(
    "update_document_template",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      templateId: input.templateId,
      expectedRevision: input.expectedRevision,
    },
    async (): Promise<DocumentTemplate> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "templates:manage",
        "You cannot manage document templates."
      )
      assertRevision(input.expectedRevision)

      const existing = await getTemplateById(
        client,
        input.organizationId,
        input.templateId
      )

      if (existing.status === "archived") {
        throw new TemplateServiceError("Archived templates cannot be edited.", 409)
      }

      if (existing.revision !== input.expectedRevision) {
        throw new TemplateServiceError(
          "Document template changed since it was opened.",
          409
        )
      }

      const hasTitle = input.title !== undefined
      const hasDescription = Object.prototype.hasOwnProperty.call(
        input,
        "description"
      )
      const hasContent = input.content !== undefined

      if (!hasTitle && !hasDescription && !hasContent) {
        throw new TemplateServiceError("No template changes were provided.", 400)
      }

      const nextTitle = hasTitle
        ? normalizeTitle(input.title as string)
        : existing.title
      const nextDescription = hasDescription
        ? normalizeDescription(input.description)
        : existing.description
      const parsedExistingContent = parseTemplateContent(existing.content)
      const proposedContent = hasContent
        ? parseTemplateContent(input.content)
        : parsedExistingContent

      if (
        nextTitle === existing.title &&
        nextDescription === existing.description &&
        JSON.stringify(proposedContent) === JSON.stringify(parsedExistingContent)
      ) {
        throw new TemplateServiceError("No template changes were provided.", 400)
      }

      const nextContent = upgradeV2TemplateContentToV3(proposedContent)

      const { data, error } = await client
        .from("document_templates")
        .update({
          title: nextTitle,
          description: nextDescription,
          content: nextContent,
          revision: existing.revision + 1,
          updated_by: input.actorUserId,
        })
        .eq("id", input.templateId)
        .eq("org_id", input.organizationId)
        .eq("revision", input.expectedRevision)
        .eq("status", existing.status)
        .select(TEMPLATE_COLUMNS)
        .maybeSingle()

      if (error) {
        throw createDatabaseError(error, "Unable to update document template.")
      }

      if (!data) {
        throw new TemplateServiceError(
          "Document template changed since it was opened.",
          409
        )
      }

      return mapDocumentTemplate(data as DocumentTemplateRow)
    }
  )
}

/**
 * Publishes a schema-valid template for use by organization staff.
 *
 * @param input - Actor, organization, template, and exact saved revision.
 * @param deps - Optional injected dependencies for tests.
 * @returns Published template; an already-published template is returned unchanged.
 * @throws TemplateServiceError when permission, validation, revision matching, or persistence fails.
 */
export async function publishDocumentTemplate(
  input: PublishDocumentTemplateInput,
  deps: TemplateServiceDeps = {}
): Promise<DocumentTemplate> {
  return runTemplateOperation(
    "publish_document_template",
    input,
    async (): Promise<DocumentTemplate> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "templates:manage",
        "You cannot manage document templates."
      )
      assertRevision(input.expectedRevision)

      const existing = await getTemplateById(
        client,
        input.organizationId,
        input.templateId
      )

      if (existing.revision !== input.expectedRevision) {
        throw new TemplateServiceError(
          "Document template changed before it could be published.",
          409
        )
      }

      if (existing.status === "archived") {
        throw new TemplateServiceError(
          "Archived templates cannot be published.",
          409
        )
      }

      const content = parseTemplateContent(existing.content)
      assertTemplatePublishReady(
        existing.title,
        existing.description,
        content
      )

      if (existing.status === "published") {
        return existing
      }

      const { data, error } = await client
        .from("document_templates")
        .update({
          status: "published",
          published_by: input.actorUserId,
          published_at: nowIso(deps),
          updated_by: input.actorUserId,
        })
        .eq("id", input.templateId)
        .eq("org_id", input.organizationId)
        .eq("revision", input.expectedRevision)
        .eq("status", existing.status)
        .select(TEMPLATE_COLUMNS)
        .maybeSingle()

      if (error) {
        throw createDatabaseError(error, "Unable to publish document template.")
      }

      if (!data) {
        throw new TemplateServiceError(
          "Document template changed before it could be published.",
          409
        )
      }

      return mapDocumentTemplate(data as DocumentTemplateRow)
    }
  )
}

function assertTemplatePublishReady(
  title: string,
  description: string | null,
  content: TemplateContent
): void {
  const evaluation = evaluateTemplateQuality({
    title,
    description,
    content
  })
  const firstBlockingIssue = evaluation.issues.find(
    (issue): boolean => issue.severity === "critical"
  )

  if (firstBlockingIssue) {
    throw new TemplateServiceError(firstBlockingIssue.message, 400)
  }
}

/**
 * Archives a template so it is no longer selectable for new documents.
 *
 * @param input - Actor, organization, and template identifiers.
 * @param deps - Optional injected dependencies for tests.
 * @returns Archived template; an already-archived template is returned unchanged.
 * @throws TemplateServiceError when permission or persistence fails.
 */
export async function archiveDocumentTemplate(
  input: ChangeDocumentTemplateStatusInput,
  deps: TemplateServiceDeps = {}
): Promise<DocumentTemplate> {
  return runTemplateOperation(
    "archive_document_template",
    input,
    async (): Promise<DocumentTemplate> => {
      const client = getClient(deps)

      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "templates:manage",
        "You cannot manage document templates."
      )
      const existing = await getTemplateById(
        client,
        input.organizationId,
        input.templateId
      )

      if (existing.status === "archived") {
        return existing
      }

      const { data, error } = await client
        .from("document_templates")
        .update({
          status: "archived",
          archived_by: input.actorUserId,
          archived_at: nowIso(deps),
          updated_by: input.actorUserId,
        })
        .eq("id", input.templateId)
        .eq("org_id", input.organizationId)
        .eq("revision", existing.revision)
        .eq("status", existing.status)
        .select(TEMPLATE_COLUMNS)
        .maybeSingle()

      if (error) {
        throw createDatabaseError(error, "Unable to archive document template.")
      }

      if (!data) {
        throw new TemplateServiceError(
          "Document template changed before it could be archived.",
          409
        )
      }

      return mapDocumentTemplate(data as DocumentTemplateRow)
    }
  )
}
