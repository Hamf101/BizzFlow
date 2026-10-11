import { isDeepStrictEqual } from "node:util"

import { normalizeOptionalDrawing } from "@/services/document-signing/drawing-validation"
import { DocumentSigningServiceError } from "@/services/document-signing/errors"
import { boxSigner } from "@/types/box-signers"
import type { TemplateBlock, TemplateContent } from "@/types/template"
import { calculateTemplateAnswers } from "@/types/template-calculation"
import { calculatedFieldKeys } from "@/types/template-formula"
import {
  isTemplateAnswerComplete,
  normalizeTemplateAnswer
} from "@/types/template-answer"
import {
  getVisibleTemplateBlocks,
  pruneHiddenTemplateFieldValues,
  templateRequiresVisibleInitials
} from "@/types/template-visibility"

/** Fillable template block indexed by its stable field key. */
export type FieldBlock = Exclude<
  Extract<TemplateBlock, { fieldKey: string }>,
  { type: "file_field" }
>

/**
 * Collects every generated-document answer block in a snapshot.
 *
 * @param content - Validated immutable template snapshot.
 * @returns Field blocks indexed by their stable field keys.
 * @throws DocumentSigningServiceError when persisted field keys are duplicated.
 */
export function collectFields(
  content: TemplateContent
): Map<string, FieldBlock> {
  const fieldByKey = new Map<string, FieldBlock>()

  for (const block of content.blocks) {
    if (!("fieldKey" in block) || block.type === "file_field") {
      continue
    }

    if (fieldByKey.has(block.fieldKey)) {
      throw new DocumentSigningServiceError(
        `Document field key ${block.fieldKey} is duplicated.`,
        500
      )
    }

    fieldByKey.set(block.fieldKey, block)
  }

  return fieldByKey
}

/**
 * Validates and normalizes a submitted answer patch against a snapshot.
 *
 * @param fieldByKey - Snapshot fields indexed by field key.
 * @param patch - Untrusted answer object.
 * @param sender - Set only on a member's save: whether the document has been
 *   sent, which freezes the sender's own boxes. A signer passes nothing.
 * @returns Normalized answer patch containing only known fields.
 * @throws DocumentSigningServiceError when a field or value is invalid.
 */
export async function normalizeAnswerPatch(
  fieldByKey: Map<string, FieldBlock>,
  patch: Record<string, unknown>,
  sender?: { sent: boolean }
): Promise<Record<string, unknown>> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new DocumentSigningServiceError(
      "Document answers must be a JSON object.",
      400
    )
  }

  const normalizedPatch: Record<string, unknown> = {}

  for (const [fieldKey, value] of Object.entries(patch)) {
    const block = fieldByKey.get(fieldKey)

    if (!block) {
      throw new DocumentSigningServiceError(
        `Document field ${fieldKey} is not part of this snapshot.`,
        400
      )
    }

    normalizedPatch[fieldKey] = await normalizeFieldAnswer(block, value, sender)
  }

  return normalizedPatch
}

/**
 * Keeps each answer its field takes, as a member's save would take it, and
 * drops every other one rather than refusing them all: a key no field has, a
 * value its field refuses, and any signature or initials, which no one gave.
 *
 * @param fieldByKey - Snapshot fields indexed by field key.
 * @param answers - Untrusted answers keyed by field key.
 * @returns The normalized answers that fit.
 */
export async function keepValidAnswers(
  fieldByKey: Map<string, FieldBlock>,
  answers: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const kept: [string, unknown][] = []

  for (const [fieldKey, value] of Object.entries(answers)) {
    kept.push(...Object.entries(await normalizeAnswerPatch(fieldByKey, { [fieldKey]: value }).catch(() => ({}))))
  }

  // Defined, never assigned, so no key can reach a prototype.
  return Object.fromEntries(kept)
}

/**
 * Removes submitted values that still match the signer's page baseline.
 *
 * @param submittedValues - Current normalized values from the signer.
 * @param baselineValues - Optional normalized values displayed when the page loaded.
 * @returns Values intentionally changed by the signer.
 */
export function deriveChangedAnswerPatch(
  submittedValues: Record<string, unknown>,
  baselineValues: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (baselineValues === undefined) {
    return { ...submittedValues }
  }

  const changedValues: Record<string, unknown> = {}

  for (const [fieldKey, value] of Object.entries(submittedValues)) {
    if (
      !Object.prototype.hasOwnProperty.call(baselineValues, fieldKey) ||
      !isDeepStrictEqual(value, baselineValues[fieldKey])
    ) {
      changedValues[fieldKey] = value
    }
  }

  return changedValues
}

/**
 * Removes conditional field values that are hidden in their current state.
 *
 * Unknown persisted keys are preserved for backward compatibility; untrusted
 * patches still pass through `normalizeAnswerPatch`, which rejects unknown keys.
 *
 * @param content - Validated immutable template snapshot.
 * @param values - Stored or effective answer values to sanitize.
 * @returns A copy without values for currently hidden template fields.
 */
export function pruneHiddenAnswerValues(
  content: TemplateContent,
  values: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  return pruneHiddenTemplateFieldValues(content, values)
}

/**
 * Keeps only patch entries visible after applying the patch to stored answers.
 *
 * Stored answers are first pruned under their pre-patch visibility state so a
 * previously hidden stale value cannot reappear when its controller changes.
 *
 * @param content - Validated immutable template snapshot.
 * @param storedValues - Current persisted answer values.
 * @param patch - Fully normalized known-field answer patch.
 * @returns Patch entries that are visible in the effective merged state.
 */
export function pruneHiddenAnswerPatch(
  content: TemplateContent,
  storedValues: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const visibleStoredValues = pruneHiddenAnswerValues(content, storedValues)
  const effectiveValues = {
    ...visibleStoredValues,
    ...patch
  }
  const visibleFieldKeys = collectVisibleFieldKeys(content, effectiveValues)

  return Object.fromEntries(
    Object.entries(patch).filter(([fieldKey]): boolean =>
      visibleFieldKeys.has(fieldKey)
    )
  )
}

/**
 * The answers a formula is worked out from, for the database to refuse the
 * save once someone else has changed them; none when nothing is worked out.
 *
 * @param content - Validated immutable template snapshot.
 * @param storedValues - Answers as read before working anything out.
 * @returns The stored answers, or undefined without a formula.
 */
export function calculationBase(
  content: TemplateContent,
  storedValues: Record<string, unknown>
): Record<string, unknown> | undefined {
  return calculatedFieldKeys(content.blocks).length > 0 ? storedValues : undefined
}

/**
 * Puts what each formula works out into a visible answer patch, from the
 * stored answers with the patch over them; what a page sent for one counts
 * for nothing. A worked-out answer that has not changed stays out, so a
 * signer agreeing to it is never seen to rewrite it.
 *
 * @param content - Validated immutable template snapshot.
 * @param storedValues - Answers already stored.
 * @param patch - Visible normalized patch.
 * @returns The patch with every changed worked-out answer, hidden ones removed.
 */
export function withCalculatedAnswers(
  content: TemplateContent,
  storedValues: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const keys = calculatedFieldKeys(content.blocks)

  if (keys.length === 0) {
    return { ...patch }
  }

  const calculated = calculateTemplateAnswers(content, { ...storedValues, ...patch })
  const next: Record<string, unknown> = { ...patch }

  for (const fieldKey of keys) {
    if (calculated[fieldKey] !== undefined && (fieldKey in patch || !isDeepStrictEqual(calculated[fieldKey], storedValues[fieldKey]))) {
      next[fieldKey] = calculated[fieldKey]
    }
  }

  return pruneHiddenAnswerPatch(content, storedValues, next)
}

/**
 * Requires every non-drawing required answer before the final signer completes.
 *
 * @param content - Validated immutable template snapshot.
 * @param fieldByKey - Snapshot fields indexed by field key.
 * @param values - Effective stored answers after applying the signer's patch.
 * @param requireComplete - Whether this signer would complete the workflow.
 * @throws DocumentSigningServiceError when a required answer is incomplete.
 */
export function assertRequiredAnswersComplete(
  content: TemplateContent,
  fieldByKey: Map<string, FieldBlock>,
  values: Record<string, unknown>,
  requireComplete: boolean
): void {
  if (!requireComplete) {
    return
  }

  const visibleFieldKeys = collectVisibleFieldKeys(content, values)

  for (const block of fieldByKey.values()) {
    if (
      block.required &&
      visibleFieldKeys.has(block.fieldKey) &&
      block.type !== "signature_field" &&
      block.type !== "initials_field" &&
      !isTemplateAnswerComplete(block, values[block.fieldKey])
    ) {
      throw new DocumentSigningServiceError(
        `${block.label} must be completed before the final signature.`,
        400
      )
    }
  }
}

/**
 * Determines whether a snapshot requires one signer's initials drawing.
 *
 * @param content - Validated immutable template snapshot.
 * @param values - Effective answer state used to resolve conditional fields.
 * @param signer - The signer's place in the order they were added.
 * @returns `true` when a visible required initials box is theirs.
 */
export function templateRequiresRecipientInitials(
  content: TemplateContent,
  values: Readonly<Record<string, unknown>>,
  signer: number
): boolean {
  return templateRequiresVisibleInitials(content, values, signer)
}

function collectVisibleFieldKeys(
  content: TemplateContent,
  values: Readonly<Record<string, unknown>>
): ReadonlySet<string> {
  return new Set(
    getVisibleTemplateBlocks(content, values).flatMap(
      (block: TemplateBlock): string[] =>
        "fieldKey" in block ? [block.fieldKey] : []
    )
  )
}

async function normalizeFieldAnswer(
  block: FieldBlock,
  value: unknown,
  sender: { sent: boolean } | undefined
): Promise<unknown> {
  if (block.type === "signature_field" || block.type === "initials_field") {
    // A drawn box is its signer's own act. Only the sender's box takes a
    // drawing as an answer, from the sender, until it is sent; a signer's
    // drawing is captured with their signature, so no one signs for another.
    if (!sender || boxSigner(block) !== "sender") {
      throw new DocumentSigningServiceError(
        `${block.label} is signed in the signing step, not answered.`,
        400
      )
    }

    if (sender.sent) {
      throw new DocumentSigningServiceError(
        "This document was sent for signing, so the sender's signature can no longer change.",
        409
      )
    }

    return (await normalizeOptionalDrawing(value, block.label))?.dataUrl ?? ""
  }

  return normalizeTemplateAnswer(
    block,
    value,
    (message: string) => new DocumentSigningServiceError(message, 400)
  )
}
