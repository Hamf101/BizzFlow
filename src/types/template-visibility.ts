import type {
  CheckboxFieldBlock,
  DropdownFieldBlock,
  TemplateBlock,
  TemplateContent
} from "@/types/template"

type VisibilitySourceBlock = CheckboxFieldBlock | DropdownFieldBlock

/**
 * Determines whether one canonical template block is visible for the supplied
 * answer state.
 *
 * Version-two snapshots remain fully visible. Version-three conditional fields
 * are visible only when their earlier checkbox or dropdown controller is itself
 * visible and its effective value equals the declared condition. An unanswered
 * checkbox uses `checkedByDefault`; an unanswered dropdown uses an empty string.
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
 * Determines whether the visible template state requires a recipient initials
 * drawing.
 *
 * @param content - Canonical template containing initials fields.
 * @param values - Current answer state used to resolve visibility.
 * @returns `true` when a visible initials field is required.
 */
export function templateRequiresVisibleInitials(
  content: TemplateContent,
  values: Readonly<Record<string, unknown>>
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
      visibleBlockIds.has(block.id)
  )
}

function isTemplateBlockVisibleInternal(
  content: TemplateContent,
  block: TemplateBlock,
  values: Readonly<Record<string, unknown>>,
  visitedBlockIds: ReadonlySet<string>
): boolean {
  if (
    content.schemaVersion !== 3 ||
    !("fieldKey" in block) ||
    block.visibleWhen === undefined
  ) {
    return true
  }

  if (visitedBlockIds.has(block.id)) {
    return false
  }

  const sourceBlock = content.blocks.find(
    (candidate: TemplateBlock): boolean =>
      candidate.id === block.visibleWhen?.sourceBlockId
  )

  if (!isVisibilitySourceBlock(sourceBlock)) {
    return false
  }

  const nextVisitedBlockIds = new Set(visitedBlockIds)
  nextVisitedBlockIds.add(block.id)

  if (
    !isTemplateBlockVisibleInternal(
      content,
      sourceBlock,
      values,
      nextVisitedBlockIds
    )
  ) {
    return false
  }

  const effectiveSourceValue = readEffectiveSourceValue(sourceBlock, values)
  return Object.is(effectiveSourceValue, block.visibleWhen.value)
}

function isVisibilitySourceBlock(
  block: TemplateBlock | undefined
): block is VisibilitySourceBlock {
  return (
    block?.type === "checkbox_field" || block?.type === "dropdown_field"
  )
}

function readEffectiveSourceValue(
  sourceBlock: VisibilitySourceBlock,
  values: Readonly<Record<string, unknown>>
): boolean | string {
  if (!Object.prototype.hasOwnProperty.call(values, sourceBlock.fieldKey)) {
    return sourceBlock.type === "checkbox_field"
      ? sourceBlock.checkedByDefault
      : ""
  }

  const value = values[sourceBlock.fieldKey]

  if (sourceBlock.type === "checkbox_field") {
    return typeof value === "boolean" ? value : false
  }

  return typeof value === "string" ? value : ""
}
