import { normalizeRequiredDrawing } from "@/services/document-signing/drawing-validation"
import { DocumentSigningServiceError } from "@/services/document-signing/errors"
import type { TemplateBlock, TemplateContent } from "@/types/template"

/** Fillable template block indexed by its stable field key. */
export type FieldBlock = Extract<TemplateBlock, { fieldKey: string }>

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
 * @returns Normalized answer patch containing only known fields.
 * @throws DocumentSigningServiceError when a field or value is invalid.
 */
export async function normalizeAnswerPatch(
  fieldByKey: Map<string, FieldBlock>,
  patch: Record<string, unknown>
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

    normalizedPatch[fieldKey] = await normalizeFieldAnswer(block, value)
  }

  return normalizedPatch
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
      !Object.is(value, baselineValues[fieldKey])
    ) {
      changedValues[fieldKey] = value
    }
  }

  return changedValues
}

/**
 * Requires every non-drawing required answer before the final signer completes.
 *
 * @param fieldByKey - Snapshot fields indexed by field key.
 * @param values - Effective stored answers after applying the signer's patch.
 * @param requireComplete - Whether this signer would complete the workflow.
 * @throws DocumentSigningServiceError when a required answer is incomplete.
 */
export function assertRequiredAnswersComplete(
  fieldByKey: Map<string, FieldBlock>,
  values: Record<string, unknown>,
  requireComplete: boolean
): void {
  if (!requireComplete) {
    return
  }

  for (const block of fieldByKey.values()) {
    if (
      block.required &&
      block.type !== "signature_field" &&
      block.type !== "initials_field" &&
      !isRequiredAnswerComplete(block, values[block.fieldKey])
    ) {
      throw new DocumentSigningServiceError(
        `${block.label} must be completed before the final signature.`,
        400
      )
    }
  }
}

/**
 * Determines whether a snapshot requires a separate recipient initials drawing.
 *
 * @param content - Validated immutable template snapshot.
 * @returns `true` when at least one required initials field exists.
 */
export function templateRequiresRecipientInitials(
  content: TemplateContent
): boolean {
  for (const block of content.blocks) {
    if (block.type === "initials_field" && block.required) {
      return true
    }
  }

  return false
}

async function normalizeFieldAnswer(
  block: FieldBlock,
  value: unknown
): Promise<unknown> {
  if (block.type === "checkbox_field") {
    if (typeof value !== "boolean") {
      throw new DocumentSigningServiceError(
        `${block.label} must be checked or unchecked.`,
        400
      )
    }

    return value
  }

  if (typeof value !== "string") {
    throw new DocumentSigningServiceError(`${block.label} must be text.`, 400)
  }

  const normalizedValue = value.trim()

  if (block.type === "signature_field" || block.type === "initials_field") {
    return normalizedValue.length === 0
      ? ""
      : (await normalizeRequiredDrawing(normalizedValue, block.label)).dataUrl
  }

  if (normalizedValue.length > 20_000) {
    throw new DocumentSigningServiceError(`${block.label} is too long.`, 400)
  }

  if (block.type === "date_field" && normalizedValue.length > 0) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
      throw new DocumentSigningServiceError(
        `${block.label} must use YYYY-MM-DD format.`,
        400
      )
    }

    const parsedDate = new Date(`${normalizedValue}T00:00:00.000Z`)

    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== normalizedValue
    ) {
      throw new DocumentSigningServiceError(
        `${block.label} must be a valid date.`,
        400
      )
    }
  }

  if (
    block.type === "dropdown_field" &&
    normalizedValue.length > 0 &&
    !block.options.includes(normalizedValue)
  ) {
    throw new DocumentSigningServiceError(
      `${block.label} must use one of the available options.`,
      400
    )
  }

  return normalizedValue
}

function isRequiredAnswerComplete(block: FieldBlock, value: unknown): boolean {
  if (block.type === "checkbox_field") {
    return value === true
  }

  return typeof value === "string" && value.trim().length > 0
}
