import type { TemplateBlock, TemplateContent } from "@/types/template"

const ANSWER_TEXT_PREFIX = "answer.text."
const ANSWER_BOOLEAN_PREFIX = "answer.boolean."
const ANSWER_DRAWING_PREFIX = "answer.drawing."
const BASELINE_TEXT_PREFIX = "answer-baseline.text."
const BASELINE_BOOLEAN_PREFIX = "answer-baseline.boolean."

export type GeneratedDocumentAnswerKind = "text" | "boolean" | "drawing"

export type GeneratedDocumentAnswerBaselineField = {
  name: string
  value: string
}

type GeneratedDocumentFormDataParserOptions = {
  booleanPrefix: string
  drawingPrefix?: string
  malformedBooleanMessage: string
  textPrefix: string
}

/** Error raised when dynamic document form data cannot be normalized safely. */
export class GeneratedDocumentFormDataError extends Error {
  /**
   * Creates a user-safe dynamic form error.
   *
   * @param message - Explanation suitable for an action error alert.
   */
  constructor(message: string) {
    super(message)
    this.name = "GeneratedDocumentFormDataError"
  }
}

/**
 * Builds a namespaced HTML field name for one generated-document answer.
 *
 * @param kind - Value category used for server-side coercion.
 * @param fieldKey - Canonical template field key.
 * @returns A stable form field name.
 */
export function getGeneratedDocumentAnswerName(
  kind: GeneratedDocumentAnswerKind,
  fieldKey: string
): string {
  const prefix = getAnswerPrefix(kind)
  return `${prefix}${fieldKey}`
}

/**
 * Parses namespaced answer inputs into a service-ready value patch.
 *
 * Empty optional drawing inputs are omitted so an existing drawing is not
 * accidentally cleared when another field is saved.
 *
 * @param formData - Submitted generated-document form data.
 * @returns A text, boolean, and drawing answer patch keyed by field key.
 * @throws GeneratedDocumentFormDataError for malformed names or booleans.
 */
export function parseGeneratedDocumentAnswers(
  formData: FormData
): Record<string, unknown> {
  return parseNamespacedGeneratedDocumentAnswers(formData, {
    booleanPrefix: ANSWER_BOOLEAN_PREFIX,
    drawingPrefix: ANSWER_DRAWING_PREFIX,
    malformedBooleanMessage: "A checkbox answer was malformed.",
    textPrefix: ANSWER_TEXT_PREFIX,
  })
}

/**
 * Builds compact hidden baseline fields for concurrency-safe public signing.
 *
 * Only visible shared text and boolean answers are included. Drawing fields are
 * captured separately by the recipient acknowledgement, avoiding duplicated
 * multi-megabyte data URLs in the submitted form.
 *
 * @param content - Immutable document template snapshot.
 * @param answers - Answers visible when the signing page was rendered.
 * @returns Hidden field names and scalar values suitable for a public form.
 */
export function getGeneratedDocumentAnswerBaselineFields(
  content: TemplateContent,
  answers: Record<string, unknown>
): GeneratedDocumentAnswerBaselineField[] {
  const fields: GeneratedDocumentAnswerBaselineField[] = []

  for (const section of Object.values(content.sections)) {
    for (const block of section.blocks) {
      const field = createBaselineField(block, answers)

      if (field) {
        fields.push(field)
      }
    }
  }

  return fields
}

/**
 * Parses page-loaded answer baselines used to identify genuinely edited fields.
 *
 * @param formData - Public signing form containing namespaced hidden baselines.
 * @returns Scalar baseline answers keyed by immutable template field key.
 * @throws GeneratedDocumentFormDataError for malformed names or booleans.
 */
export function parseGeneratedDocumentAnswerBaseline(
  formData: FormData
): Record<string, unknown> {
  return parseNamespacedGeneratedDocumentAnswers(formData, {
    booleanPrefix: BASELINE_BOOLEAN_PREFIX,
    malformedBooleanMessage: "A checkbox answer baseline was malformed.",
    textPrefix: BASELINE_TEXT_PREFIX,
  })
}

function parseNamespacedGeneratedDocumentAnswers(
  formData: FormData,
  options: GeneratedDocumentFormDataParserOptions
): Record<string, unknown> {
  const values: Record<string, unknown> = {}

  for (const [name, entry] of formData.entries()) {
    if (typeof entry !== "string") {
      continue
    }

    if (name.startsWith(options.textPrefix)) {
      values[readFieldKey(name, options.textPrefix)] = entry
      continue
    }

    if (name.startsWith(options.booleanPrefix)) {
      const fieldKey = readFieldKey(name, options.booleanPrefix)

      if (entry !== "true" && entry !== "false") {
        throw new GeneratedDocumentFormDataError(options.malformedBooleanMessage)
      }

      values[fieldKey] = entry === "true"
      continue
    }

    if (
      options.drawingPrefix &&
      name.startsWith(options.drawingPrefix) &&
      entry.trim()
    ) {
      values[readFieldKey(name, options.drawingPrefix)] = entry
    }
  }

  return values
}

function createBaselineField(
  block: TemplateBlock,
  answers: Record<string, unknown>
): GeneratedDocumentAnswerBaselineField | null {
  if (!("fieldKey" in block)) {
    return null
  }

  if (block.type === "checkbox_field") {
    const value = Object.prototype.hasOwnProperty.call(answers, block.fieldKey)
      ? answers[block.fieldKey] === true
      : block.checkedByDefault

    return {
      name: `${BASELINE_BOOLEAN_PREFIX}${block.fieldKey}`,
      value: value ? "true" : "false",
    }
  }

  if (
    block.type === "signature_field" ||
    block.type === "initials_field" ||
    block.type === "file_field"
  ) {
    return null
  }

  const value = answers[block.fieldKey]
  return {
    name: `${BASELINE_TEXT_PREFIX}${block.fieldKey}`,
    value: typeof value === "string" ? value : "",
  }
}

function getAnswerPrefix(kind: GeneratedDocumentAnswerKind): string {
  if (kind === "boolean") {
    return ANSWER_BOOLEAN_PREFIX
  }

  if (kind === "drawing") {
    return ANSWER_DRAWING_PREFIX
  }

  return ANSWER_TEXT_PREFIX
}

function readFieldKey(name: string, prefix: string): string {
  const fieldKey = name.slice(prefix.length)

  if (!fieldKey) {
    throw new GeneratedDocumentFormDataError(
      "A generated-document field key is missing."
    )
  }

  return fieldKey
}
