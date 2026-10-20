"use server"

import { revalidatePath } from "next/cache"
import * as z from "zod"

import { AuthenticationError } from "@/lib/auth"
import {
  ActionError,
  loadActionContext,
  loadActionContextOrSignIn,
  requireFormId,
  runFormAction,
  type ActionActor,
} from "@/lib/form-action"
import { getFormString } from "@/lib/form-utils"
import {
  archiveDocumentTemplate,
  changeDocumentTemplates,
  createDocumentTemplate,
  createFilledTemplateCopy,
  duplicateDocumentTemplate,
  getDocumentTemplate,
  getDocumentTemplateVersion,
  publishDocumentTemplate,
  purgeTrashedDocumentTemplate,
  MAX_BULK_TEMPLATES,
  type TemplateBulkResult,
  TemplateServiceError,
  updateDocumentTemplate,
} from "@/services/template-service"
import type { SaveResult } from "@/components/editor/use-autosave"
import { withTemplateImageUrls } from "@/services/template-image-service"
import { publishTemplateRoom } from "@/services/working-copy-service"
import type { FlowFillResult } from "@/types/template-flow"
import {
  createEmptyDocumentContent,
  parseTemplateContent,
  type DocumentTemplate,
  type TemplateContent,
} from "@/types/template"

const NO_ORGANIZATION = "Create an organization before managing document templates."

// The service judges each template, since sharing can let someone edit one their role could not.
const loadTemplateActionContext = (): ReturnType<typeof loadActionContext> =>
  loadActionContext(NO_ORGANIZATION)

/**
 * Creates a draft template and opens its editor, ready to type.
 *
 * @param formData - An optional title, description and category.
 * @returns Never returns; redirects to the new editor or a user-safe error.
 */
export async function createTemplateAction(formData: FormData): Promise<void> {
  await runFormAction({
    event: "template_create_action",
    path: "/templates",
    success: "template_created",
    run: async () => {
      const { actor, organization } = await loadTemplateActionContext()
      const content = createEmptyDocumentContent()
      content.branding.organizationName = organization.name
      const template = await createDocumentTemplate({
        ...actor,
        title: getFormString(formData, "title"),
        description: getFormString(formData, "description") || null,
        category: getFormString(formData, "category") || null,
        content,
      })

      revalidatePath("/templates")
      // Opens with the cursor on its empty page (see TemplateEditor).
      return { path: `/templates/${template.id}/edit?new=1` }
    },
  })
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
    const { actor } = await loadTemplateActionContext()
    let content: TemplateContent

    try {
      content = parseTemplateContent(input.content)
    } catch {
      return { message: "Some blocks are incomplete. Fix them to save.", ok: false, status: 400 }
    }

    const template = await updateDocumentTemplate({
      ...actor,
      templateId: requireFormId(input.templateId, "Template id"),
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
      error instanceof TemplateServiceError || error instanceof ActionError ? error.statusCode : 500

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

  await runFormAction({
    event: "template_publish_action",
    log: { templateId },
    path: getEditorPath(templateId),
    success: "template_published",
    run: async () => {
      const { actor } = await loadTemplateActionContext()
      const roomId = getFormString(formData, "roomId")
      // Edited live, the template already holds what was typed: publish it as the room shows it.
      const savedTemplate = roomId
        ? await getDocumentTemplate({ ...actor, templateId: requireFormId(templateId, "Template id") })
        : await persistTemplateDraftOrConfirmUnchanged(formData, actor)
      const template = roomId
        ? await publishTemplateRoom({
            ...actor,
            roomId,
            roomRevision: parseRoomRevision(getFormString(formData, "roomRevision")),
            templateId: savedTemplate.id,
          })
        : await publishDocumentTemplate({
            ...actor,
            templateId: savedTemplate.id,
            expectedRevision: savedTemplate.revision,
          })

      revalidateTemplatePaths(template.id)
      return { code: savedTemplate.status === "published" ? "template_updated" : "template_published" }
    },
  })
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
    const { actor } = await loadTemplateActionContext()
    const version = await getDocumentTemplateVersion({
      ...actor,
      revision,
      templateId: requireFormId(templateId, "Template id"),
    })

    // Pictures get addresses this person can load, as the editor page gives them.
    return { ok: true, version: { ...version, content: await withTemplateImageUrls(version.content, actor.organizationId) } }
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
 * Makes a document of a template filled with the answers Flow read off the
 * form it was recreated from.
 *
 * @param templateId - The template to copy.
 * @param answers - The answers, keyed by field key; the service checks each.
 * @returns The new document's editor and how many answers fit, or why not.
 */
export async function createFilledCopyAction(templateId: string, answers: unknown): Promise<FlowFillResult> {
  try {
    const { actor } = await loadTemplateActionContext()
    const { documentId, dropped, kept } = await createFilledTemplateCopy({
      ...actor,
      answers,
      templateId: requireFormId(templateId, "Template id"),
    })

    if (!documentId) {
      return { dropped, kept, ok: true }
    }

    revalidatePath("/documents")
    return { dropped, href: `/documents/${encodeURIComponent(documentId)}/edit`, kept, ok: true }
  } catch (error: unknown) {
    logTemplateActionFailure("template_filled_copy_failed", { reason: getUnknownErrorMessage(error), templateId })
    return {
      message:
        error instanceof TemplateServiceError && error.statusCode !== 500 ? error.message : "The filled copy couldn't be made. Try again.",
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

  await runFormAction({
    event: "template_archive_action",
    log: { templateId },
    path: getEditorPath(templateId),
    success: "resource_archived",
    run: async () => {
      const { actor } = await loadTemplateActionContext()
      const template = await archiveDocumentTemplate({
        ...actor,
        templateId: requireFormId(templateId, "Template id"),
      })

      revalidateTemplatePaths(template.id)
      return { path: "/templates" }
    },
  })
}

/**
 * Duplicates a template and opens the new draft in the editor.
 *
 * @param formData - Form containing the source template identifier.
 * @returns Never returns; redirects to the new editor or a user-safe error.
 */
export async function duplicateTemplateAction(formData: FormData): Promise<void> {
  const templateId = getFormString(formData, "templateId")

  await runFormAction({
    event: "template_duplicate_action",
    log: { templateId },
    path: "/templates",
    success: "template_duplicated",
    run: async () => {
      const { actor } = await loadTemplateActionContext()
      const template = await duplicateDocumentTemplate({
        ...actor,
        templateId: requireFormId(templateId, "Template id"),
      })

      revalidatePath("/templates")
      return { path: `/templates/${template.id}/edit` }
    },
  })
}

/**
 * Deletes a template in Trash for good, once its exact title is typed.
 *
 * @param formData - The template's id and the typed title.
 * @returns Never returns; redirects back to Trash with how it went.
 */
export async function purgeTemplateAction(formData: FormData): Promise<void> {
  const templateId = getFormString(formData, "templateId")

  await runFormAction({
    event: "template_purge_action",
    // Someone answered it since it went to Trash: say so, rather than "refresh".
    failure: (error) => (error instanceof TemplateServiceError && error.statusCode === 409 ? "template_has_answers" : undefined),
    log: { templateId },
    path: "/templates?status=trash",
    success: "template_deleted",
    run: async () => {
      const { actor } = await loadTemplateActionContext()

      await purgeTrashedDocumentTemplate({
        ...actor,
        confirmationTitle: getFormString(formData, "confirmationTitle"),
        templateId: requireFormId(templateId, "Template id"),
      })
      revalidatePath("/templates")
    },
  })
}

const templateChangeSchema = z.object({
  category: z.string().nullable().optional(),
  change: z.enum(["archive", "restore", "trash", "duplicate", "category"]),
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
  const { actor } = await loadActionContextOrSignIn("/templates", NO_ORGANIZATION)
  const result = await changeDocumentTemplates({ ...change, ...actor })

  revalidatePath("/templates")
  return result
}

async function persistTemplateDraftOrConfirmUnchanged(
  formData: FormData,
  actor: ActionActor
): Promise<DocumentTemplate> {
  try {
    return await persistTemplateDraft(formData, actor)
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
      ...actor,
      templateId: requireFormId(getFormString(formData, "templateId"), "Template id"),
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

async function persistTemplateDraft(
  formData: FormData,
  actor: ActionActor
): Promise<DocumentTemplate> {
  const templateId = requireFormId(getFormString(formData, "templateId"), "Template id")
  const expectedRevision = parseExpectedRevision(
    getFormString(formData, "expectedRevision")
  )
  const content = parseTemplateContentField(getFormString(formData, "content"))

  return updateDocumentTemplate({
    ...actor,
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
    throw new ActionError(
      "Template content is invalid. Review incomplete blocks and try again."
    )
  }
}

function parseExpectedRevision(value: string): number {
  const revision = Number(value)

  if (!Number.isInteger(revision) || revision < 1) {
    throw new ActionError("Template revision is invalid.")
  }

  return revision
}

// A room starts at revision 0, before anyone's change is kept.
function parseRoomRevision(value: string): number {
  const revision = Number(value)

  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new ActionError("Template revision is invalid.")
  }

  return revision
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

function logTemplateActionFailure(
  eventName: string,
  context: Record<string, string | number>
): void {
  console.warn(eventName, context)
}

function getUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown template action error"
}
