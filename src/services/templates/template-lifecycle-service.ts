import {
  createBlankTemplateContent,
  DOCUMENT_TEMPLATE_STATUSES,
  parseTemplateContent,
  upgradeV2TemplateContentToV3,
  type DocumentTemplate,
  type DocumentTemplateRow,
  type DocumentTemplateStatus,
  type DocumentTemplateVersion,
  type DocumentTemplateVersionRow,
  type TemplateContent,
} from "@/types/template"

import type {
  ChangeDocumentTemplateStatusInput,
  CreateDocumentTemplateInput,
  GetDocumentTemplateInput,
  ListDocumentTemplatesInput,
  PublishDocumentTemplateInput,
  PurgeTrashedDocumentTemplateInput,
  TemplateActorInput,
  TemplateServiceClient,
  TemplateServiceDeps,
  UpdateDocumentTemplateInput,
  DuplicateDocumentTemplateInput,
  SetDocumentTemplateCategoryInput,
} from "./contracts"
import { getTemplateAccess, onlyVisibleTemplates, requireCanCreateTemplates, requireTemplateAccess, templateVisibility } from "./access"
import { TemplateServiceError } from "./errors"
import { evaluateTemplateQuality } from "./template-quality-service"
import {
  assertRevision,
  createDatabaseError,
  createId,
  getClient,
  getPublishedTemplateById,
  getTemplateById,
  mapDocumentTemplate,
  normalizeCategory,
  normalizeDescription,
  normalizeTitle,
  nowIso,
  requirePermission,
  requireUsableImages,
  runTemplateOperation,
  TEMPLATE_COLUMNS,
  TEMPLATE_TABLE_COLUMNS,
} from "./shared"
import { withoutImageUrls } from "@/types/template-images"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { recordAuditLogBestEffort } from "@/services/audit-service"
import { asSupabaseError } from "@/services/supabase-error"
import type { AuditMetadata } from "@/types/audit"
import { TEMPLATE_ANSWERED_MESSAGE } from "@/types/template-trash"

/**
 * Lists the templates a member can start from: each published template as it
 * was last published, whatever its working copy holds now.
 *
 * An `input.category` of `null` selects the uncategorised templates; omitting the
 * key entirely returns every category.
 *
 * @param input - Actor, organization, and optional category filter.
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
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      category: input.category,
    },
    async (): Promise<DocumentTemplate[]> => {
      const client = getClient(deps)
      await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "templates:view",
        "You cannot view document templates."
      )
      // The published view holds no drafts, so only restricted templates need leaving out.
      let query = onlyVisibleTemplates(
        client
          .from("published_document_templates")
          .select(TEMPLATE_COLUMNS)
          .eq("org_id", input.organizationId),
        await templateVisibility(client, input.organizationId, input.actorUserId),
        true
      )

      // hasOwnProperty, not a truthiness test: `null` is the meaningful
      // "uncategorised only" filter and would otherwise read as "no filter".
      if (Object.prototype.hasOwnProperty.call(input, "category")) {
        const category = normalizeCategory(input.category)
        query =
          category === null
            ? query.is("category", null)
            : query.eq("category", category)
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
 * Lists the distinct categories in use across the actor's visible templates.
 *
 * Drives the filter control, which needs every available option even while a
 * filter is applied — so this deliberately does not take one.
 *
 * @param input - Actor and organization identifiers.
 * @param deps - Optional injected dependencies for tests.
 * @returns Distinct categories, alphabetically ordered, excluding uncategorised.
 * @throws TemplateServiceError when permission or database access fails.
 */
export async function listDocumentTemplateCategories(
  input: TemplateActorInput,
  deps: TemplateServiceDeps = {}
): Promise<string[]> {
  return runTemplateOperation(
    "list_document_template_categories",
    input,
    async (): Promise<string[]> => {
      const client = getClient(deps)
      const subject = await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "templates:view",
        "You cannot view document templates."
      )
      // Restricted templates they cannot open, drafts only editors see, and Trash are left out.
      const { data, error } = await onlyVisibleTemplates(
        client
          .from("document_templates")
          .select("category")
          .eq("org_id", input.organizationId)
          .is("trashed_at", null),
        await templateVisibility(client, input.organizationId, input.actorUserId),
        canPerformOrganizationAction(subject, "templates:manage")
      )

      if (error || !data) {
        throw createDatabaseError(
          error,
          "Unable to load document template categories."
        )
      }

      const categories = new Set<string>()

      for (const row of data as { category: string | null }[]) {
        if (typeof row.category === "string" && row.category.length > 0) {
          categories.add(row.category)
        }
      }

      return Array.from(categories).sort((left: string, right: string): number =>
        left.localeCompare(right)
      )
    }
  )
}

/**
 * Loads one tenant-scoped template visible to the actor: an author gets its
 * working copy, anyone else the version last published.
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
      const level = await requireTemplateAccess(client, input, "viewer", "You cannot view document templates.")

      // Editors get the working copy; everyone else the version last published.
      return level === "editor"
        ? getTemplateById(client, input.organizationId, input.templateId)
        : getPublishedTemplateById(client, input.organizationId, input.templateId)
    }
  )
}

/**
 * Whether a member may edit one template: the person who made it, an editor it
 * was shared with, a manager of templates, or an owner admin.
 *
 * @param input - Actor, organization, and template identifiers.
 * @param deps - Optional injected dependencies for tests.
 * @returns True only for an editor; false for everyone else, including someone who cannot open it.
 * @throws TemplateServiceError when the lookup itself fails.
 */
export async function canEditDocumentTemplate(
  input: GetDocumentTemplateInput,
  deps: TemplateServiceDeps = {}
): Promise<boolean> {
  return (await getTemplateAccess(getClient(deps), input)) === "editor"
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

      await requireCanCreateTemplates(client, input.organizationId, input.actorUserId)

      // Signed picture addresses expire; only the pictures themselves are kept.
      const content = withoutImageUrls(
        upgradeV2TemplateContentToV3(parseTemplateContent(input.content ?? createBlankTemplateContent()))
      )

      await requireUsableImages(content, null, input.organizationId)

      const { data, error } = await client
        .from("document_templates")
        .insert({
          id: createId(deps),
          org_id: input.organizationId,
          title: normalizeTitle(input.title),
          description: normalizeDescription(input.description),
          category: normalizeCategory(input.category),
          status: "draft",
          revision: 1,
          content,
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

      await requireTemplateAccess(client, input, "editor", "You cannot manage document templates.")
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
      const hasCategory = Object.prototype.hasOwnProperty.call(
        input,
        "category"
      )
      const hasContent = input.content !== undefined

      if (!hasTitle && !hasDescription && !hasCategory && !hasContent) {
        throw new TemplateServiceError("No template changes were provided.", 400)
      }

      const nextTitle = hasTitle
        ? normalizeTitle(input.title as string)
        : existing.title
      const nextDescription = hasDescription
        ? normalizeDescription(input.description)
        : existing.description
      const nextCategory = hasCategory
        ? normalizeCategory(input.category)
        : existing.category
      const parsedExistingContent = parseTemplateContent(existing.content)
      const proposedContent = hasContent
        ? parseTemplateContent(input.content)
        : parsedExistingContent

      if (
        nextTitle === existing.title &&
        nextDescription === existing.description &&
        nextCategory === existing.category &&
        JSON.stringify(proposedContent) === JSON.stringify(parsedExistingContent)
      ) {
        throw new TemplateServiceError("No template changes were provided.", 400)
      }

      // A published template's edits wait in its working copy until the next
      // publish, which is where the checks apply.
      const nextContent = withoutImageUrls(upgradeV2TemplateContentToV3(proposedContent))

      if (hasContent) {
        await requireUsableImages(nextContent, parsedExistingContent, input.organizationId)
      }

      const { data, error } = await client
        .from("document_templates")
        .update({
          title: nextTitle,
          description: nextDescription,
          category: nextCategory,
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
 * Publishes a template's working copy for use by organization staff. The
 * database keeps each version published and never changes one, so Update on a
 * published template adds a version rather than rewriting the last.
 *
 * @param input - Actor, organization, template, and exact saved revision.
 * @param deps - Optional injected dependencies for tests.
 * @returns Published template; one already published at this revision is returned unchanged.
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

      await requireTemplateAccess(client, input, "editor", "You cannot manage document templates.")
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

      if (existing.status === "published" && existing.publishedRevision === existing.revision) {
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
 * Lists the versions a template was published at, newest first.
 *
 * @param input - Actor, organization, and template identifiers.
 * @param deps - Optional injected dependencies for tests.
 * @returns Each published version's revision and time; none for another organization's template.
 * @throws TemplateServiceError when permission or database access fails.
 */
export async function listDocumentTemplateVersions(
  input: GetDocumentTemplateInput,
  deps: TemplateServiceDeps = {}
): Promise<DocumentTemplateVersion[]> {
  return runTemplateOperation(
    "list_document_template_versions",
    input,
    async (): Promise<DocumentTemplateVersion[]> => {
      const client = getClient(deps)

      // A template that is not here has no versions, as for another workspace's.
      const held = await requireTemplateAccess(client, input, "editor", "You cannot manage document templates.").catch(
        (error: unknown) => {
          if (error instanceof TemplateServiceError && error.statusCode === 404) return null

          throw error
        }
      )

      if (!held) return []

      const { data, error } = await client
        .from("document_template_versions")
        .select("revision,published_at")
        .eq("org_id", input.organizationId)
        .eq("template_id", input.templateId)
        .order("revision", { ascending: false })

      if (error || !data) {
        throw createDatabaseError(error, "Unable to load template versions.")
      }

      return (data as Pick<DocumentTemplateVersionRow, "published_at" | "revision">[]).map((row) => ({
        publishedAt: row.published_at,
        revision: row.revision,
      }))
    }
  )
}

/**
 * Loads what one published version held, for an author to bring back into the
 * working copy. The version itself stays as it was.
 *
 * @param input - Actor, organization, template, and the version's revision.
 * @param deps - Optional injected dependencies for tests.
 * @returns The version's title, description, and content.
 * @throws TemplateServiceError 404 when the template has no such version in this organization.
 */
export async function getDocumentTemplateVersion(
  input: GetDocumentTemplateInput & { revision: number },
  deps: TemplateServiceDeps = {}
): Promise<Pick<DocumentTemplate, "content" | "description" | "title">> {
  return runTemplateOperation(
    "get_document_template_version",
    input,
    async (): Promise<Pick<DocumentTemplate, "content" | "description" | "title">> => {
      const client = getClient(deps)

      await requireTemplateAccess(client, input, "editor", "You cannot manage document templates.")
      assertRevision(input.revision)

      const { data, error } = await client
        .from("document_template_versions")
        .select("title,description,content")
        .eq("org_id", input.organizationId)
        .eq("template_id", input.templateId)
        .eq("revision", input.revision)
        .maybeSingle()

      if (error) {
        throw createDatabaseError(error, "Unable to load the template version.")
      }

      if (!data) {
        throw new TemplateServiceError("That version was not found.", 404)
      }

      const version = data as Pick<DocumentTemplateVersionRow, "content" | "description" | "title">

      return { content: parseTemplateContent(version.content), description: version.description, title: version.title }
    }
  )
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

      await requireTemplateAccess(client, input, "editor", "You cannot manage document templates.")
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

/**
 * Brings an archived template back: published if it was ever published, else a
 * draft. Nothing else about it changes, so Undo of an archive is exact. A
 * template in Trash goes back to exactly the status it had before, archived
 * included.
 *
 * @param input - Actor, organization, and template identifiers.
 * @param deps - Optional injected dependencies for tests.
 * @returns The restored template; one that is not archived is returned unchanged.
 * @throws TemplateServiceError when permission or persistence fails.
 */
export async function restoreDocumentTemplate(
  input: ChangeDocumentTemplateStatusInput,
  deps: TemplateServiceDeps = {}
): Promise<DocumentTemplate> {
  return runTemplateOperation(
    "restore_document_template",
    input,
    async (): Promise<DocumentTemplate> => {
      const client = getClient(deps)

      await requireTemplateAccess(client, input, "editor", "You cannot manage document templates.")
      const existing = await getTemplateById(client, input.organizationId, input.templateId)

      if (existing.status !== "archived") {
        return existing
      }

      if (existing.trashedAt) {
        return restoreFromTrash(client, input, existing, deps)
      }

      const { data, error } = await client
        .from("document_templates")
        .update({
          status: existing.publishedAt ? "published" : "draft",
          archived_by: null,
          archived_at: null,
          updated_by: input.actorUserId,
        })
        .eq("id", input.templateId)
        .eq("org_id", input.organizationId)
        .eq("revision", existing.revision)
        .eq("status", "archived")
        .is("trashed_at", null)
        .select(TEMPLATE_COLUMNS)
        .maybeSingle()

      if (error) {
        throw createDatabaseError(error, "Unable to restore document template.")
      }

      if (!data) {
        throw new TemplateServiceError("Document template changed before it could be restored.", 409)
      }

      return mapDocumentTemplate(data as DocumentTemplateRow)
    }
  )
}

async function restoreFromTrash(
  client: TemplateServiceClient,
  input: ChangeDocumentTemplateStatusInput,
  existing: DocumentTemplate,
  deps: TemplateServiceDeps
): Promise<DocumentTemplate> {
  const { data: held, error: heldError } = await client
    .from("document_templates")
    .select("pre_trash_status")
    .eq("id", input.templateId)
    .eq("org_id", input.organizationId)
    .maybeSingle()

  if (heldError) {
    throw createDatabaseError(heldError, "Unable to restore document template.")
  }

  const previous = (held as { pre_trash_status?: unknown } | null)?.pre_trash_status

  if (!DOCUMENT_TEMPLATE_STATUSES.includes(previous as DocumentTemplateStatus)) {
    throw new TemplateServiceError("Database returned an unsupported template status.", 500)
  }

  // An archive from before Trash stays as it was; Trash's own archive goes.
  const wasArchived = previous === "archived"
  const { data, error } = await client
    .from("document_templates")
    .update({
      status: previous as DocumentTemplateStatus,
      archived_at: wasArchived ? existing.archivedAt : null,
      archived_by: wasArchived ? existing.archivedBy : null,
      trashed_at: null,
      trashed_by: null,
      pre_trash_status: null,
      updated_by: input.actorUserId,
    })
    .eq("id", input.templateId)
    .eq("org_id", input.organizationId)
    .eq("revision", existing.revision)
    .eq("status", "archived")
    .not("trashed_at", "is", null)
    .select(TEMPLATE_TABLE_COLUMNS)
    .maybeSingle()

  if (error) {
    throw createDatabaseError(error, "Unable to restore document template.")
  }

  if (!data) {
    throw new TemplateServiceError("Document template changed before it could be restored.", 409)
  }

  const restored = mapDocumentTemplate(data as DocumentTemplateRow)

  await recordTemplateAudit(deps, input, "template.restored", { title: restored.title, status: restored.status })
  return restored
}

/**
 * Moves a template to Trash: it is archived, so nobody can start from it or
 * answer it, and remembers its status for Restore. Its pictures stay where
 * they are. A template anyone has sent answers through, a draft answer
 * included, can only be archived.
 *
 * @param input - Actor, organization, and template identifiers.
 * @param deps - Optional injected dependencies for tests.
 * @returns The template in Trash.
 * @throws TemplateServiceError 409 when it has answers, is already in Trash, or changed meanwhile.
 */
export async function trashDocumentTemplate(
  input: ChangeDocumentTemplateStatusInput,
  deps: TemplateServiceDeps = {}
): Promise<DocumentTemplate> {
  return runTemplateOperation(
    "trash_document_template",
    input,
    async (): Promise<DocumentTemplate> => {
      const client = getClient(deps)

      await requireTemplateAccess(client, input, "editor", "You cannot manage document templates.")
      const existing = await getTemplateById(client, input.organizationId, input.templateId)

      if (existing.trashedAt) {
        throw new TemplateServiceError("Document template is already in Trash.", 409)
      }

      // ponytail: checked before the write, not in one statement. An answer
      // started in between leaves a trashed template that deleting refuses,
      // in the database, so nothing answered is ever lost.
      // A document made from it and sent to answer counts too: its links
      // belong to the template, and deleting it would take them.
      const [answers, sent] = await Promise.all([
        client.from("submissions").select("id").eq("org_id", input.organizationId).eq("template_id", input.templateId).limit(1),
        client
          .from("public_form_links")
          .select("id")
          .eq("org_id", input.organizationId)
          .eq("template_id", input.templateId)
          .not("document_id", "is", null)
          .limit(1),
      ])
      const lookupError = answers.error ?? sent.error

      if (lookupError) {
        throw createDatabaseError(lookupError, "Unable to move the template to Trash.")
      }

      if ((answers.data ?? []).length > 0 || (sent.data ?? []).length > 0) {
        throw new TemplateServiceError(TEMPLATE_ANSWERED_MESSAGE, 409)
      }

      const now = nowIso(deps)
      const wasArchived = existing.status === "archived"
      const { data, error } = await client
        .from("document_templates")
        .update({
          status: "archived",
          archived_at: wasArchived ? existing.archivedAt : now,
          archived_by: wasArchived ? existing.archivedBy : input.actorUserId,
          trashed_at: now,
          trashed_by: input.actorUserId,
          pre_trash_status: existing.status,
          updated_by: input.actorUserId,
        })
        .eq("id", input.templateId)
        .eq("org_id", input.organizationId)
        .eq("revision", existing.revision)
        .eq("status", existing.status)
        .is("trashed_at", null)
        .select(TEMPLATE_TABLE_COLUMNS)
        .maybeSingle()

      if (error) {
        throw createDatabaseError(error, "Unable to move the template to Trash.")
      }

      if (!data) {
        throw new TemplateServiceError("Document template changed before it could be moved to Trash.", 409)
      }

      const trashed = mapDocumentTemplate(data as DocumentTemplateRow)

      await recordTemplateAudit(deps, input, "template.trashed", { title: trashed.title, previousStatus: existing.status })
      return trashed
    }
  )
}

/**
 * Deletes a template in Trash for good, once its exact title is typed. The
 * documents made from it keep their own copy and stop pointing at it; its
 * pictures stay, since those documents share them. The database does it in
 * one step and records it in the audit log.
 *
 * @param input - Actor, organization, template, and the typed title.
 * @param deps - Optional injected dependencies for tests.
 * @throws TemplateServiceError 404 when it is not in Trash, 400 when the title does not match, 409 when it has answers.
 */
export async function purgeTrashedDocumentTemplate(
  input: PurgeTrashedDocumentTemplateInput,
  deps: TemplateServiceDeps = {}
): Promise<void> {
  return runTemplateOperation(
    "purge_trashed_document_template",
    { actorUserId: input.actorUserId, organizationId: input.organizationId, templateId: input.templateId },
    async (): Promise<void> => {
      const client = getClient(deps)

      await requireTemplateAccess(client, input, "editor", "You cannot manage document templates.")

      const { error } = await client.rpc("purge_trashed_document_template", {
        target_actor_user_id: input.actorUserId,
        target_confirmation_title: input.confirmationTitle,
        target_org_id: input.organizationId,
        target_template_id: input.templateId,
      })

      if (error) {
        throw toPurgeError(error)
      }
    }
  )
}

/**
 * Empties Trash of the templates that have been there 30 days, in every
 * workspace, leaving any that people answered. Run by the purge cron.
 *
 * @param deps - Optional injected dependencies for tests.
 * @returns How many templates were deleted.
 * @throws TemplateServiceError when the database refuses.
 */
export async function purgeDueTrashedTemplates(deps: TemplateServiceDeps = {}): Promise<number> {
  return runTemplateOperation("purge_due_trashed_templates", {}, async (): Promise<number> => {
    // Every workspace at once, by design: the function picks only templates
    // past their 30 days and audits each in its own workspace.
    const { data, error } = await getClient(deps).rpc("purge_due_trashed_document_templates", { target_limit: 100 })

    if (error || typeof data !== "number") {
      throw createDatabaseError(error, "Unable to empty template Trash.")
    }

    return data
  })
}

function toPurgeError(error: unknown): TemplateServiceError {
  const code = asSupabaseError(error)?.code

  if (code === "P0002") return new TemplateServiceError("This template is not in Trash.", 404)
  if (code === "22023") return new TemplateServiceError("The title you typed does not match the template's.", 400)
  // 23503: an answer or document arrived as it was being deleted.
  if (code === "P0001" || code === "23503") return new TemplateServiceError(TEMPLATE_ANSWERED_MESSAGE, 409)

  return createDatabaseError(error, "Unable to delete the template.")
}

function recordTemplateAudit(
  deps: TemplateServiceDeps,
  input: ChangeDocumentTemplateStatusInput,
  action: "template.restored" | "template.trashed",
  metadata: AuditMetadata
): Promise<void> {
  return recordAuditLogBestEffort(
    {
      action,
      actorUserId: input.actorUserId,
      metadata,
      organizationId: input.organizationId,
      targetId: input.templateId,
      targetType: "template",
    },
    deps.recordAuditLog
  )
}

/**
 * Files a template under a category, or under none. Unlike an edit in the
 * editor this leaves the revision alone: the category is not part of what a
 * version publishes, so nothing needs publishing again.
 *
 * @param input - Actor, organization, template, and the new category (null clears it).
 * @param deps - Optional injected dependencies for tests.
 * @returns The template and the category it had, so the change can be put back.
 * @throws TemplateServiceError when permission or persistence fails, or the template is archived.
 */
export async function setDocumentTemplateCategory(
  input: SetDocumentTemplateCategoryInput,
  deps: TemplateServiceDeps = {}
): Promise<{ previousCategory: string | null; templateId: string }> {
  return runTemplateOperation(
    "set_document_template_category",
    { actorUserId: input.actorUserId, organizationId: input.organizationId, templateId: input.templateId },
    async () => {
      const client = getClient(deps)

      await requireTemplateAccess(client, input, "editor", "You cannot manage document templates.")
      const category = normalizeCategory(input.category)
      const existing = await getTemplateById(client, input.organizationId, input.templateId)

      if (existing.status === "archived") {
        throw new TemplateServiceError("Archived templates cannot be edited.", 409)
      }

      const { data, error } = await client
        .from("document_templates")
        .update({ category, updated_by: input.actorUserId })
        .eq("id", input.templateId)
        .eq("org_id", input.organizationId)
        .eq("revision", existing.revision)
        .eq("status", existing.status)
        .select("id")
        .maybeSingle()

      if (error) {
        throw createDatabaseError(error, "Unable to change the template's category.")
      }

      if (!data) {
        throw new TemplateServiceError("Document template changed before its category could be set.", 409)
      }

      return { previousCategory: existing.category, templateId: input.templateId }
    }
  )
}

/**
 * Duplicates an existing template into a new draft.
 *
 * @param input - Actor, organization, and template identifiers.
 * @param deps - Optional injected dependencies for tests.
 * @returns The duplicated draft template.
 * @throws TemplateServiceError when permission, validation, or persistence fails.
 */
export async function duplicateDocumentTemplate(
  input: DuplicateDocumentTemplateInput,
  deps: TemplateServiceDeps = {}
): Promise<DocumentTemplate> {
  return runTemplateOperation(
    "duplicate_document_template",
    input,
    async (): Promise<DocumentTemplate> => {
      const client = getClient(deps)

      await requireCanCreateTemplates(client, input.organizationId, input.actorUserId)
      const level = await requireTemplateAccess(client, input, "user", "You cannot copy this template.")

      // Only an editor may copy the working copy; everyone else gets what was published.
      const existing = await (level === "editor" ? getTemplateById : getPublishedTemplateById)(
        client,
        input.organizationId,
        input.templateId
      )

      const newContent = parseTemplateContent(
        JSON.parse(JSON.stringify(existing.content))
      )

      const COPY_SUFFIX = " (Copy)"
      const MAX_TITLE_LENGTH = 180
      const baseTitle =
        existing.title.length + COPY_SUFFIX.length > MAX_TITLE_LENGTH
          ? existing.title.slice(0, MAX_TITLE_LENGTH - COPY_SUFFIX.length)
          : existing.title

      const { data, error } = await client
        .from("document_templates")
        .insert({
          id: createId(deps),
          org_id: input.organizationId,
          title: normalizeTitle(`${baseTitle}${COPY_SUFFIX}`),
          description: existing.description,
          category: existing.category,
          status: "draft",
          revision: 1,
          content: upgradeV2TemplateContentToV3(newContent),
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
        throw createDatabaseError(error, "Unable to duplicate document template.")
      }

      return mapDocumentTemplate(data as DocumentTemplateRow)
    }
  )
}
