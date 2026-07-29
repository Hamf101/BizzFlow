import type {
  TemplateBlock,
  TemplateContentV3,
  TemplateFieldGroup,
  TemplateSection
} from "@/types/template"

type TemplateFieldBlock = Extract<TemplateBlock, { fieldKey: string }>

type IndexedFieldGroup = {
  group: TemplateFieldGroup
  startIndex: number
  endIndex: number
}

type IndexedSection = {
  section: TemplateSection
  startIndex: number
}

/**
 * Identifies blocks that collect a keyed answer.
 *
 * @param block - Canonical template block.
 * @returns Whether the block is a fillable field.
 */
export function isTemplateFieldBlock(
  block: TemplateBlock
): block is TemplateFieldBlock {
  return "fieldKey" in block
}

/**
 * Creates a lower snake_case key without changing existing field keys.
 *
 * Matching is case-insensitive and deterministic suffixes start at `_2`.
 *
 * @param preferredKey - Label or key used as the readable base.
 * @param existingBlocks - Blocks whose established keys must remain untouched.
 * @param excludedBlockId - Existing block omitted while validating a key edit.
 * @returns A schema-compatible field key unique within the document.
 */
export function createUniqueTemplateFieldKey(
  preferredKey: string,
  existingBlocks: readonly TemplateBlock[],
  excludedBlockId?: string
): string {
  const normalizedBase = normalizeFieldKey(preferredKey)
  const usedKeys = new Set(
    existingBlocks
      .filter(isTemplateFieldBlock)
      .filter(
        (block: TemplateFieldBlock): boolean => block.id !== excludedBlockId
      )
      .map((block: TemplateFieldBlock): string =>
        block.fieldKey.trim().toLowerCase()
      )
  )

  if (!usedKeys.has(normalizedBase)) {
    return normalizedBase
  }

  let suffix = 2

  while (usedKeys.has(withFieldKeySuffix(normalizedBase, suffix))) {
    suffix += 1
  }

  return withFieldKeySuffix(normalizedBase, suffix)
}

/**
 * Finds the section containing one block in root canonical order.
 *
 * @param content - Valid version-three template content.
 * @param blockId - Referenced root block id.
 * @returns The containing section, or null when the block does not exist.
 */
export function getTemplateSectionForBlock(
  content: TemplateContentV3,
  blockId: string
): TemplateSection | null {
  const blockIndex = content.blocks.findIndex(
    (block: TemplateBlock): boolean => block.id === blockId
  )

  if (blockIndex === -1) {
    return null
  }

  let matchingSection: TemplateSection | null = null

  for (const section of content.sections) {
    const sectionIndex = content.blocks.findIndex(
      (block: TemplateBlock): boolean => block.id === section.startBlockId
    )

    if (sectionIndex === -1 || sectionIndex > blockIndex) {
      break
    }
    matchingSection = section
  }

  return matchingSection
}

/**
 * Inserts a block while retaining version-three structural references.
 *
 * @param content - Current editable version-three content.
 * @param afterBlockId - Block after which to insert, or null for the beginning.
 * @param block - New canonical block.
 * @returns New content with repaired section, group, rule, and condition links.
 */
export function insertTemplateBlock(
  content: TemplateContentV3,
  afterBlockId: string | null,
  block: TemplateBlock
): TemplateContentV3 {
  const targetIndex =
    afterBlockId === null
      ? -1
      : content.blocks.findIndex(
          (candidate: TemplateBlock): boolean =>
            candidate.id === afterBlockId
        )
  const insertIndex =
    afterBlockId === null
      ? 0
      : targetIndex === -1
        ? content.blocks.length
        : targetIndex + 1
  const normalizedBlock = normalizeInsertedFieldKey(block, content.blocks)
  const blocks = [
    ...content.blocks.slice(0, insertIndex),
    normalizedBlock,
    ...content.blocks.slice(insertIndex)
  ]

  if (content.blocks.length === 0) {
    return reconcileTemplateStructure(
      content,
      blocks,
      [
        {
          section: {
            id: normalizedBlock.id,
            label: "Section 1",
            startBlockId: normalizedBlock.id,
            pageBreakBefore: false,
            keepTogether: false
          },
          startIndex: 0
        }
      ],
      []
    )
  }

  const sections = getIndexedSections(content).map(
    ({ section, startIndex }: IndexedSection, sectionIndex: number) => ({
      section,
      startIndex:
        insertIndex === 0 && sectionIndex === 0
          ? 0
          : startIndex >= insertIndex
            ? startIndex + 1
            : startIndex
    })
  )
  const fieldGroups = getIndexedFieldGroups(content).map(
    (indexedGroup: IndexedFieldGroup): IndexedFieldGroup => {
      if (insertIndex <= indexedGroup.startIndex) {
        return {
          ...indexedGroup,
          startIndex: indexedGroup.startIndex + 1,
          endIndex: indexedGroup.endIndex + 1
        }
      }

      if (insertIndex <= indexedGroup.endIndex) {
        return {
          ...indexedGroup,
          endIndex: indexedGroup.endIndex + 1
        }
      }

      return indexedGroup
    }
  )

  return reconcileTemplateStructure(
    content,
    blocks,
    sections,
    fieldGroups
  )
}

/**
 * Replaces one block while keeping its id and established field key stable.
 *
 * @param content - Current editable version-three content.
 * @param block - Complete replacement for the block with the same id.
 * @returns New content with invalid dependent references removed.
 */
export function updateTemplateBlock(
  content: TemplateContentV3,
  block: TemplateBlock
): TemplateContentV3 {
  const blockIndex = content.blocks.findIndex(
    (candidate: TemplateBlock): boolean => candidate.id === block.id
  )

  if (blockIndex === -1) {
    return content
  }

  const priorBlock = content.blocks[blockIndex]
  const normalizedBlock = normalizeUpdatedFieldKey(
    priorBlock,
    block,
    content.blocks
  )
  const blocks = content.blocks.map(
    (candidate: TemplateBlock): TemplateBlock =>
      candidate.id === block.id ? normalizedBlock : candidate
  )

  return reconcileTemplateStructure(
    content,
    blocks,
    getIndexedSections(content),
    getIndexedFieldGroups(content)
  )
}

/**
 * Deletes one block and repairs every structural reference to root order.
 *
 * @param content - Current editable version-three content.
 * @param blockId - Existing block id to remove.
 * @returns New content with empty ranges and dangling references removed.
 */
export function deleteTemplateBlock(
  content: TemplateContentV3,
  blockId: string
): TemplateContentV3 {
  const deleteIndex = content.blocks.findIndex(
    (block: TemplateBlock): boolean => block.id === blockId
  )

  if (deleteIndex === -1) {
    return content
  }

  const blocks = content.blocks.filter(
    (block: TemplateBlock): boolean => block.id !== blockId
  )
  const sectionByStartIndex = new Map<number, TemplateSection>()

  for (const { section, startIndex } of getIndexedSections(content)) {
    const nextStartIndex =
      startIndex < deleteIndex
        ? startIndex
        : startIndex > deleteIndex
          ? startIndex - 1
          : deleteIndex

    if (nextStartIndex < blocks.length) {
      // A following singleton section wins a collision at the deleted boundary.
      sectionByStartIndex.set(nextStartIndex, section)
    }
  }

  const sections = [...sectionByStartIndex.entries()].map(
    ([startIndex, section]): IndexedSection => ({ section, startIndex })
  )
  const fieldGroups = getIndexedFieldGroups(content)
    .map((indexedGroup: IndexedFieldGroup): IndexedFieldGroup | null => {
      if (deleteIndex < indexedGroup.startIndex) {
        return {
          ...indexedGroup,
          startIndex: indexedGroup.startIndex - 1,
          endIndex: indexedGroup.endIndex - 1
        }
      }

      if (deleteIndex <= indexedGroup.endIndex) {
        if (indexedGroup.startIndex === indexedGroup.endIndex) {
          return null
        }

        return {
          ...indexedGroup,
          endIndex: indexedGroup.endIndex - 1
        }
      }

      return indexedGroup
    })
    .filter(
      (indexedGroup: IndexedFieldGroup | null): indexedGroup is IndexedFieldGroup =>
        indexedGroup !== null
    )

  return reconcileTemplateStructure(
    content,
    blocks,
    sections,
    fieldGroups
  )
}

/**
 * Moves one block by one position while section and group boundaries stay put.
 *
 * Root blocks remain the sole ordering source; boundary ids are remapped to the
 * blocks now occupying their established positions.
 *
 * @param content - Current editable version-three content.
 * @param blockId - Existing block id to move.
 * @param direction - Adjacent movement direction.
 * @returns New content with repaired structural references.
 */
export function moveTemplateBlock(
  content: TemplateContentV3,
  blockId: string,
  direction: "up" | "down"
): TemplateContentV3 {
  const blockIndex = content.blocks.findIndex(
    (block: TemplateBlock): boolean => block.id === blockId
  )
  const targetIndex = direction === "up" ? blockIndex - 1 : blockIndex + 1

  if (
    blockIndex < 0 ||
    targetIndex < 0 ||
    targetIndex >= content.blocks.length
  ) {
    return content
  }

  const blocks = [...content.blocks]
  const targetBlock = blocks[targetIndex]
  const selectedBlock = blocks[blockIndex]

  if (targetBlock === undefined || selectedBlock === undefined) {
    return content
  }

  blocks[blockIndex] = targetBlock
  blocks[targetIndex] = selectedBlock

  return reconcileTemplateStructure(
    content,
    blocks,
    getIndexedSections(content),
    getIndexedFieldGroups(content)
  )
}

/**
 * Moves one block to an arbitrary canonical position.
 *
 * Section and field-group boundaries retain their established root positions
 * and are remapped to the blocks occupying those positions after the move.
 * Visibility conditions made invalid by the new order are removed.
 *
 * @param content - Current editable version-three content.
 * @param blockId - Existing block id to move.
 * @param afterBlockId - Destination block id, or null for the beginning.
 * @returns New content with repaired structural references, or the original
 * content when either reference is invalid.
 */
export function moveTemplateBlockAfter(
  content: TemplateContentV3,
  blockId: string,
  afterBlockId: string | null
): TemplateContentV3 {
  const sourceIndex = content.blocks.findIndex(
    (block: TemplateBlock): boolean => block.id === blockId
  )
  const destinationIndex =
    afterBlockId === null
      ? -1
      : content.blocks.findIndex(
          (block: TemplateBlock): boolean => block.id === afterBlockId
        )

  if (
    sourceIndex === -1 ||
    afterBlockId === blockId ||
    (afterBlockId !== null && destinationIndex === -1)
  ) {
    return content
  }

  const blocks = [...content.blocks]
  const [selectedBlock] = blocks.splice(sourceIndex, 1)

  if (selectedBlock === undefined) {
    return content
  }

  const remainingDestinationIndex =
    afterBlockId === null
      ? -1
      : blocks.findIndex(
          (block: TemplateBlock): boolean => block.id === afterBlockId
        )
  const insertIndex =
    afterBlockId === null ? 0 : remainingDestinationIndex + 1

  if (insertIndex === sourceIndex) {
    return content
  }

  blocks.splice(insertIndex, 0, selectedBlock)

  return reconcileTemplateStructure(
    content,
    blocks,
    getIndexedSections(content),
    getIndexedFieldGroups(content)
  )
}

function reconcileTemplateStructure(
  content: TemplateContentV3,
  inputBlocks: readonly TemplateBlock[],
  indexedSections: readonly IndexedSection[],
  indexedFieldGroups: readonly IndexedFieldGroup[]
): TemplateContentV3 {
  const blocks = removeInvalidVisibilityConditions(inputBlocks)
  const sections = repairSections(blocks, indexedSections)
  const sectionStartIndices = sections.map(
    (section: TemplateSection): number =>
      blocks.findIndex(
        (block: TemplateBlock): boolean =>
          block.id === section.startBlockId
      )
  )
  const fieldGroups = repairFieldGroups(
    blocks,
    sectionStartIndices,
    indexedFieldGroups
  )
  const existingBlockIds = new Set(
    blocks.map((block: TemplateBlock): string => block.id)
  )
  const seenRuleBlockIds = new Set<string>()
  const blockRules = content.blockRules.filter((rule): boolean => {
    if (
      !existingBlockIds.has(rule.blockId) ||
      seenRuleBlockIds.has(rule.blockId) ||
      (!rule.pageBreakBefore && !rule.keepWithNext)
    ) {
      return false
    }

    seenRuleBlockIds.add(rule.blockId)
    return true
  })

  return {
    ...content,
    blocks,
    sections,
    fieldGroups,
    blockRules
  }
}

function repairSections(
  blocks: readonly TemplateBlock[],
  indexedSections: readonly IndexedSection[]
): TemplateSection[] {
  if (blocks.length === 0) {
    return []
  }

  const sectionByStartIndex = new Map<number, TemplateSection>()

  for (const { section, startIndex } of indexedSections) {
    if (startIndex >= 0 && startIndex < blocks.length) {
      sectionByStartIndex.set(startIndex, section)
    }
  }

  if (!sectionByStartIndex.has(0)) {
    const firstExistingSection = [...sectionByStartIndex.entries()].sort(
      ([leftIndex], [rightIndex]): number => leftIndex - rightIndex
    )[0]?.[1]

    sectionByStartIndex.set(
      0,
      firstExistingSection ?? {
        id: blocks[0]?.id ?? "",
        label: "Section 1",
        startBlockId: blocks[0]?.id ?? "",
        pageBreakBefore: false,
        keepTogether: false
      }
    )
  }

  const seenSectionIds = new Set<string>()

  return [...sectionByStartIndex.entries()]
    .sort(([leftIndex], [rightIndex]): number => leftIndex - rightIndex)
    .flatMap(([startIndex, section]): TemplateSection[] => {
      const startBlock = blocks[startIndex]

      if (startBlock === undefined || seenSectionIds.has(section.id)) {
        return []
      }

      seenSectionIds.add(section.id)
      return [{ ...section, startBlockId: startBlock.id }]
    })
}

function repairFieldGroups(
  blocks: readonly TemplateBlock[],
  sectionStartIndices: readonly number[],
  indexedGroups: readonly IndexedFieldGroup[]
): TemplateFieldGroup[] {
  const groups: TemplateFieldGroup[] = []
  const seenGroupIds = new Set<string>()
  let priorEndIndex = -1

  for (const indexedGroup of [...indexedGroups].sort(
    (left: IndexedFieldGroup, right: IndexedFieldGroup): number =>
      left.startIndex - right.startIndex
  )) {
    const { group, startIndex, endIndex } = indexedGroup

    if (
      startIndex < 0 ||
      endIndex < startIndex ||
      endIndex >= blocks.length ||
      startIndex <= priorEndIndex ||
      seenGroupIds.has(group.id)
    ) {
      continue
    }

    const groupedBlocks = blocks.slice(startIndex, endIndex + 1)
    const startSectionIndex = findSectionIndex(
      sectionStartIndices,
      startIndex
    )
    const endSectionIndex = findSectionIndex(sectionStartIndices, endIndex)

    if (
      startSectionIndex === -1 ||
      startSectionIndex !== endSectionIndex ||
      groupedBlocks.some(
        (block: TemplateBlock): boolean => !isTemplateFieldBlock(block)
      )
    ) {
      continue
    }

    const startBlock = blocks[startIndex]
    const endBlock = blocks[endIndex]

    if (startBlock === undefined || endBlock === undefined) {
      continue
    }

    groups.push({
      ...group,
      startBlockId: startBlock.id,
      endBlockId: endBlock.id
    })
    seenGroupIds.add(group.id)
    priorEndIndex = endIndex
  }

  return groups
}

function removeInvalidVisibilityConditions(
  inputBlocks: readonly TemplateBlock[]
): TemplateBlock[] {
  const blockIndexById = new Map(
    inputBlocks.map(
      (block: TemplateBlock, index: number): readonly [string, number] => [
        block.id,
        index
      ]
    )
  )

  return inputBlocks.map(
    (block: TemplateBlock, targetIndex: number): TemplateBlock => {
      if (!isTemplateFieldBlock(block) || block.visibleWhen === undefined) {
        return block
      }

      const condition = block.visibleWhen
      const sourceIndex = blockIndexById.get(condition.sourceBlockId)
      const source =
        sourceIndex === undefined ? undefined : inputBlocks[sourceIndex]
      const isValidCheckboxCondition =
        source?.type === "checkbox_field" &&
        typeof condition.value === "boolean"
      const isValidDropdownCondition =
        source?.type === "dropdown_field" &&
        typeof condition.value === "string" &&
        source.options.includes(condition.value)

      if (
        sourceIndex !== undefined &&
        sourceIndex < targetIndex &&
        (isValidCheckboxCondition || isValidDropdownCondition)
      ) {
        return block
      }

      const repairedBlock: TemplateFieldBlock = { ...block }
      delete repairedBlock.visibleWhen
      return repairedBlock
    }
  )
}

function getIndexedSections(content: TemplateContentV3): IndexedSection[] {
  const blockIndexById = createBlockIndex(content.blocks)

  return content.sections.flatMap((section: TemplateSection): IndexedSection[] => {
    const startIndex = blockIndexById.get(section.startBlockId)
    return startIndex === undefined ? [] : [{ section, startIndex }]
  })
}

function getIndexedFieldGroups(
  content: TemplateContentV3
): IndexedFieldGroup[] {
  const blockIndexById = createBlockIndex(content.blocks)

  return content.fieldGroups.flatMap(
    (group: TemplateFieldGroup): IndexedFieldGroup[] => {
      const startIndex = blockIndexById.get(group.startBlockId)
      const endIndex = blockIndexById.get(group.endBlockId)

      return startIndex === undefined || endIndex === undefined
        ? []
        : [{ group, startIndex, endIndex }]
    }
  )
}

function createBlockIndex(
  blocks: readonly TemplateBlock[]
): ReadonlyMap<string, number> {
  return new Map(
    blocks.map(
      (block: TemplateBlock, index: number): readonly [string, number] => [
        block.id,
        index
      ]
    )
  )
}

function findSectionIndex(
  sectionStartIndices: readonly number[],
  blockIndex: number
): number {
  let result = -1

  for (const [sectionIndex, startIndex] of sectionStartIndices.entries()) {
    if (startIndex > blockIndex) {
      break
    }
    result = sectionIndex
  }

  return result
}

function normalizeInsertedFieldKey(
  block: TemplateBlock,
  existingBlocks: readonly TemplateBlock[]
): TemplateBlock {
  if (!isTemplateFieldBlock(block)) {
    return block
  }

  return {
    ...block,
    fieldKey: createUniqueTemplateFieldKey(block.fieldKey, existingBlocks)
  }
}

function normalizeUpdatedFieldKey(
  priorBlock: TemplateBlock | undefined,
  nextBlock: TemplateBlock,
  existingBlocks: readonly TemplateBlock[]
): TemplateBlock {
  if (!isTemplateFieldBlock(nextBlock)) {
    return nextBlock
  }

  if (
    priorBlock !== undefined &&
    isTemplateFieldBlock(priorBlock) &&
    priorBlock.fieldKey === nextBlock.fieldKey
  ) {
    return nextBlock
  }

  return {
    ...nextBlock,
    fieldKey: createUniqueTemplateFieldKey(
      nextBlock.fieldKey,
      existingBlocks,
      nextBlock.id
    )
  }
}

function normalizeFieldKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  const prefixed =
    normalized.length === 0
      ? "field"
      : /^[a-z]/.test(normalized)
        ? normalized
        : `field_${normalized}`

  return prefixed.slice(0, 80)
}

function withFieldKeySuffix(baseKey: string, suffix: number): string {
  const encodedSuffix = `_${suffix}`
  return `${baseKey.slice(0, 80 - encodedSuffix.length)}${encodedSuffix}`
}
