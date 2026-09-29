"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import {
  buildFeedbackRedirect,
  getActionErrorFeedbackCode,
} from "@/lib/action-result"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  archiveDocumentTemplate,
  changeDocumentTemplates,
  createDocumentTemplate,
  duplicateDocumentTemplate,
  getDocumentTemplate,
  getDocumentTemplateVersion,
  publishDocumentTemplate,
  MAX_BULK_TEMPLATES,
  type TemplateBulkResult,
  TemplateServiceError,
  updateDocumentTemplate,
} from "@/services/template-service"
import type { SaveResult } from "@/components/editor/use-autosave"
import { withTemplateImageUrls } from "@/services/template-image-service"
import { publishTemplateRoom } from "@/services/working-copy-service"
import {
  createEmptyDocumentContent,
  parseTemplateContent,
  type DocumentTemplate,
  type TemplateContent,
} from "@/types/template"
import type { OrganizationContext } from "@/types/organization"

type TemplateActionContext = {
  actorUserId: string
  context: OrganizationContext
}

class TemplateActionError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = "TemplateActionError"
    this.statusCode = statusCode
  }
}

/**
 * Creates an initial draft template and opens its guided editor.
 *
 * @param formData - New template title and optional description.
 * @returns Never returns; redirects to the new editor or a user-safe error.
 */
export async function createTemplateAction(formData: FormData): Promise<void> {
  const startedAt = Date.now()
  let createdTemplateId = ""

  try {
    const actionContext = await loadTemplateActionContext()
    const content = createEmptyDocumentContent()
    content.branding.organizationName = actionContext.context.organization.name
    const template = await createDocumentTemplate({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      title: getFormString(formData, "title"),
      description: getFormString(formData, "description") || null,
      category: getFormString(formData, "category") || null,
      content,
    })

    revalidatePath("/templates")
    console.info("template_create_action_completed", {
      durationMs: Date.now() - startedAt,
      organizationId: actionContext.context.organization.id,
      templateId: template.id,
    })
    createdTemplateId = template.id
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/templates/new" }))
    }

    logTemplateActionFailure("template_create_action_failed", {
      durationMs: Date.now() - startedAt,
      reason: getUnknownErrorMessage(error),
    })
    redirect(
      buildFeedbackRedirect(
        "/templates/new",
        getActionErrorFeedbackCode(error)
      )
    )
  }

  redirect(
    buildFeedbackRedirect(
      `/templates/${createdTemplateId}/edit`,
      "template_created"
    )
  )
}

/** A template as the editor saves it while it changes. */
export type TemplateDraftInput = {
  category: string
  content: unknown
  description: string
  /** The revision the editor last loaded or saved. */
  expectedRevision: number
  templateId: string
  title: string
}

/**
 * Saves a template from the editor as it changes, without leaving the page.
 * A save from an older revision is refused, so nobody's work is overwritten.
 *
 * @param input - The template's fields and the revision the editor holds.
 * @returns The new revision, or why the save was refused.
 */
export async function saveTemplateDraftAction(input: TemplateDraftInput): Promise<SaveResult> {
  try {
    const actionContext = await loadTemplateActionContext()
    let content: TemplateContent

    try {
      content = parseTemplateContent(input.content)
    } catch {
      return { message: "Some blocks are incomplete. Fix them to save.", ok: false, status: 400 }
    }

    const template = await updateDocumentTemplate({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      templateId: requireTemplateId(input.templateId),
      expectedRevision: input.expectedRevision,
      title: input.title,
      description: input.description || null,
      category: input.category || null,
      content,
    })

    revalidateTemplatePaths(template.id)
    return { ok: true, version: String(template.revision) }
  } catch (error: unknown) {
    if (error instanceof TemplateServiceError && error.message === "No template changes were provided.") {
      return { ok: true, version: String(input.expectedRevision) }
    }

    if (error instanceof AuthenticationError) {
      return { message: "Sign in again to keep saving.", ok: false, status: 401 }
    }

    const statusCode =
      error instanceof TemplateServiceError || error instanceof TemplateActionError ? error.statusCode : 500

    logTemplateActionFailure("template_draft_save_failed", {
      reason: getUnknownErrorMessage(error),
      templateId: input.templateId,
    })
    return {
      message: statusCode === 500 ? "The template could not be saved." : (error as Error).message,
      ok: false,
      status: statusCode,
    }
  }
}

/**
 * Saves the current draft and then publishes the persisted revision.
 *
 * @param formData - Template id, revision, metadata, and serialized content.
 * @returns Never returns; redirects to the published editor or a user-safe error.
 */
export async function publishTemplateAction(formData: FormData): Promise<void> {
  const templateId = getFormString(formData, "templateId")
  const editorPath = getEditorPath(templateId)
  const startedAt = Date.now()
  let outcome: "template_published" | "template_updated" = "template_published"

  try {
    const actionContext = await loadTemplateActionContext()
    const roomId = getFormString(formData, "roomId")
    // Edited live, the template already holds what was typed: publish it as the room shows it.
    const savedTemplate = roomId
      ? await getDocumentTemplate({
          actorUserId: actionContext.actorUserId,
          organizationId: actionContext.context.organization.id,
          templateId: requireTemplateId(templateId),
        })
      : await persistTemplateDraftOrConfirmUnchanged(formData, actionContext)
    const template = roomId
      ? await publishTemplateRoom({
          actorUserId: actionContext.actorUserId,
          organizationId: actionContext.context.organization.id,
          roomId,
          roomRevision: parseRoomRevision(getFormString(formData, "roomRevision")),
          templateId: savedTemplate.id,
        })
      : await publishDocumentTemplate({
          actorUserId: actionContext.actorUserId,
          organizationId: actionContext.context.organization.id,
          templateId: savedTemplate.id,
          expectedRevision: savedTemplate.revision,
        })

    revalidateTemplatePaths(template.id)
    console.info("template_publish_action_completed", {
      durationMs: Date.now() - startedAt,
      organizationId: actionContext.context.organization.id,
      templateId: template.id,
    })
    outcome = savedTemplate.status === "published" ? "template_updated" : "template_published"
  } catch (error: unknown) {
    handleTemplateActionFailure({
      error,
      eventName: "template_publish_action_failed",
      nextPath: editorPath,
      startedAt,
      templateId,
    })
  }

  redirect(buildFeedbackRedirect(editorPath, outcome))
}

/** What a published version held, for the editor to bring back. */
export type TemplateVersionResult =
  | Readonly<{ ok: true; version: Pick<DocumentTemplate, "content" | "description" | "title"> }>
  | Readonly<{ message: string; ok: false }>

/**
 * Loads a published version so the editor can bring it back into the working
 * copy, where it saves like any edit and Undo takes it back.
 *
 * @param templateId - The template the version belongs to.
 * @param revision - The revision it was published at.
 * @returns The version's title, description, and content, or why not.
 */
export async function loadTemplateVersionAction(templateId: string, revision: number): Promise<TemplateVersionResult> {
  try {
    const actionContext = await loadTemplateActionContext()
    const organizationId = actionContext.context.organization.id
    const version = await getDocumentTemplateVersion({
      actorUserId: actionContext.actorUserId,
      organizationId,
      revision,
      templateId: requireTemplateId(templateId),
    })

    // Pictures get addresses this person can load, as the editor page gives them.
    return { ok: true, version: { ...version, content: await withTemplateImageUrls(version.content, organizationId) } }
  } catch (error: unknown) {
    logTemplateActionFailure("template_version_load_failed", {
      reason: getUnknownErrorMessage(error),
      templateId,
    })
    return {
      message:
        error instanceof TemplateServiceError && error.statusCode !== 500
          ? error.message
          : "That version could not be loaded.",
      ok: false,
    }
  }
}

/**
 * Archives a template so it no longer appears to staff for new documents.
 *
 * @param formData - Form containing the template identifier.
 * @returns Never returns; redirects to the library or a user-safe error.
 */
export async function archiveTemplateAction(formData: FormData): Promise<void> {
  const templateId = getFormString(formData, "templateId")
  const editorPath = getEditorPath(templateId)
  const startedAt = Date.now()

  try {
    const actionContext = await loadTemplateActionContext()
    const template = await archiveDocumentTemplate({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      templateId: requireTemplateId(templateId),
    })

    revalidateTemplatePaths(template.id)
    console.info("template_archive_action_completed", {
      durationMs: Date.now() - startedAt,
      organizationId: actionContext.context.organization.id,
      templateId: template.id,
    })
  } catch (error: unknown) {
    handleTemplateActionFailure({
      error,
      eventName: "template_archive_action_failed",
      nextPath: editorPath,
      startedAt,
      templateId,
    })
  }

  redirect(buildFeedbackRedirect("/templates", "resource_archived"))
}

/**
 * Duplicates a template and opens the new draft in the editor.
 *
 * @param formData - Form containing the source template identifier.
 * @returns Never returns; redirects to the new editor or a user-safe error.
 */
export async function duplicateTemplateAction(formData: FormData): Promise<void> {
  const templateId = getFormString(formData, "templateId")
  const startedAt = Date.now()
  let createdTemplateId = ""

  try {
    const actionContext = await loadTemplateActionContext()
    const template = await duplicateDocumentTemplate({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      templateId: requireTemplateId(templateId),
    })

    revalidatePath("/templates")
    console.info("template_duplicate_action_completed", {
      durationMs: Date.now() - startedAt,
      organizationId: actionContext.context.organization.id,
      sourceTemplateId: templateId,
      newTemplateId: template.id,
    })
    createdTemplateId = template.id
  } catch (error: unknown) {
    handleTemplateActionFailure({
      error,
      eventName: "template_duplicate_action_failed",
      nextPath: "/templates", // Fallback path if duplication fails
      startedAt,
      templateId,
    })
  }

  redirect(
    buildFeedbackRedirect(
      `/templates/${createdTemplateId}/edit`,
      "template_duplicated"
    )
  )
}

const templateChangeSchema = z.object({
  category: z.string().nullable().optional(),
  change: z.enum(["archive", "restore", "duplicate", "category"]),
  templateIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_TEMPLATES),
})

/** One change for several of the library's selected templates. */
export type TemplateChange = z.infer<typeof templateChangeSchema>

/**
 * Changes several templates at once for the library's selection. The service
 * runs each through its single-change checks and reports what changed, so the
 * page can say so and offer Undo.
 *
 * @param input - The change and the selected templates.
 * @returns The templates that changed, any copies made, the categories they had, and how many failed.
 */
export async function changeTemplatesAction(input: TemplateChange): Promise<TemplateBulkResult> {
  const change = templateChangeSchema.parse(input)
  let actionContext: TemplateActionContext

  try {
    actionContext = await loadTemplateActionContext()
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/templates" }))
    }

    throw error
  }

  const result = await changeDocumentTemplates({
    ...change,
    actorUserId: actionContext.actorUserId,
    organizationId: actionContext.context.organization.id,
  })

  revalidatePath("/templates")
  return result
}

async function persistTemplateDraftOrConfirmUnchanged(
  formData: FormData,
  actionContext: TemplateActionContext
): Promise<DocumentTemplate> {
  try {
    return await persistTemplateDraft(formData, actionContext)
  } catch (error: unknown) {
    if (
      !(error instanceof TemplateServiceError) ||
      error.statusCode !== 400 ||
      error.message !== "No template changes were provided."
    ) {
      throw error
    }

    // Saving or publishing an already-saved draft is valid (Undo can return the
    // editor to the saved state), but the follow-up read must still represent
    // the exact revision submitted by the editor.
    const expectedRevision = parseExpectedRevision(
      getFormString(formData, "expectedRevision")
    )
    const template = await getDocumentTemplate({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      templateId: requireTemplateId(getFormString(formData, "templateId")),
    })

    if (template.revision !== expectedRevision) {
      throw new TemplateServiceError(
        "Document template changed since it was opened.",
        409
      )
    }

    return template
  }
}

async function loadTemplateActionContext(): Promise<TemplateActionContext> {
  const user = await getAuthenticatedUser()
  const context = await getCurrentOrganizationContext(user.id)

  if (!context) {
    throw new TemplateActionError(
      "Create an organization before managing document templates.",
      403
    )
  }

  if (
    !canPerformOrganizationAction(context.membership, "templates:manage")
  ) {
    throw new TemplateActionError("You cannot manage document templates.", 403)
  }

  return { actorUserId: user.id, context }
}

async function persistTemplateDraft(
  formData: FormData,
  actionContext: TemplateActionContext
): Promise<DocumentTemplate> {
  const templateId = requireTemplateId(getFormString(formData, "templateId"))
  const expectedRevision = parseExpectedRevision(
    getFormString(formData, "expectedRevision")
  )
  const content = parseTemplateContentField(getFormString(formData, "content"))

  return updateDocumentTemplate({
    actorUserId: actionContext.actorUserId,
    organizationId: actionContext.context.organization.id,
    templateId,
    expectedRevision,
    title: getFormString(formData, "title"),
    description: getFormString(formData, "description") || null,
    category: getFormString(formData, "category") || null,
    content,
  })
}

function parseTemplateContentField(value: string): TemplateContent {
  try {
    return parseTemplateContent(JSON.parse(value) as unknown)
  } catch {
    throw new TemplateActionError(
      "Template content is invalid. Review incomplete blocks and try again."
    )
  }
}

function parseExpectedRevision(value: string): number {
  const revision = Number(value)

  if (!Number.isInteger(revision) || revision < 1) {
    throw new TemplateActionError("Template revision is invalid.")
  }

  return revision
}

// A room starts at revision 0, before anyone's change is kept.
function parseRoomRevision(value: string): number {
  const revision = Number(value)

  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TemplateActionError("Template revision is invalid.")
  }

  return revision
}

function requireTemplateId(value: string): string {
  const templateId = value.trim()

  if (!templateId) {
    throw new TemplateActionError("Template id is required.")
  }

  return templateId
}

function getEditorPath(templateId: string): string {
  const normalizedTemplateId = templateId.trim()
  return normalizedTemplateId
    ? `/templates/${encodeURIComponent(normalizedTemplateId)}/edit`
    : "/templates"
}

function revalidateTemplatePaths(templateId: string): void {
  revalidatePath("/templates")
  revalidatePath(`/templates/${templateId}/edit`)
}

function handleTemplateActionFailure(input: {
  error: unknown
  eventName: string
  nextPath: string
  startedAt: number
  templateId: string
}): never {
  if (input.error instanceof AuthenticationError) {
    redirect(buildRedirect("/login", { next: input.nextPath }))
  }

  logTemplateActionFailure(input.eventName, {
    durationMs: Date.now() - input.startedAt,
    reason: getUnknownErrorMessage(input.error),
    templateId: input.templateId,
  })
  redirect(
    buildFeedbackRedirect(
      input.nextPath,
      getActionErrorFeedbackCode(input.error)
    )
  )
}

function logTemplateActionFailure(
  eventName: string,
  context: Record<string, string | number>
): void {
  console.warn(eventName, context)
}

function getUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown template action error"
}
