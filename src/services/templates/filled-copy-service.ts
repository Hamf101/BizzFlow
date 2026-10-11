import * as z from "zod"

import { collectFields, keepValidAnswers } from "@/services/document-signing/answer-validation"
import { saveGeneratedDocumentAnswers } from "@/services/document-signing/workflows"
import { upgradeV2TemplateContentToV3 } from "@/types/template"
import { deleteTemplateBlock } from "@/types/template-structure"

import type { TemplateActorInput, TemplateServiceDeps } from "./contracts"
import { createGeneratedDocument } from "./generated-document-service"
import { getDocumentTemplate } from "./template-lifecycle-service"
import { getClient, requirePermission, runTemplateOperation } from "./shared"

const TITLE_MAX_LENGTH = 180
const FILLED = " (filled)"

export type CreateFilledTemplateCopyInput = TemplateActorInput & {
  templateId: string
  /** Answers read off the form the template was recreated from, keyed by field key. Untrusted. */
  answers: unknown
}

/** The filled copy, or none when no answer fit; and how many answers did and didn't fit. */
export type FilledTemplateCopy = { documentId: string | null; dropped: number; kept: number }

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
 *   when the member cannot make documents, 400 for answers that are not an object.
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
    const template = await getDocumentTemplate({ actorUserId, organizationId, templateId }, deps)
    // A document takes no file uploads, so a place to attach one stays on the template.
    const content = template.content.blocks
      .filter((block) => block.type === "file_field")
      .reduce((page, block) => deleteTemplateBlock(page, block.id), upgradeV2TemplateContentToV3(template.content))
    const values = await keepValidAnswers(collectFields(content), answers)
    const kept = Object.keys(values).length
    const dropped = Object.keys(answers).length - kept

    // A copy with nothing filled in is no filled copy.
    if (kept === 0) {
      return { documentId: null, dropped, kept }
    }

    // Not template-backed: the copy keeps the page as it stands now, not a published revision.
    const document = await createGeneratedDocument(
      {
        actorUserId,
        organizationId,
        content,
        description: template.description,
        title: `${template.title.trim().slice(0, TITLE_MAX_LENGTH - FILLED.length)}${FILLED}`,
      },
      deps
    )

    try {
      await (deps.saveAnswers ?? saveGeneratedDocumentAnswers)(
        { actorUserId, documentId: document.id, organizationId, values },
        { client: deps.client }
      )
    } catch (error: unknown) {
      // A copy without its answers would only be found later, empty, and a retry would make another.
      const { error: cleanupError } = await client.from("documents").delete().eq("id", document.id).eq("org_id", organizationId)

      if (cleanupError) {
        console.error("filled_copy_cleanup_failed", { documentId: document.id, organizationId })
      }

      throw error
    }

    return { documentId: document.id, dropped, kept }
  })
}
