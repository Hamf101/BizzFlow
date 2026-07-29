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
