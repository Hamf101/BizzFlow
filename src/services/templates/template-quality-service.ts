import type { TemplateBlock, TemplateContent } from "@/types/template"

/** Severity assigned to one deterministic template usability finding. */
export type TemplateQualitySeverity = "critical" | "warning"

/** Stable identifiers used to render and track template usability findings. */
export type TemplateQualityIssueCode =
  | "empty_content"
  | "unresolved_needs_input"
  | "dropdown_insufficient_choices"
  | "dropdown_placeholder_choices"
  | "generic_field_label"
  | "invalid_field_key"
  | "duplicate_title_heading"
  | "heading_level_jump"
  | "missing_description"

/** One actionable, high-confidence usability problem in a template draft. */
export type TemplateQualityIssue = Readonly<{
  code: TemplateQualityIssueCode
  severity: TemplateQualitySeverity
  message: string
  affectedBlockIds: readonly string[]
}>

/** Metadata and canonical content evaluated by the template quality service. */
export type EvaluateTemplateQualityInput = Readonly<{
  title: string
  description?: string | null
  content: TemplateContent
}>

/** Aggregate counts used by checks panels and publish gates. */
export type TemplateQualitySummary = Readonly<{
  totalCount: number
  criticalCount: number
  warningCount: number
  isBlocking: boolean
}>

/** Complete deterministic result returned by the template quality service. */
export type TemplateQualityEvaluation = Readonly<{
  issues: readonly TemplateQualityIssue[]
  summary: TemplateQualitySummary
}>

const NEEDS_INPUT_PATTERN = /\bneeds\s+input\s*:/i
const SNAKE_CASE_FIELD_KEY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/
const PLACEHOLDER_CHOICE_PATTERN =
  /^(?:option|choice)\s*(?:[-_#]\s*)?(?:\d+|[a-z]|one|two|three|four|five)$/i

const GENERIC_FIELD_LABELS = new Set<string>([
  "text field",
  "date field",
  "checkbox",
  "dropdown",
  "initials field",
  "signature field",
  "file upload"
])

/**
 * Evaluates a canonical template without changing its metadata or block content.
 *
 * Only deterministic, high-confidence usability problems are reported. The
 * evaluator intentionally does not assess legal correctness or require
 * signature fields.
 *
 * @param input - Template metadata and version-two or version-three content.
 * @returns Ordered issues and a summary whose critical findings are blocking.
 */
export function evaluateTemplateQuality(
  input: EvaluateTemplateQualityInput
): TemplateQualityEvaluation {
  const issues: TemplateQualityIssue[] = []
  const { blocks } = input.content

  if (blocks.length === 0) {
    issues.push({
      code: "empty_content",
      severity: "critical",
      message: "Add content before this template is ready to use.",
      affectedBlockIds: []
    })
  }

  const unresolvedMarkerBlockIds = blocks
    .filter((block: TemplateBlock): boolean =>
      getVisibleBlockText(block).some(hasNeedsInputMarker)
    )
    .map((block: TemplateBlock): string => block.id)
  const metadataHasUnresolvedMarker = [input.title, input.description ?? ""].some(
    hasNeedsInputMarker
  )

  if (
    metadataHasUnresolvedMarker ||
    unresolvedMarkerBlockIds.length > 0
  ) {
    issues.push({
      code: "unresolved_needs_input",
      severity: "critical",
      message:
        'Resolve every visible "Needs input:" marker before this template is ready to use.',
      affectedBlockIds: unresolvedMarkerBlockIds
    })
  }

  const dropdownBlocks = blocks.filter(
    (
      block: TemplateBlock
    ): block is Extract<TemplateBlock, { type: "dropdown_field" }> =>
      block.type === "dropdown_field"
  )
  const insufficientDropdownIds = dropdownBlocks
    .filter(
      (block): boolean =>
        new Set(block.options.map(normalizeComparableText)).size < 2
    )
    .map((block): string => block.id)

  if (insufficientDropdownIds.length > 0) {
    issues.push({
      code: "dropdown_insufficient_choices",
      severity: "critical",
      message: "Dropdown fields need at least two distinct choices.",
      affectedBlockIds: insufficientDropdownIds
    })
  }

  const placeholderDropdownIds = dropdownBlocks
    .filter((block): boolean =>
      block.options.some((option: string): boolean =>
        PLACEHOLDER_CHOICE_PATTERN.test(option.trim())
      )
    )
    .map((block): string => block.id)

  if (placeholderDropdownIds.length > 0) {
    issues.push({
      code: "dropdown_placeholder_choices",
      severity: "critical",
      message: "Replace placeholder dropdown choices with meaningful options.",
      affectedBlockIds: placeholderDropdownIds
    })
  }

  const fieldBlocks = blocks.filter(isFieldBlock)
  const genericFieldLabelIds = fieldBlocks
    .filter((block): boolean =>
      GENERIC_FIELD_LABELS.has(normalizeComparableText(block.label))
    )
    .map((block): string => block.id)

  if (genericFieldLabelIds.length > 0) {
    issues.push({
      code: "generic_field_label",
      severity: "critical",
      message:
        "Replace generic field labels with labels that explain what to enter.",
      affectedBlockIds: genericFieldLabelIds
    })
  }

  const invalidFieldKeyIds = fieldBlocks
    .filter(
      (block): boolean =>
        !SNAKE_CASE_FIELD_KEY_PATTERN.test(block.fieldKey)
    )
    .map((block): string => block.id)

  if (invalidFieldKeyIds.length > 0) {
    issues.push({
      code: "invalid_field_key",
      severity: input.content.schemaVersion === 3 ? "critical" : "warning",
      message: "Use lowercase snake_case field keys.",
      affectedBlockIds: invalidFieldKeyIds
    })
  }

  const normalizedTitle = normalizeComparableText(input.title)
  const duplicateTitleHeadingIds =
    normalizedTitle.length === 0
      ? []
      : blocks
          .filter(
            (
              block: TemplateBlock
            ): block is Extract<TemplateBlock, { type: "heading" }> =>
              block.type === "heading" &&
              block.level === 1 &&
              normalizeComparableText(block.text) === normalizedTitle
          )
          .map((block): string => block.id)

  if (duplicateTitleHeadingIds.length > 0) {
    issues.push({
      code: "duplicate_title_heading",
      severity: input.content.schemaVersion === 3 ? "critical" : "warning",
      message:
        "Remove the level-one heading that repeats the template title.",
      affectedBlockIds: duplicateTitleHeadingIds
    })
  }

  const headingLevelJumpIds = findHeadingLevelJumpIds(blocks)

  if (headingLevelJumpIds.length > 0) {
    issues.push({
      code: "heading_level_jump",
      severity: "warning",
      message:
        "Fix heading levels that skip a level in the document hierarchy.",
      affectedBlockIds: headingLevelJumpIds
    })
  }

  if ((input.description ?? "").trim().length === 0) {
    issues.push({
      code: "missing_description",
      severity: "warning",
      message:
        "Add a short description so authors know when to use this template.",
      affectedBlockIds: []
    })
  }

  return {
    issues,
    summary: summarizeTemplateQuality(issues)
  }
}

/**
 * Summarizes issue counts and whether a template should be blocked.
 *
 * @param issues - Deterministic issues returned by the quality evaluator.
 * @returns Counts by severity and a blocking flag for any critical issue.
 */
export function summarizeTemplateQuality(
  issues: readonly TemplateQualityIssue[]
): TemplateQualitySummary {
  const criticalCount = issues.filter(
    (issue: TemplateQualityIssue): boolean =>
      issue.severity === "critical"
  ).length
  const warningCount = issues.length - criticalCount

  return {
    totalCount: issues.length,
    criticalCount,
    warningCount,
    isBlocking: criticalCount > 0
  }
}

/**
 * Reports whether any quality issue is critical.
 *
 * @param issues - Deterministic issues returned by the quality evaluator.
 * @returns True when at least one issue must block a guarded action.
 */
export function hasBlockingTemplateQualityIssues(
  issues: readonly TemplateQualityIssue[]
): boolean {
  return issues.some(
    (issue: TemplateQualityIssue): boolean =>
      issue.severity === "critical"
  )
}

function hasNeedsInputMarker(value: string): boolean {
  return NEEDS_INPUT_PATTERN.test(value)
}

function normalizeComparableText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

function isFieldBlock(
  block: TemplateBlock
): block is Extract<TemplateBlock, { fieldKey: string }> {
  return "fieldKey" in block
}

function findHeadingLevelJumpIds(
  blocks: readonly TemplateBlock[]
): string[] {
  const affectedBlockIds: string[] = []
  let priorHeadingLevel: 1 | 2 | 3 | undefined

  for (const block of blocks) {
    if (block.type !== "heading") {
      continue
    }

    if (
      priorHeadingLevel !== undefined &&
      block.level > priorHeadingLevel + 1
    ) {
      affectedBlockIds.push(block.id)
    }

    priorHeadingLevel = block.level
  }

  return affectedBlockIds
}

function getVisibleBlockText(block: TemplateBlock): readonly string[] {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return [block.text]
    case "bullet_list":
    case "numbered_list":
      return block.items
    case "image":
      return [block.altText, block.caption ?? ""]
    case "table":
      return [...block.headers, ...block.rows.flat()]
    case "divider":
      return []
    case "text_field":
      return [
        block.label,
        block.helpText ?? "",
        block.placeholder ?? ""
      ]
    case "dropdown_field":
      return [
        block.label,
        block.helpText ?? "",
        block.placeholder ?? "",
        ...block.options
      ]
    case "date_field":
    case "checkbox_field":
    case "initials_field":
    case "signature_field":
    case "file_field":
      return [block.label, block.helpText ?? ""]
  }
}
