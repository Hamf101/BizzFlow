import * as z from "zod"

import { collectFields, keepValidAnswers, pruneHiddenAnswerPatch } from "@/services/document-signing/answer-validation"
import { DocumentSigningServiceError } from "@/services/document-signing/errors"
import { getGeneratedDocumentSigningView, saveGeneratedDocumentAnswers } from "@/services/document-signing/workflows"
import { type TemplateContent, upgradeV2TemplateContentToV3 } from "@/types/template"
import { deleteTemplateBlock } from "@/types/template-structure"

import { requireTemplateAccess } from "./access"
import type { TemplateActorInput, TemplateServiceDeps } from "./contracts"
import { TemplateServiceError } from "./errors"
import { createGeneratedDocument } from "./generated-document-service"
import { getClient, getPublishedTemplateById, getTemplateById, requirePermission, runTemplateOperation } from "./shared"

const TITLE_MAX_LENGTH = 180
const FILLED = " (filled)"
const COPY = " (copy)"

export type CreateFilledTemplateCopyInput = TemplateActorInput & {
  templateId: string
  /** Answers read off the form the template was recreated from, keyed by field key. Untrusted. */
  answers: unknown
}

/** The filled copy, or none when no answer fit; and how many answers did and didn't fit. */
export type FilledTemplateCopy = { documentId: string | null; dropped: number; kept: number }

export type CreateDocumentCopyInput = TemplateActorInput & { documentId: string }

export type FilledTemplateCopyDeps = TemplateServiceDeps & {
  /** The member's own answer save; a test stands in for it. */
  saveAnswers?: typeof saveGeneratedDocumentAnswers
}

/**
 * Makes a standalone document of a template as the member sees it, the
 * working copy for its editors, and fills it with the answers read off the
 * form it was recreated from. The answers are saved as the member's own save
 * would: each its field refuses is dropped, and the rest are pruned and
 * calculated with the page.
 *
 * @param input - The member, their organization, the template and the answers.
 * @param deps - Optional injected dependencies for tests.
 * @returns The new document, or none when no answer fits, and how many answers fit.
 * @throws TemplateServiceError: 404 when the template cannot be opened, 403
 *   when the member cannot make documents or only views it, 409 when a
 *   non-editor's template is not published, 400 for answers that are not an object.
 */
export async function createFilledTemplateCopy(
  input: CreateFilledTemplateCopyInput,
  deps: FilledTemplateCopyDeps = {}
): Promise<FilledTemplateCopy> {
  const { actorUserId, organizationId, templateId } = input

  return runTemplateOperation("create_filled_template_copy", { actorUserId, organizationId, templateId }, async () => {
    const client = getClient(deps)

    await requirePermission(client, organizationId, actorUserId, "documents:create", "You cannot create documents.")

    const answers = z.record(z.string(), z.unknown()).parse(input.answers)
    // As making a document from a template: someone who uses it, and its published
    // version unless they edit it, when its working copy is theirs to copy.
    const level = await requireTemplateAccess(client, { actorUserId, organizationId, templateId }, "user", "You cannot use document templates.")
    const working = await getTemplateById(client, organizationId, templateId)

    if (level !== "editor" && working.status !== "published") {
      throw new TemplateServiceError("Only published templates can create documents.", 409)
    }

    const template = level === "editor" ? working : await getPublishedTemplateById(client, organizationId, templateId)
    // A document takes no file uploads, so a place to attach one stays on the template.
    const content = template.content.blocks
      .filter((block) => block.type === "file_field")
      .reduce((page, block) => deleteTemplateBlock(page, block.id), upgradeV2TemplateContentToV3(template.content))
    // Counted as the save will keep them: a new copy holds no answers yet, so one its form's own answers hide is pruned.
    const values = pruneHiddenAnswerPatch(content, {}, await keepValidAnswers(collectFields(content), answers))
    const kept = Object.keys(values).length
    const dropped = Object.keys(answers).length - kept

    // A copy with nothing filled in is no filled copy.
    if (kept === 0) {
      return { documentId: null, dropped, kept }
    }

    // Not template-backed: the copy keeps the page as it stands now, not a published revision.
    const documentId = await createDocumentWithAnswers(
      { actorUserId, organizationId, content, description: template.description, folderId: null, title: withSuffix(template.title, FILLED) },
      values,
      deps
    )

    return { documentId, dropped, kept }
  })
}

/**
 * Makes a new draft of a document to edit, most often one that is completed
 * and so fixed for good: the same page, folder and answers, but no signers
 * and no signature or initials, which belonged to the document as it was.
 *
 * @param input - The member, their organization, and the document to copy.
 * @param deps - Optional injected dependencies for tests.
 * @returns The new document's id.
 * @throws TemplateServiceError: 403 when the member cannot make documents or
 *   add to the folder, 404 when they cannot open the original.
 */
export async function createDocumentCopy(
  input: CreateDocumentCopyInput,
  deps: FilledTemplateCopyDeps = {}
): Promise<{ documentId: string }> {
  const { actorUserId, documentId, organizationId } = input

  return runTemplateOperation("create_document_copy", { actorUserId, documentId, organizationId }, async () => {
    const client = getClient(deps)

    await requirePermission(client, organizationId, actorUserId, "documents:create", "You cannot create documents.")

    const { answers, document } = await getGeneratedDocumentSigningView(input, { client: deps.client }).catch(asTemplateError)
    const content = document.templateSnapshot
    const values = Object.fromEntries(
      Object.entries(answers).filter(([fieldKey]) => !isDrawnBox(content, fieldKey))
    )

    return {
      documentId: await createDocumentWithAnswers(
        { actorUserId, organizationId, content, description: document.description, folderId: document.folderId, title: withSuffix(document.title, COPY) },
        values,
        deps
      ),
    }
  })
}

function isDrawnBox(content: TemplateContent, fieldKey: string): boolean {
  const type = collectFields(content).get(fieldKey)?.type

  return type === "signature_field" || type === "initials_field"
}

function withSuffix(title: string, suffix: string): string {
  return `${title.trim().slice(0, TITLE_MAX_LENGTH - suffix.length)}${suffix}`
}

function asTemplateError(error: unknown): never {
  throw error instanceof DocumentSigningServiceError ? new TemplateServiceError(error.message, error.statusCode) : error
}

/**
 * Makes a standalone document and saves its answers as the member's own save
 * would, leaving nothing behind when they can't be saved.
 *
 * @returns The new document's id.
 */
async function createDocumentWithAnswers(
  document: TemplateActorInput & { content: TemplateContent; description: string | null; folderId: string | null; title: string },
  values: Record<string, unknown>,
  deps: FilledTemplateCopyDeps
): Promise<string> {
  const { actorUserId, organizationId } = document
  const { id } = await createGeneratedDocument(document, deps)

  if (Object.keys(values).length === 0) {
    return id
  }

  try {
    await (deps.saveAnswers ?? saveGeneratedDocumentAnswers)(
      { actorUserId, documentId: id, organizationId, values },
      { client: deps.client }
    )
  } catch (error: unknown) {
    // A copy without its answers would only be found later, empty, and a retry would make another.
    const { error: cleanupError } = await getClient(deps).from("documents").delete().eq("id", id).eq("org_id", organizationId)

    if (cleanupError) {
      console.error("filled_copy_cleanup_failed", { documentId: id, organizationId })
    }

    throw error
  }

  return id
}
