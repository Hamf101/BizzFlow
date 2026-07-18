"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  archiveDocumentTemplate,
  createDocumentTemplate,
  getDocumentTemplate,
  publishDocumentTemplate,
  TemplateServiceError,
  updateDocumentTemplate,
} from "@/services/template-service"
import {
  createBlankTemplateContent,
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
  constructor(message: string) {
    super(message)
    this.name = "TemplateActionError"
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
    const content = createBlankTemplateContent()
    content.branding.organizationName = actionContext.context.organization.name
    const template = await createDocumentTemplate({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      title: getFormString(formData, "title"),
      description: getFormString(formData, "description") || null,
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
      buildRedirect("/templates/new", {
        error: getTemplateActionErrorMessage(
          error,
          "Unable to create document template."
        ),
      })
    )
  }

  redirect(
    buildRedirect(`/templates/${createdTemplateId}/edit`, {
      message: "Template draft created.",
    })
  )
}

/**
 * Saves metadata and canonical content using optimistic revision matching.
 *
 * @param formData - Template id, revision, metadata, and serialized content.
 * @returns Never returns; redirects to the refreshed editor or a user-safe error.
 */
export async function updateTemplateAction(formData: FormData): Promise<void> {
  const templateId = getFormString(formData, "templateId")
  const editorPath = getEditorPath(templateId)
  const startedAt = Date.now()

  try {
    const actionContext = await loadTemplateActionContext()
    const template = await persistTemplateDraft(formData, actionContext)

    revalidateTemplatePaths(template.id)
    console.info("template_update_action_completed", {
      durationMs: Date.now() - startedAt,
      organizationId: actionContext.context.organization.id,
      revision: template.revision,
      templateId: template.id,
    })
  } catch (error: unknown) {
    handleTemplateActionFailure({
      error,
      eventName: "template_update_action_failed",
      nextPath: editorPath,
      startedAt,
      templateId,
      fallback: "Unable to save document template.",
    })
  }

  redirect(buildRedirect(editorPath, { message: "Template saved." }))
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

  try {
    const actionContext = await loadTemplateActionContext()
    const savedTemplate = await persistTemplateDraftForPublish(
      formData,
      actionContext
    )
    const template = await publishDocumentTemplate({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      templateId: savedTemplate.id,
    })

    revalidateTemplatePaths(template.id)
    console.info("template_publish_action_completed", {
      durationMs: Date.now() - startedAt,
      organizationId: actionContext.context.organization.id,
      templateId: template.id,
    })
  } catch (error: unknown) {
    handleTemplateActionFailure({
      error,
      eventName: "template_publish_action_failed",
      nextPath: editorPath,
      startedAt,
      templateId,
      fallback: "Unable to publish document template.",
    })
  }

  redirect(buildRedirect(editorPath, { message: "Template published." }))
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
      fallback: "Unable to archive document template.",
    })
  }

  redirect(buildRedirect("/templates", { message: "Template archived." }))
}

async function persistTemplateDraftForPublish(
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

    // Publishing an already-saved draft is valid. Revision conflicts are
    // rejected by updateDocumentTemplate before it reports a no-op.
    return getDocumentTemplate({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      templateId: requireTemplateId(getFormString(formData, "templateId")),
    })
  }
}

async function loadTemplateActionContext(): Promise<TemplateActionContext> {
  const user = await getAuthenticatedUser()
  const context = await getCurrentOrganizationContext(user.id)

  if (!context) {
    throw new TemplateActionError(
      "Create an organization before managing document templates."
    )
  }

  if (
    !canPerformOrganizationAction(context.membership.role, "templates:manage")
  ) {
    throw new TemplateActionError("You cannot manage document templates.")
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
  fallback: string
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
    buildRedirect(input.nextPath, {
      error: getTemplateActionErrorMessage(input.error, input.fallback),
    })
  )
}

function logTemplateActionFailure(
  eventName: string,
  context: Record<string, string | number>
): void {
  console.warn(eventName, context)
}

function getTemplateActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof TemplateServiceError || error instanceof TemplateActionError) {
    return error.message
  }

  return fallback
}

function getUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown template action error"
}
