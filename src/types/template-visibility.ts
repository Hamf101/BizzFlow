import { boxSigner } from "@/types/box-signers"
import type {
  TemplateBlock,
  TemplateContent,
  TemplateVisibility,
  TemplateVisibilityCondition
} from "@/types/template"

/** The tests in a rule, whichever way it is written. */
export function visibilityConditions(rule: TemplateVisibility | undefined): TemplateVisibilityCondition[] {
  return rule === undefined ? [] : "conditions" in rule ? rule.conditions : [rule]
}

const TEST_WORDS: Record<TemplateVisibilityCondition["operator"], string> = {
  answered: "is answered",
  equals: "is",
  greater_than: "is more than",
  less_than: "is less than",
  not_answered: "is not answered",
  not_equals: "is not",
}

/**
 * A block's rule in words, as a blank form prints it above what it shows:
 * "Pets is ticked", "Income is more than 50000 and Status is not Retired".
 *
 * @param content - Canonical content holding the rule's sources.
 * @param block - A block from the same content.
 * @returns The rule's tests joined by "and" or "or", or null without a rule.
 */
export function describeVisibilityRule(content: TemplateContent, block: TemplateBlock): string | null {
  const rule = "visibleWhen" in block ? block.visibleWhen : undefined

  if (rule === undefined) {
    return null
  }

  const tests = visibilityConditions(rule).map(({ operator, sourceBlockId, value }): string => {
    const source = content.blocks.find((candidate: TemplateBlock): boolean => candidate.id === sourceBlockId)
    // A long question is cut, so the cue stays one line on most pages.
    const label = source && "label" in source ? clip(source.label.trim(), 60) : "an earlier answer"

    if (typeof value === "boolean") {
      return `${label} is ${value === (operator === "equals") ? "" : "not "}ticked`
    }

    const words = source?.type === "dropdown_field" && source.multiple && operator === "equals" ? "includes" : TEST_WORDS[operator]

    // An amount reads as written on the form: "£50,270".
    const amount =
      source?.type === "text_field" && (source.format === "number" || source.format === "money") && /^-?\d+(?:\.\d+)?$/.test(value ?? "")
        ? `${source.prefix ?? ""}${(value ?? "").replace(/^(-?\d+)/, (whole) => whole.replace(/\B(?=(\d{3})+$)/g, ","))}`
        : value

    return amount === undefined ? `${label} ${words}` : `${label} ${words} ${clip(amount, 60)}`
  })

  return tests.join("conditions" in rule && rule.match === "any" ? " or " : " and ")
}

function clip(words: string, length: number): string {
  return words.length > length ? `${words.slice(0, length - 1).trimEnd()}…` : words
}

/**
 * Determines whether one canonical template block is visible for the supplied
 * answer state.
 *
 * Version-two snapshots remain fully visible. A version-three block with a
 * rule shows when all, or any, of its tests hold. A test holds only while its
 * earlier source is itself visible. An unanswered checkbox uses
 * `checkedByDefault`; any other unanswered source reads as blank.
 *
 * @param content - Parsed immutable template content.
 * @param block - Block from the same canonical template.
 * @param values - Current scalar answers keyed by stable field key.
 * @returns `true` when the block should participate in rendering or validation.
 */
export function isTemplateBlockVisible(
  content: TemplateContent,
  block: TemplateBlock,
  values: Readonly<Record<string, unknown>>
): boolean {
  return isTemplateBlockVisibleInternal(content, block, values, new Set())
}

/**
 * Filters canonical blocks using the shared conditional-visibility semantics.
 *
 * @param content - Parsed immutable template content.
 * @param values - Current scalar answers keyed by stable field key.
 * @returns Visible blocks in their original canonical order.
 */
export function getVisibleTemplateBlocks(
  content: TemplateContent,
  values: Readonly<Record<string, unknown>>
): TemplateBlock[] {
  return content.blocks.filter((block: TemplateBlock): boolean =>
    isTemplateBlockVisible(content, block, values)
  )
}

/**
 * Removes values belonging to template fields that are hidden in the supplied
 * answer state while preserving unknown persisted keys for compatibility.
 *
 * @param content - Canonical template containing the field definitions.
 * @param values - Current answer state keyed by stable field key.
 * @returns A new answer object without values for hidden template fields.
 */
export function pruneHiddenTemplateFieldValues(
  content: TemplateContent,
  values: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const visibleFieldKeys = new Set(
    getVisibleTemplateBlocks(content, values).flatMap(
      (block: TemplateBlock): string[] =>
        "fieldKey" in block ? [block.fieldKey] : []
    )
  )
  const templateFieldKeys = new Set(
    content.blocks.flatMap((block: TemplateBlock): string[] =>
      "fieldKey" in block ? [block.fieldKey] : []
    )
  )

  return Object.fromEntries(
    Object.entries(values).filter(
      ([fieldKey]): boolean =>
        !templateFieldKeys.has(fieldKey) || visibleFieldKeys.has(fieldKey)
    )
  )
}

/**
 * Applies one browser field change using the same pre-prune, merge, post-prune
 * ordering as the persistence boundary.
 *
 * @param content - Canonical template containing visibility rules.
 * @param currentValues - Current browser answer state.
 * @param fieldKey - Stable key of the changed field.
 * @param value - New normalized browser value.
 * @returns Effective visible answer state after the change.
 */
export function applyVisibleTemplateFieldValue(
  content: TemplateContent,
  currentValues: Readonly<Record<string, unknown>>,
  fieldKey: string,
  value: unknown
): Record<string, unknown> {
  const visibleCurrentValues = pruneHiddenTemplateFieldValues(
    content,
    currentValues
  )

  return pruneHiddenTemplateFieldValues(content, {
    ...visibleCurrentValues,
    [fieldKey]: value
  })
}

/**
 * Determines whether the visible template state requires one signer's initials
 * drawing: only a required initials box of their own does.
 *
 * @param content - Canonical template containing initials fields.
 * @param values - Current answer state used to resolve visibility.
 * @param signer - The signer's place in the order they were added.
 * @returns `true` when a visible initials field of theirs is required.
 */
export function templateRequiresVisibleInitials(
  content: TemplateContent,
  values: Readonly<Record<string, unknown>>,
  signer: number
): boolean {
  const visibleBlockIds = new Set(
    getVisibleTemplateBlocks(content, values).map(
      (block: TemplateBlock): string => block.id
    )
  )

  return content.blocks.some(
    (block: TemplateBlock): boolean =>
      block.type === "initials_field" &&
      block.required &&
      boxSigner(block) === signer &&
      visibleBlockIds.has(block.id)
  )
}

function isTemplateBlockVisibleInternal(
  content: TemplateContent,
  block: TemplateBlock,
  values: Readonly<Record<string, unknown>>,
  visitedBlockIds: ReadonlySet<string>
): boolean {
  if (content.schemaVersion !== 3 || !("visibleWhen" in block) || block.visibleWhen === undefined) {
    return true
  }

  if (visitedBlockIds.has(block.id)) {
    return false
  }

  const nextVisitedBlockIds = new Set(visitedBlockIds).add(block.id)
  const holds = (condition: TemplateVisibilityCondition): boolean => {
    const source = content.blocks.find((candidate: TemplateBlock): boolean => candidate.id === condition.sourceBlockId)

    return (
      source !== undefined &&
      "fieldKey" in source &&
      isTemplateBlockVisibleInternal(content, source, values, nextVisitedBlockIds) &&
      testCondition(condition, readEffectiveSourceValue(source, values))
    )
  }
  const rule = block.visibleWhen

  return "conditions" in rule && rule.match === "any"
    ? rule.conditions.some(holds)
    : visibilityConditions(rule).every(holds)
}

function testCondition(condition: TemplateVisibilityCondition, answer: boolean | string | unknown[]): boolean {
  const { operator, value } = condition
  const answered = Array.isArray(answer) ? answer.length > 0 : typeof answer === "string" ? answer.trim() !== "" : answer

  switch (operator) {
    case "answered":
      return answered
    case "not_answered":
      return !answered
    case "greater_than":
    case "less_than": {
      const number = readNumber(answer)
      const limit = Number(value)

      return number !== null && (operator === "greater_than" ? number > limit : number < limit)
    }
    default: {
      // "Equals" on several choices means the value is among those ticked;
      // typed words match whatever their case and spacing.
      const equal = Array.isArray(answer)
        ? answer.includes(value)
        : typeof answer === "string" && typeof value === "string"
          ? answer.trim().toLowerCase() === value.trim().toLowerCase()
          : Object.is(answer, value)

      return operator === "equals" ? equal : !equal
    }
  }
}

// A typed number or amount, its thousands commas allowed; anything else is not one.
function readNumber(answer: unknown): number | null {
  const text = typeof answer === "string" ? answer.replace(/,/g, "").trim() : ""

  return /^-?\d+(?:\.\d+)?$/.test(text) ? Number(text) : null
}

function readEffectiveSourceValue(
  sourceBlock: Extract<TemplateBlock, { fieldKey: string }>,
  values: Readonly<Record<string, unknown>>
): boolean | string | unknown[] {
  const value = Object.prototype.hasOwnProperty.call(values, sourceBlock.fieldKey) ? values[sourceBlock.fieldKey] : undefined

  if (sourceBlock.type === "checkbox_field") {
    return value === undefined ? sourceBlock.checkedByDefault : value === true
  }

  if (sourceBlock.type === "dropdown_field" && sourceBlock.multiple) {
    return Array.isArray(value) ? value : []
  }

  return typeof value === "string" ? value : ""
}
