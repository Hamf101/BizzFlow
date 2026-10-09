import { validateSubmissionForSubmit } from "@/services/submissions/validation"
import type { PublicFormLink } from "@/types/public-link"
import { SubmissionDomainError } from "@/types/submission"
import type { DocumentTemplate, TemplateContent } from "@/types/template"
import { isStructuredAnswerBlock } from "@/types/template-answer"
import {
  createPublicSubmissionError,
  loadAvailableFileFieldKeys,
  resolvePublicDraft,
} from "@/services/public-forms/draft-service"
import { requireValidLink } from "@/services/public-forms/link-service"
import {
  DRAFT_CHANGED,
  type PublicFormServiceDeps,
  PublicFormServiceError,
  type PublicSubmissionResult,
  type SubmitPublicFormInput,
  createId,
  getClient,
  nowIso,
} from "@/services/public-forms/shared"

/**
 * Coerces raw form values to the shapes the shared submission validator expects.
 *
 * Browsers post a checkbox as a string when ticked and omit it entirely when
 * not, so every declared checkbox is resolved to a boolean here. File fields
 * are dropped because their completion is proven by verified storage rows.
 * Structured answers are parsed from JSON text and checked by the validator.
 */
function coercePublicFormValues(
  snapshot: TemplateContent,
  values: Record<string, unknown>
): Record<string, unknown> {
  const coerced: Record<string, unknown> = { ...values }

  for (const block of snapshot.blocks) {
    if (!("fieldKey" in block)) {
      continue
    }

    if (block.type === "checkbox_field") {
      coerced[block.fieldKey] =
        values[block.fieldKey] === "true" || values[block.fieldKey] === true
      continue
    }

    if (block.type === "file_field") {
      delete coerced[block.fieldKey]
      continue
    }

    // Several choices, a grid or a table arrive as one JSON string; blank is unanswered.
    const raw = values[block.fieldKey]

    if (isStructuredAnswerBlock(block) && typeof raw === "string") {
      if (raw.trim() === "") {
        delete coerced[block.fieldKey]
        continue
      }

      try {
        coerced[block.fieldKey] = JSON.parse(raw) as unknown
      } catch {
        // Left as text, which the validator refuses for this kind with a 400.
      }
    }
  }

  return coerced
}

/**
 * Submits a public form entry anonymously.
 *
 * Values are validated against the template snapshot with the same validator
 * the authenticated path uses, so unknown field keys, missing required answers,
 * and out-of-range values are all rejected server-side.
 */
export async function submitPublicForm(
  input: SubmitPublicFormInput,
  deps: PublicFormServiceDeps = {}
): Promise<PublicSubmissionResult> {
  const client = getClient(deps)
  const preview = await requireValidLink(input.token, deps)
  const link = preview.link as PublicFormLink
  const template = preview.template as DocumentTemplate

  const draft = input.draftToken
    ? await resolvePublicDraft(input.draftToken, link.id, deps)
    : null

  if (
    draft &&
    (!Number.isInteger(input.expectedRevision) ||
      input.expectedRevision !== draft.revision)
  ) {
    throw new PublicFormServiceError(DRAFT_CHANGED, 409)
  }

  const snapshot = draft?.snapshot ?? template.content
  const availableFileFieldKeys = draft
    ? await loadAvailableFileFieldKeys(draft, deps)
    : new Set<string>()

  let normalizedValues: Record<string, unknown>

  try {
    normalizedValues = await validateSubmissionForSubmit(
      snapshot,
      coercePublicFormValues(snapshot, input.values),
      availableFileFieldKeys
    )
  } catch (error: unknown) {
    if (error instanceof SubmissionDomainError) {
      throw new PublicFormServiceError(error.message, error.statusCode)
    }

    throw new PublicFormServiceError("Your submission is not valid.", 400)
  }

  // One database call saves the submission and claims the link's capacity
  // together. It locks the link, re-checks status, expiry, and the ceiling,
  // and guards a draft by its revision, so a refused or failed save never uses
  // a slot and concurrent submitters cannot exceed the ceiling.
  const timestamp = nowIso(deps)
  const { data, error } = await client.rpc("submit_public_form_entry", {
    target_public_form_token: input.token,
    target_public_draft_token: draft ? (input.draftToken ?? null) : null,
    target_expected_revision: draft ? draft.revision : null,
    target_submission_id: draft ? null : createId(deps),
    target_title: draft
      ? null
      : input.title?.trim() || `${template.title} (Public)`,
    target_template_id: draft ? null : template.id,
    target_template_revision: draft ? null : template.revision,
    target_template_snapshot: draft ? null : template.content,
    target_values: normalizedValues,
    target_submitted_at: timestamp,
  })

  if (error || !data) {
    throw createPublicSubmissionError(error, draft !== null)
  }

  return {
    submissionId: data.id,
    organizationId: data.org_id,
    status: "submitted",
    submittedAt: timestamp,
  }
}
