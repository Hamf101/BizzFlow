import type {
  TemplateBlock,
  TemplateContentV3,
  TemplateFieldGroup,
  TemplateSection
} from "@/types/template"

type TemplateFieldBlock = Extract<TemplateBlock, { fieldKey: string }>
type TemplateDropdownFieldBlock = Extract<
  TemplateBlock,
  { type: "dropdown_field" }
>

/** Stable reason code returned when a dropdown option edit cannot be committed. */
export type TemplateDropdownOptionEditErrorCode =
  | "dropdown_not_found"
  | "blank_option"
  | "duplicate_option"
  | "option_too_long"
  | "too_many_options"
  | "dependent_option_removal"

/** Exact dropdown value replacement applied to dependent visibility rules. */
export type TemplateDropdownOptionValueRemap = Readonly<{
  from: string
  to: string
}>

/** Validation result for one proposed dropdown option-list edit. */
export type TemplateDropdownOptionEditResult =
  | Readonly<{
      success: true
      options: string[]
      valueRemaps: readonly TemplateDropdownOptionValueRemap[]
    }>
  | Readonly<{
      success: false
      code: TemplateDropdownOptionEditErrorCode
      message: string
      dependentBlockIds: readonly string[]
    }>

/** Stable reason code returned when a structural edit would break visibility. */
export type TemplateVisibilityStructureEditErrorCode =
  | "block_not_found"
  | "visibility_source_in_use"
  | "visibility_order_conflict"

/** Validation result for a delete or move that can affect visibility rules. */
export type TemplateVisibilityStructureEditResult =
  | Readonly<{
      success: true
    }>
  | Readonly<{
      success: false
      code: TemplateVisibilityStructureEditErrorCode
      message: string
      dependentBlockIds: readonly string[]
    }>

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
 * Validates deleting a block without orphaning conditional fields.
 *
 * @param blocks - Current canonical block order.
 * @param blockId - Block proposed for deletion.
 * @returns Success when no field uses the block as a visibility source, or an
 * actionable refusal containing every affected field id.
 */
export function evaluateTemplateBlockDeletion(
  blocks: readonly TemplateBlock[],
  blockId: string
): TemplateVisibilityStructureEditResult {
  const block = blocks.find(
    (candidate: TemplateBlock): boolean => candidate.id === blockId
  )

  if (block === undefined) {
    return createVisibilityStructureEditFailure(
      "block_not_found",
      "The block is no longer available. Select it again before deleting it."
    )
  }

  const dependents = findTemplateVisibilityDependents(blocks, blockId)

  if (dependents.length === 0) {
    return { success: true }
  }

  const sourceLabel = isTemplateFieldBlock(block)
    ? `“${block.label}”`
    : "This block"
  const fieldWord = dependents.length === 1 ? "field depends" : "fields depend"
  const conditionWord = dependents.length === 1 ? "field" : "fields"

  return {
    success: false,
    code: "visibility_source_in_use",
    message: `${sourceLabel} cannot be deleted because ${dependents.length} conditional ${fieldWord} on it. Change the affected ${conditionWord} to Always visible or choose another condition first.`,
    dependentBlockIds: dependents.map(
      (dependent: TemplateFieldBlock): string => dependent.id
    )
  }
}

/**
 * Validates an adjacent block move without placing conditional fields before
 * their checkbox or dropdown visibility source.
 *
 * @param blocks - Current canonical block order.
 * @param blockId - Block proposed for movement.
 * @param direction - Adjacent movement direction.
 * @returns Success for a safe or boundary move, or an actionable refusal with
 * every conditional field made invalid by the proposed order.
 */
export function evaluateTemplateBlockMove(
  blocks: readonly TemplateBlock[],
  blockId: string,
  direction: "up" | "down"
): TemplateVisibilityStructureEditResult {
  const blockIndex = blocks.findIndex(
    (block: TemplateBlock): boolean => block.id === blockId
  )

  if (blockIndex === -1) {
    return createVisibilityStructureEditFailure(
      "block_not_found",
      "The block is no longer available. Select it again before moving it."
    )
  }

  const targetIndex = direction === "up" ? blockIndex - 1 : blockIndex + 1

  if (targetIndex < 0 || targetIndex >= blocks.length) {
    return { success: true }
  }

  const proposedBlocks = [...blocks]
  const block = proposedBlocks[blockIndex]
  const targetBlock = proposedBlocks[targetIndex]

  if (block === undefined || targetBlock === undefined) {
    return { success: true }
  }

  proposedBlocks[blockIndex] = targetBlock
  proposedBlocks[targetIndex] = block

  const dependentBlockIds = findVisibilityOrderConflicts(proposedBlocks)

  if (dependentBlockIds.length === 0) {
    return { success: true }
  }

  const fieldWord = dependentBlockIds.length === 1 ? "field" : "fields"

  return {
    success: false,
    code: "visibility_order_conflict",
    message: `This move would place ${dependentBlockIds.length} conditional ${fieldWord} before the checkbox or dropdown that controls visibility. Keep each source above the fields it controls, or change the affected conditions first.`,
    dependentBlockIds
  }
}

/**
 * Validates a dropdown option edit before it reaches structure reconciliation.
 *
 * Same-position replacements are treated as explicit renames and can therefore
 * remap exact-value visibility rules atomically. Removing a referenced value is
 * refused so reconciliation never silently drops the dependent rule.
 *
 * @param blocks - Current canonical blocks, including visibility dependents.
 * @param dropdownBlockId - Dropdown whose option list is being edited.
 * @param proposedOptions - User-entered option lines before normalization.
 * @returns Normalized options and safe value remaps, or an actionable refusal.
 */
export function evaluateTemplateDropdownOptionEdit(
  blocks: readonly TemplateBlock[],
  dropdownBlockId: string,
  proposedOptions: readonly string[]
): TemplateDropdownOptionEditResult {
  const dropdown = blocks.find(
    (block: TemplateBlock): block is TemplateDropdownFieldBlock =>
      block.id === dropdownBlockId && block.type === "dropdown_field"
  )

  if (dropdown === undefined) {
    return createDropdownOptionEditFailure(
      "dropdown_not_found",
      "The dropdown is no longer available. Select it again before editing its options."
    )
  }

  if (proposedOptions.length > 100) {
    return createDropdownOptionEditFailure(
      "too_many_options",
      "Dropdowns support at most 100 options. Remove extra lines before saving this edit."
    )
  }

  const options = proposedOptions.map((option: string): string => option.trim())
  const blankOptionIndex = options.findIndex(
    (option: string): boolean => option.length === 0
  )

  if (blankOptionIndex !== -1) {
    return createDropdownOptionEditFailure(
      "blank_option",
      `Option ${blankOptionIndex + 1} is blank. Enter a value or remove the empty line.`
    )
  }

  const longOptionIndex = options.findIndex(
    (option: string): boolean => option.length > 240
  )

  if (longOptionIndex !== -1) {
    return createDropdownOptionEditFailure(
      "option_too_long",
      `Option ${longOptionIndex + 1} is longer than 240 characters. Shorten it before saving this edit.`
    )
  }

  const duplicateOption = findDuplicateDropdownOption(options)

  if (duplicateOption !== null) {
    return createDropdownOptionEditFailure(
      "duplicate_option",
      `Dropdown options must be unique. Rename or remove the duplicate “${duplicateOption}”.`
    )
  }

  const valueRemaps = createDropdownOptionValueRemaps(dropdown.options, options)
  const remappedValues = new Set<string>(
    valueRemaps.map(
      (valueRemap: TemplateDropdownOptionValueRemap): string => valueRemap.from
    )
  )
  const removedReferencedOptions = dropdown.options.filter(
    (priorOption: string): boolean =>
      !options.includes(priorOption) &&
      !remappedValues.has(priorOption) &&
      findDropdownVisibilityDependents(
        blocks,
        dropdownBlockId,
        priorOption
      ).length > 0
  )

  if (removedReferencedOptions.length > 0) {
    const dependentBlockIds = [
      ...new Set<string>(
        removedReferencedOptions.flatMap((option: string): string[] =>
          findDropdownVisibilityDependents(blocks, dropdownBlockId, option).map(
            (block: TemplateFieldBlock): string => block.id
          )
        )
      )
    ]
    const optionNames = removedReferencedOptions
      .map((option: string): string => `“${option}”`)
      .join(", ")
    const fieldLabel = dependentBlockIds.length === 1 ? "field uses" : "fields use"

    return {
      success: false,
      code: "dependent_option_removal",
      message: `${optionNames} cannot be deleted because ${dependentBlockIds.length} conditional ${fieldLabel} that value. Change those fields to Always visible or choose another condition first.`,
      dependentBlockIds
    }
  }

  return {
    success: true,
    options,
    valueRemaps
  }
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
 * @returns New content with safe dependent references retained or remapped.
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
  let nextBlock = block
  let dropdownValueRemaps: readonly TemplateDropdownOptionValueRemap[] = []

  if (
    priorBlock?.type === "dropdown_field" &&
    block.type === "dropdown_field" &&
    !areStringArraysEqual(priorBlock.options, block.options)
  ) {
    const optionEdit = evaluateTemplateDropdownOptionEdit(
      content.blocks,
      block.id,
      block.options
    )

    if (!optionEdit.success) {
      return content
    }

    nextBlock = {
      ...block,
      options: optionEdit.options
    }
    dropdownValueRemaps = optionEdit.valueRemaps
  }

  const normalizedBlock = normalizeUpdatedFieldKey(
    priorBlock,
    nextBlock,
    content.blocks
  )
  const blocks = content.blocks
    .map(
      (candidate: TemplateBlock): TemplateBlock =>
        candidate.id === block.id ? normalizedBlock : candidate
    )
    .map((candidate: TemplateBlock): TemplateBlock =>
      remapDropdownVisibilityValue(
        candidate,
        block.id,
        dropdownValueRemaps
      )
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

function createDropdownOptionEditFailure(
  code: Exclude<
    TemplateDropdownOptionEditErrorCode,
    "dependent_option_removal"
  >,
  message: string
): TemplateDropdownOptionEditResult {
  return {
    success: false,
    code,
    message,
    dependentBlockIds: []
  }
}

function createVisibilityStructureEditFailure(
  code: Extract<
    TemplateVisibilityStructureEditErrorCode,
    "block_not_found"
  >,
  message: string
): TemplateVisibilityStructureEditResult {
  return {
    success: false,
    code,
    message,
    dependentBlockIds: []
  }
}

function findDuplicateDropdownOption(options: readonly string[]): string | null {
  const seenOptions = new Set<string>()

  for (const option of options) {
    const comparableOption = option.toLowerCase()

    if (seenOptions.has(comparableOption)) {
      return option
    }

    seenOptions.add(comparableOption)
  }

  return null
}

function createDropdownOptionValueRemaps(
  priorOptions: readonly string[],
  nextOptions: readonly string[]
): readonly TemplateDropdownOptionValueRemap[] {
  if (priorOptions.length !== nextOptions.length) {
    return []
  }

  const priorValues = new Set<string>(priorOptions)
  const nextValues = new Set<string>(nextOptions)

  return priorOptions.flatMap(
    (
      priorOption: string,
      optionIndex: number
    ): TemplateDropdownOptionValueRemap[] => {
      const nextOption = nextOptions[optionIndex]

      if (
        nextOption === undefined ||
        priorOption === nextOption ||
        nextValues.has(priorOption) ||
        priorValues.has(nextOption)
      ) {
        return []
      }

      return [{ from: priorOption, to: nextOption }]
    }
  )
}

function findDropdownVisibilityDependents(
  blocks: readonly TemplateBlock[],
  dropdownBlockId: string,
  option: string
): TemplateFieldBlock[] {
  return findTemplateVisibilityDependents(blocks, dropdownBlockId).filter(
    (block: TemplateFieldBlock): boolean =>
      block.visibleWhen?.value === option
  )
}

function findTemplateVisibilityDependents(
  blocks: readonly TemplateBlock[],
  sourceBlockId: string
): TemplateFieldBlock[] {
  return blocks.filter(
    (block: TemplateBlock): block is TemplateFieldBlock =>
      isTemplateFieldBlock(block) &&
      block.visibleWhen?.sourceBlockId === sourceBlockId
  )
}

function findVisibilityOrderConflicts(
  blocks: readonly TemplateBlock[]
): string[] {
  const blockIndexById = createBlockIndex(blocks)

  return blocks.flatMap(
    (block: TemplateBlock, targetIndex: number): string[] => {
      if (!isTemplateFieldBlock(block) || block.visibleWhen === undefined) {
        return []
      }

      const sourceIndex = blockIndexById.get(block.visibleWhen.sourceBlockId)

      return sourceIndex !== undefined && sourceIndex < targetIndex
        ? []
        : [block.id]
    }
  )
}

function remapDropdownVisibilityValue(
  block: TemplateBlock,
  dropdownBlockId: string,
  valueRemaps: readonly TemplateDropdownOptionValueRemap[]
): TemplateBlock {
  if (
    !isTemplateFieldBlock(block) ||
    block.visibleWhen?.sourceBlockId !== dropdownBlockId ||
    typeof block.visibleWhen.value !== "string"
  ) {
    return block
  }

  const valueRemap = valueRemaps.find(
    (candidate: TemplateDropdownOptionValueRemap): boolean =>
      candidate.from === block.visibleWhen?.value
  )

  if (valueRemap === undefined) {
    return block
  }

  return {
    ...block,
    visibleWhen: {
      ...block.visibleWhen,
      value: valueRemap.to
    }
  }
}

function areStringArraysEqual(
  first: readonly string[],
  second: readonly string[]
): boolean {
  return (
    first.length === second.length &&
    first.every(
      (value: string, index: number): boolean => value === second[index]
    )
  )
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
