import { normalizeOptionalDrawing } from "@/services/document-signing/drawing-validation"
import {
  SubmissionDomainError,
  type SubmissionAnswers,
  type SubmissionAnswerValue,
} from "@/types/submission"
import type { TemplateBlock, TemplateContent } from "@/types/template"

const MAX_TEXT_ANSWER_LENGTH = 20_000

type SubmissionFieldBlock = Extract<TemplateBlock, { fieldKey: string }>

/**
 * Validates and normalizes a possibly incomplete draft answer object.
 *
 * File values are intentionally excluded because file metadata is persisted in
 * `submission_files`; a file field is completed only after storage verification.
 *
 * @param snapshot - Validated immutable template snapshot for the submission.
 * @param answers - Untrusted answer JSON from a form or persistence boundary.
 * @returns Normalized scalar and drawing answers keyed by template field key.
 * @throws SubmissionDomainError when the object contains unknown fields or invalid values.
 */
export async function normalizeSubmissionDraftAnswers(
  snapshot: TemplateContent,
  answers: unknown
): Promise<SubmissionAnswers> {
  if (!isPlainRecord(answers)) {
    throw invalidAnswers("Submission answers must be a JSON object.")
  }

  const fieldByKey = collectSubmissionFields(snapshot)
  const normalizedAnswers: SubmissionAnswers = {}

  for (const [fieldKey, value] of Object.entries(answers)) {
    const field = fieldByKey.get(fieldKey)

    if (!field) {
      throw invalidAnswers(
        `Submission field ${fieldKey} is not part of this template snapshot.`
      )
    }

    normalizedAnswers[fieldKey] = await normalizeFieldAnswer(field, value)
  }

  return normalizedAnswers
}

/**
 * Normalizes all answers and requires every mandatory field before submission.
 *
 * @param snapshot - Validated immutable template snapshot for the submission.
 * @param answers - Complete untrusted answer JSON to validate.
 * @param availableFileFieldKeys - File field keys with verified available objects.
 * @returns Normalized answers safe to persist with the submitted record.
 * @throws SubmissionDomainError when answers are invalid or a required field is incomplete.
 */
export async function validateSubmissionForSubmit(
  snapshot: TemplateContent,
  answers: unknown,
  availableFileFieldKeys: ReadonlySet<string>
): Promise<SubmissionAnswers> {
  const fieldByKey = collectSubmissionFields(snapshot)
  assertAvailableFileFieldKeys(fieldByKey, availableFileFieldKeys)
  const normalizedAnswers = await normalizeSubmissionDraftAnswers(
    snapshot,
    answers
  )

  for (const field of fieldByKey.values()) {
    if (!field.required) {
      continue
    }

    const isComplete =
      field.type === "file_field"
        ? availableFileFieldKeys.has(field.fieldKey)
        : isRequiredAnswerComplete(field, normalizedAnswers[field.fieldKey])

    if (!isComplete) {
      throw new SubmissionDomainError(
        `${field.label} must be completed before this submission can be submitted.`,
        "incomplete_submission",
        400
      )
    }
  }

  return normalizedAnswers
}

function collectSubmissionFields(
  snapshot: TemplateContent
): Map<string, SubmissionFieldBlock> {
  const fieldByKey = new Map<string, SubmissionFieldBlock>()

  for (const section of Object.values(snapshot.sections)) {
    for (const block of section.blocks) {
      if (!("fieldKey" in block)) {
        continue
      }

      if (fieldByKey.has(block.fieldKey)) {
        throw new SubmissionDomainError(
          `Submission template field ${block.fieldKey} is duplicated.`,
          "invalid_submission_snapshot",
          500
        )
      }

      fieldByKey.set(block.fieldKey, block)
    }
  }

  return fieldByKey
}

async function normalizeFieldAnswer(
  field: SubmissionFieldBlock,
  value: unknown
): Promise<SubmissionAnswerValue> {
  if (field.type === "file_field") {
    throw invalidAnswers(`${field.label} must be uploaded as a file.`)
  }

  if (field.type === "checkbox_field") {
    if (typeof value !== "boolean") {
      throw invalidAnswers(`${field.label} must be checked or unchecked.`)
    }

    return value
  }

  if (typeof value !== "string") {
    throw invalidAnswers(`${field.label} must be text.`)
  }

  const normalizedValue = value.trim()

  if (field.type === "signature_field" || field.type === "initials_field") {
    if (normalizedValue.length === 0) {
      return ""
    }

    try {
      const drawing = await normalizeOptionalDrawing(
        normalizedValue,
        field.label
      )
      return drawing?.dataUrl ?? ""
    } catch {
      throw invalidAnswers(
        `The drawn ${field.label.toLowerCase()} is invalid.`
      )
    }
  }

  if (normalizedValue.length > MAX_TEXT_ANSWER_LENGTH) {
    throw invalidAnswers(`${field.label} is too long.`)
  }

  if (field.type === "date_field" && normalizedValue.length > 0) {
    assertValidDateAnswer(field.label, normalizedValue)
  }

  if (
    field.type === "dropdown_field" &&
    normalizedValue.length > 0 &&
    !field.options.includes(normalizedValue)
  ) {
    throw invalidAnswers(
      `${field.label} must use one of the available options.`
    )
  }

  return normalizedValue
}

function assertAvailableFileFieldKeys(
  fieldByKey: Map<string, SubmissionFieldBlock>,
  availableFileFieldKeys: ReadonlySet<string>
): void {
  for (const fieldKey of availableFileFieldKeys) {
    const field = fieldByKey.get(fieldKey)

    if (!field || field.type !== "file_field") {
      throw invalidAnswers(
        `Available file field ${fieldKey} is not part of this template snapshot.`
      )
    }
  }
}

function assertValidDateAnswer(label: string, value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidAnswers(`${label} must use YYYY-MM-DD format.`)
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`)

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== value
  ) {
    throw invalidAnswers(`${label} must be a valid date.`)
  }
}

function isRequiredAnswerComplete(
  field: Exclude<SubmissionFieldBlock, { type: "file_field" }>,
  value: SubmissionAnswerValue | undefined
): boolean {
  if (field.type === "checkbox_field") {
    return value === true
  }

  return typeof value === "string" && value.length > 0
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

function invalidAnswers(message: string): SubmissionDomainError {
  return new SubmissionDomainError(
    message,
    "invalid_submission_answers",
    400
  )
}
