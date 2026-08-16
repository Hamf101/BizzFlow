import {
  templateContentV2Schema,
  templateContentV3Schema,
  type TemplateBlock,
  type TemplateContent
} from "@/types/template"

import { createTemplateRenderPlan } from "./template-render-plan"

/** Severity assigned to one deterministic template usability finding. */
export type TemplateQualitySeverity = "critical" | "warning"

/** Stable identifiers used to render and track template usability findings. */
export type TemplateQualityIssueCode =
  | "missing_title"
  | "invalid_template_metadata"
  | "blank_heading"
  | "blank_field_label"
  | "blank_section_label"
  | "blank_field_group_label"
  | "blank_custom_printed_title"
  | "invalid_template_content"
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
const MAX_TEMPLATE_TITLE_LENGTH = 180
const MAX_TEMPLATE_DESCRIPTION_LENGTH = 2_000

const GENERIC_FIELD_LABELS = new Set<string>([
  "text field",
  "date field",
  "checkbox",
  "dropdown",
  "initials field",
  "signature field",
  "file upload"
])

const SAVE_BLOCKING_ISSUE_CODES: ReadonlySet<TemplateQualityIssueCode> =
  new Set<TemplateQualityIssueCode>([
    "missing_title",
    "invalid_template_metadata",
    "blank_heading",
    "blank_field_label",
    "blank_section_label",
    "blank_field_group_label",
    "blank_custom_printed_title",
    "invalid_template_content"
  ])

type TemplateContentValidation =
  | Readonly<{
      success: true
      content: TemplateContent
    }>
  | Readonly<{
      success: false
      issues: readonly Readonly<{ path: readonly PropertyKey[] }>[]
    }>

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
  const contentValidation = validateTemplateContent(input.content)
  const content = contentValidation.success
    ? contentValidation.content
    : input.content
  const { blocks } = content
  const normalizedTitle = input.title.trim()
  const description = input.description ?? ""

  if (normalizedTitle.length === 0) {
    issues.push({
      code: "missing_title",
      severity: "critical",
      message: "Add a template title before saving or publishing.",
      affectedBlockIds: []
    })
  }

  if (
    normalizedTitle.length > MAX_TEMPLATE_TITLE_LENGTH ||
    description.length > MAX_TEMPLATE_DESCRIPTION_LENGTH
  ) {
    issues.push({
      code: "invalid_template_metadata",
      severity: "critical",
      message:
        "Keep the template title within 180 characters and the description within 2,000 characters.",
      affectedBlockIds: []
    })
  }

  const blankHeadingIds = blocks
    .filter(
      (
        block: TemplateBlock
      ): block is Extract<TemplateBlock, { type: "heading" }> =>
        block.type === "heading" && block.text.trim().length === 0
    )
    .map((block: TemplateBlock): string => block.id)

  if (blankHeadingIds.length > 0) {
    issues.push({
      code: "blank_heading",
      severity: "critical",
      message: "Give every heading visible text before saving or publishing.",
      affectedBlockIds: blankHeadingIds
    })
  }

  const blankFieldLabelIds = blocks
    .filter(
      (block: TemplateBlock): block is Extract<TemplateBlock, { label: string }> =>
        isFieldBlock(block) && block.label.trim().length === 0
    )
    .map((block: TemplateBlock): string => block.id)

  if (blankFieldLabelIds.length > 0) {
    issues.push({
      code: "blank_field_label",
      severity: "critical",
      message: "Give every fillable field a visible label before saving or publishing.",
      affectedBlockIds: blankFieldLabelIds
    })
  }

  if (content.schemaVersion === 3) {
    const blankSectionStartBlockIds = content.sections
      .filter((section): boolean => section.label.trim().length === 0)
      .map((section): string => section.startBlockId)

    if (blankSectionStartBlockIds.length > 0) {
      issues.push({
        code: "blank_section_label",
        severity: "critical",
        message: "Give every section a visible label before saving or publishing.",
        affectedBlockIds: blankSectionStartBlockIds
      })
    }

    const blankFieldGroupStartBlockIds = content.fieldGroups
      .filter(
        (group): boolean =>
          group.label !== null && group.label.trim().length === 0
      )
      .map((group): string => group.startBlockId)

    if (blankFieldGroupStartBlockIds.length > 0) {
      issues.push({
        code: "blank_field_group_label",
        severity: "critical",
        message:
          "Give every named field group a visible label before saving or publishing.",
        affectedBlockIds: blankFieldGroupStartBlockIds
      })
    }

    if (
      content.layout.printedTitle.mode === "custom" &&
      content.layout.printedTitle.text.trim().length === 0
    ) {
      issues.push({
        code: "blank_custom_printed_title",
        severity: "critical",
        message:
          "Enter a custom printed title, or switch the title source back to the template title.",
        affectedBlockIds: []
      })
    }
  }

  if (!contentValidation.success) {
    const unhandledIssues = contentValidation.issues.filter(
      (issue): boolean => !isHandledBlankContentIssue(issue.path, input.content)
    )

    if (unhandledIssues.length > 0) {
      issues.push({
        code: "invalid_template_content",
        severity: "critical",
        message:
          "Fix invalid or incomplete content before saving. Review required text, choices, images, field keys, and structure settings.",
        affectedBlockIds: getAffectedBlockIds(
          unhandledIssues.map((issue) => issue.path),
          input.content.blocks
        )
      })
    }
  }

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
  const metadataHasUnresolvedMarker = [input.title, description].some(
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
      severity: content.schemaVersion === 3 ? "critical" : "warning",
      message: "Use lowercase snake_case field keys.",
      affectedBlockIds: invalidFieldKeyIds
    })
  }

  const renderPlan = contentValidation.success
    ? createTemplateRenderPlan({
        title: input.title,
        content,
        mode: "build"
      })
    : null
  const normalizedPrintedTitle = normalizeComparableText(
    renderPlan?.title ?? resolvePotentialPrintedTitle(input.title, content)
  )
  const duplicateTitleHeadingIds =
    normalizedPrintedTitle.length === 0
      ? []
      : blocks
          .filter(
            (
              block: TemplateBlock
            ): block is Extract<TemplateBlock, { type: "heading" }> =>
              block.type === "heading" &&
              block.level === 1 &&
              normalizeComparableText(block.text) === normalizedPrintedTitle
          )
          .map((block): string => block.id)

  if (duplicateTitleHeadingIds.length > 0) {
    issues.push({
      code: "duplicate_title_heading",
      severity: content.schemaVersion === 3 ? "critical" : "warning",
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

  if (description.trim().length === 0) {
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

/**
 * Reports whether one finding represents invalid data that cannot be saved.
 *
 * Drafts may retain incomplete but schema-valid work, while malformed metadata
 * or content must be corrected before any persistence action.
 *
 * @param issue - One deterministic quality or validation finding.
 * @returns True when the issue must block both draft saves and publication.
 */
export function isTemplateQualityIssueSaveBlocking(
  issue: TemplateQualityIssue
): boolean {
  return SAVE_BLOCKING_ISSUE_CODES.has(issue.code)
}

function hasNeedsInputMarker(value: string): boolean {
  return NEEDS_INPUT_PATTERN.test(value)
}

function validateTemplateContent(
  content: TemplateContent
): TemplateContentValidation {
  const result =
    content.schemaVersion === 3
      ? templateContentV3Schema.safeParse(content)
      : templateContentV2Schema.safeParse(content)

  if (result.success) {
    return { success: true, content: result.data }
  }

  return {
    success: false,
    issues: result.error.issues.map(
      (issue): Readonly<{ path: readonly PropertyKey[] }> => ({
        path: issue.path
      })
    )
  }
}

function isHandledBlankContentIssue(
  path: readonly PropertyKey[],
  content: TemplateContent
): boolean {
  const collectionName = path[0]
  const itemIndex = path[1]
  const propertyName = path[2]

  if (collectionName === "blocks" && typeof itemIndex === "number") {
    const block = content.blocks[itemIndex]

    if (block === undefined) {
      return false
    }

    return (
      (block.type === "heading" &&
        propertyName === "text" &&
        block.text.trim().length === 0) ||
      (isFieldBlock(block) &&
        propertyName === "label" &&
        block.label.trim().length === 0)
    )
  }

  if (content.schemaVersion !== 3) {
    return false
  }

  if (
    collectionName === "sections" &&
    typeof itemIndex === "number" &&
    propertyName === "label"
  ) {
    return content.sections[itemIndex]?.label.trim().length === 0
  }

  if (
    collectionName === "fieldGroups" &&
    typeof itemIndex === "number" &&
    propertyName === "label"
  ) {
    const label = content.fieldGroups[itemIndex]?.label
    return label !== null && label !== undefined && label.trim().length === 0
  }

  return (
    collectionName === "layout" &&
    itemIndex === "printedTitle" &&
    propertyName === "text" &&
    content.layout.printedTitle.mode === "custom" &&
    content.layout.printedTitle.text.trim().length === 0
  )
}

function getAffectedBlockIds(
  paths: readonly (readonly PropertyKey[])[],
  blocks: readonly TemplateBlock[]
): string[] {
  const blockIds = new Set<string>()

  for (const path of paths) {
    if (path[0] !== "blocks" || typeof path[1] !== "number") {
      continue
    }

    const blockId = blocks[path[1]]?.id

    if (blockId !== undefined) {
      blockIds.add(blockId)
    }
  }

  return [...blockIds]
}

function resolvePotentialPrintedTitle(
  title: string,
  content: TemplateContent
): string {
  return content.schemaVersion === 3 &&
    content.layout.printedTitle.mode === "custom"
    ? content.layout.printedTitle.text
    : title
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
