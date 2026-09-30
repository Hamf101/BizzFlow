import {
  isPinnedBlock,
  MAX_ROW_COLUMNS,
  MAX_TEMPLATE_BLOCK_COUNT,
  ruleHasEffect,
  type TemplateBlock,
  type TemplateContentV3,
  type TemplateFieldGroup,
  type TemplateSection
} from "@/types/template"

type TemplateFieldBlock = Extract<TemplateBlock, { fieldKey: string }>
type TemplateBlockRule = TemplateContentV3["blockRules"][number]
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

/**
 * A place a block can be moved to, counted among the other blocks with it
 * lifted out: before the block at `index`, or at the end.
 */
export type TemplateBlockSlot = Readonly<{
  index: number
  /** The section whose title it goes under, as its first block; null to follow what comes before. */
  opens: string | null
  /** Whether it stays in its own group of fields. */
  inGroup: boolean
}>

/** A move made, or refused because a conditional field would come before its source. */
export type TemplateMoveResult =
  | Readonly<{ success: true; content: TemplateContentV3 }>
  | Extract<TemplateVisibilityStructureEditResult, { success: false }>
  | Readonly<{
      success: false
      code: "row_full" | "pinned_block"
      message: string
      dependentBlockIds: readonly string[]
    }>

type LiftedBlock = Readonly<{
  at: number
  block: TemplateBlock
  /** The section with no other block, whose title stays where the block was. */
  emptied: string | null
  /** Its own group, when the group has other fields, by where they sit among `rest`. */
  own: Readonly<{ group: TemplateFieldGroup; start: number; end: number }> | null
  opens: string | null
  /** Every other group's fields, by where they sit among `rest`. */
  others: readonly Readonly<{ start: number; end: number }>[]
  rest: readonly TemplateBlock[]
  /** Where each section's first block sits among `rest`. */
  starts: ReadonlyMap<number, string>
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

/** The shape every field key takes: lower snake_case, starting with a letter. */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/

/**
 * Gives every field a valid key the author never sees. Keys are generated, so
 * one typed by hand while keys were still editable, or repeated, is rebuilt
 * from what it was; content whose keys are all good comes back untouched.
 * Only templates are rebuilt: a document's answers are filed under its keys.
 *
 * @param content - A template's content.
 * @returns The content, with every key valid and unique.
 */
export function withGeneratedFieldKeys<Content extends TemplateContentV3>(content: Content): Content {
  let blocks = content.blocks

  for (const [index, block] of content.blocks.entries()) {
    if (!isTemplateFieldBlock(block)) {
      continue
    }

    // The first field to use a key keeps it; later ones are renamed.
    const repeated = blocks
      .slice(0, index)
      .some((other: TemplateBlock): boolean => isTemplateFieldBlock(other) && other.fieldKey === block.fieldKey)

    if (FIELD_KEY_PATTERN.test(block.fieldKey) && !repeated) {
      continue
    }

    const fieldKey = createUniqueTemplateFieldKey(block.fieldKey, blocks, block.id)
    blocks = blocks.map(
      (candidate: TemplateBlock): TemplateBlock =>
        candidate.id === block.id && isTemplateFieldBlock(candidate) ? { ...candidate, fieldKey } : candidate
    )
  }

  return blocks === content.blocks ? content : { ...content, blocks }
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
 * Starts a section at a block. A block inside a row of side-by-side fields
 * starts it at the row's first field, since a section never splits a row.
 *
 * @param content - Editable version-three content.
 * @param blockId - The block the section opens with.
 * @param sectionId - A fresh id for the section.
 * @param label - Its printed title; defaults to an editable placeholder.
 * @returns The content with the section, or unchanged when the block is
 * missing or already opens a section.
 */
export function startTemplateSection(
  content: TemplateContentV3,
  blockId: string,
  sectionId: string,
  label = "Section title"
): TemplateContentV3 {
  const index = content.blocks.findIndex((block: TemplateBlock): boolean => block.id === blockId)
  const row = getIndexedFieldGroups(content).find(
    (group: IndexedFieldGroup): boolean => index >= group.startIndex && index <= group.endIndex
  )
  const startIndex = row?.startIndex ?? index
  const startBlockId = content.blocks[startIndex]?.id

  if (
    startBlockId === undefined ||
    content.sections.some((section: TemplateSection): boolean => section.startBlockId === startBlockId)
  ) {
    return content
  }

  return reconcileTemplateStructure(
    content,
    content.blocks,
    [
      ...getIndexedSections(content),
      { section: { id: sectionId, label, startBlockId, pageBreakBefore: false, keepTogether: false }, startIndex },
    ],
    getIndexedFieldGroups(content)
  )
}

/**
 * Changes a section's title or its page rules.
 *
 * @param content - Editable version-three content.
 * @param sectionId - The section.
 * @param change - Its new title, whether it starts a new page, and whether it
 * stays on one page.
 * @returns The content with the section changed.
 */
export function updateTemplateSection(
  content: TemplateContentV3,
  sectionId: string,
  change: Partial<Pick<TemplateSection, "keepTogether" | "label" | "pageBreakBefore">>
): TemplateContentV3 {
  return {
    ...content,
    sections: content.sections.map(
      (section: TemplateSection): TemplateSection => (section.id === sectionId ? { ...section, ...change } : section)
    ),
  }
}

/**
 * Removes a section's boundary and title, keeping everything in it.
 *
 * @param content - Editable version-three content.
 * @param sectionId - The section.
 * @returns The content, its blocks now part of the section before.
 */
export function removeTemplateSection(content: TemplateContentV3, sectionId: string): TemplateContentV3 {
  return {
    ...content,
    sections: content.sections.filter((section: TemplateSection): boolean => section.id !== sectionId),
  }
}

/**
 * Puts a block beside another, to its left or right: any block, not only
 * fields. It joins the other block's row, widening it by a column, or the two
 * start a row of their own. The block moves into the other block's section,
 * and a row holds at most four blocks. Pinned blocks stay out of rows.
 *
 * @param content - Editable version-three content.
 * @param blockId - The block to move.
 * @param targetId - The block it goes beside.
 * @param side - Which side of the target.
 * @param newId - Makes fresh ids, for a new row or the line an emptied section keeps.
 * @returns The content, or a refusal saying why the block cannot go there.
 */
export function placeBeside(
  content: TemplateContentV3,
  blockId: string,
  targetId: string,
  side: "left" | "right",
  newId: () => string
): TemplateMoveResult {
  const moving = content.blocks.find((block: TemplateBlock): boolean => block.id === blockId)
  const targetAt = content.blocks.findIndex((block: TemplateBlock): boolean => block.id === targetId)
  const target = content.blocks[targetAt]

  if (!moving || !target) {
    return { code: "block_not_found", dependentBlockIds: [], message: "The block is no longer available. Select it again before moving it.", success: false }
  }

  if (blockId === targetId) {
    return { content, success: true }
  }

  if (isPinnedBlock(moving) || isPinnedBlock(target)) {
    return { code: "pinned_block", dependentBlockIds: [], message: "A block pinned to its page can't share a row. Put it back in line first.", success: false }
  }

  const row = getIndexedFieldGroups(content).find(({ endIndex, startIndex }) => targetAt >= startIndex && targetAt <= endIndex)
  const ownRow = row !== undefined && content.blocks.slice(row.startIndex, row.endIndex + 1).includes(moving)
  const members = row ? row.endIndex - row.startIndex + 1 : 1

  if (row && !ownRow && members >= MAX_ROW_COLUMNS && members <= row.group.columns) {
    return { code: "row_full", dependentBlockIds: [], message: "A row holds at most four blocks side by side.", success: false }
  }

  const rest = content.blocks.filter((block: TemplateBlock): boolean => block.id !== blockId)
  const slot: TemplateBlockSlot = {
    index: rest.findIndex((block: TemplateBlock): boolean => block.id === targetId) + (side === "right" ? 1 : 0),
    inGroup: ownRow,
    // Left of a section's first block, the block opens that section instead.
    opens: side === "left" ? (content.sections.find((section) => section.startBlockId === targetId)?.id ?? null) : null,
  }
  const moved = moveTemplateBlockTo(content, blockId, slot, newId())

  if (!moved.success || ownRow) {
    return moved
  }

  const next = moved.content
  const index = createBlockIndex(next.blocks)
  const blockAt = index.get(blockId) ?? 0
  const at = index.get(targetId) ?? 0
  const held = next.fieldGroups.find((group) => (index.get(group.startBlockId) ?? -1) <= at && at <= (index.get(group.endBlockId) ?? -1))
  const fieldGroups = held
    ? next.fieldGroups.map((group: TemplateFieldGroup): TemplateFieldGroup => {
        if (group !== held) {
          return group
        }

        const start = Math.min(index.get(group.startBlockId) ?? blockAt, blockAt)
        const end = Math.max(index.get(group.endBlockId) ?? blockAt, blockAt)
        // A single row gains a column; a range that already wraps just takes one more.
        const widened = members <= group.columns ? { ...withoutWidths(group), columns: Math.min(MAX_ROW_COLUMNS, members + 1) } : group

        return { ...widened, endBlockId: next.blocks[end]?.id ?? blockId, startBlockId: next.blocks[start]?.id ?? blockId }
      })
    : [
        ...next.fieldGroups,
        {
          columns: 2,
          endBlockId: blockAt > at ? blockId : targetId,
          id: newId(),
          keepTogether: false,
          label: null,
          startBlockId: blockAt > at ? targetId : blockId,
        },
      ].sort((left, right) => (index.get(left.startBlockId) ?? 0) - (index.get(right.startBlockId) ?? 0))

  return { content: { ...next, fieldGroups }, success: true }
}

/**
 * Takes a block out of its row and puts it on its own line just below it.
 * The row loses a column, and a row left with one block is undone unless it
 * has a label or keeps together.
 *
 * @param content - Editable version-three content.
 * @param blockId - The block.
 * @param newId - Makes a fresh id, for the line an emptied section keeps.
 * @returns The content, unchanged when the block is in no row.
 */
export function standAlone(content: TemplateContentV3, blockId: string, newId: () => string): TemplateMoveResult {
  const at = content.blocks.findIndex((block: TemplateBlock): boolean => block.id === blockId)
  const row = getIndexedFieldGroups(content).find(({ endIndex, startIndex }) => at >= startIndex && at <= endIndex)

  // Lifted out, the row's last block sits one place earlier, so its end is the place after it.
  return row ? moveTemplateBlockTo(content, blockId, { inGroup: false, index: row.endIndex, opens: null }, newId()) : { content, success: true }
}

/**
 * Sizes a row's columns in twelfths of the page's width. Equal columns keep
 * no widths at all.
 *
 * @param content - Editable version-three content.
 * @param groupId - The row.
 * @param widths - One width per column, each at least two twelfths, filling twelve.
 * @returns The content, unchanged when the widths do not fit the row.
 */
export function setRowWidths(content: TemplateContentV3, groupId: string, widths: readonly number[]): TemplateContentV3 {
  const group = content.fieldGroups.find((candidate: TemplateFieldGroup): boolean => candidate.id === groupId)
  const fits =
    group !== undefined &&
    widths.length === group.columns &&
    widths.every((width: number): boolean => Number.isInteger(width) && width >= 2) &&
    widths.reduce((total: number, width: number): number => total + width, 0) === 12

  if (!fits) {
    return content
  }

  const equal = widths.every((width: number): boolean => width === widths[0])

  return {
    ...content,
    fieldGroups: content.fieldGroups.map(
      (candidate: TemplateFieldGroup): TemplateFieldGroup =>
        candidate.id !== groupId ? candidate : equal ? withoutWidths(candidate) : { ...candidate, widths: [...widths] }
    ),
  }
}

/**
 * Changes what a group of fields shares: the label printed above it, and
 * whether it stays on one page. An emptied label takes the label away.
 *
 * @param content - Editable version-three content.
 * @param groupId - The group.
 * @param change - Its new label, as typed, or whether it keeps together.
 * @returns The content with the group changed.
 */
export function updateTemplateFieldGroup(
  content: TemplateContentV3,
  groupId: string,
  change: Readonly<{ keepTogether?: boolean; label?: string }>
): TemplateContentV3 {
  return {
    ...content,
    fieldGroups: content.fieldGroups.map(
      (group: TemplateFieldGroup): TemplateFieldGroup =>
        group.id !== groupId
          ? group
          : {
              ...group,
              keepTogether: change.keepTogether ?? group.keepTogether,
              label: change.label === undefined ? group.label : change.label || null,
            }
    ),
  }
}

/**
 * Keeps a block on the same page as the one after it, or lets it go.
 *
 * @param content - Editable version-three content.
 * @param blockId - The block.
 * @param keepWithNext - Whether it stays with the next block.
 * @returns The content with the block's rule changed, keeping the rest of its rule.
 */
export function setBlockKeepWithNext(
  content: TemplateContentV3,
  blockId: string,
  keepWithNext: boolean
): TemplateContentV3 {
  return setBlockRule(content, blockId, { keepWithNext })
}

/**
 * Changes how a block is laid out: its page break, whether it stays with the
 * next, the space above it and where it sits across the page. What is not
 * named stays as it was, and a rule left changing nothing is dropped.
 *
 * @param content - Editable version-three content.
 * @param blockId - The block.
 * @param change - What changes; an undefined space or frame is taken away.
 * @returns The content with the block's rule changed.
 */
export function setBlockRule(
  content: TemplateContentV3,
  blockId: string,
  change: Partial<Omit<TemplateBlockRule, "blockId">>
): TemplateContentV3 {
  if (!content.blocks.some((block: TemplateBlock): boolean => block.id === blockId)) {
    return content
  }

  const existing = content.blockRules.find((rule): boolean => rule.blockId === blockId)
  const rule: TemplateBlockRule = { blockId, keepWithNext: false, pageBreakBefore: false, ...existing, ...change }
  const others = content.blockRules.filter((candidate): boolean => candidate.blockId !== blockId)

  // Held down past the most a page allows, a space stops there.
  if (rule.spaceAbove) rule.spaceAbove = Math.min(rule.spaceAbove, 600)
  // None of it left, a rule would say nothing.
  if (!rule.spaceAbove) delete rule.spaceAbove
  if (!rule.frame) delete rule.frame

  if (!ruleHasEffect(rule)) {
    return { ...content, blockRules: others }
  }

  return {
    ...content,
    blockRules: existing
      ? content.blockRules.map((candidate) => (candidate.blockId === blockId ? rule : candidate))
      : [...content.blockRules, rule],
  }
}

/**
 * Where a block sits across the page, as its rule keeps it: none when it
 * fills the line, and to a tenth of a percent otherwise.
 *
 * @param left - Its left edge, in percentages of the line.
 * @param width - Its width, in the same.
 * @returns The frame, or undefined for the whole line.
 */
export function frameOf(left: number, width: number): TemplateBlockRule["frame"] {
  const round = (value: number): number => Math.round(value * 10) / 10

  // Pushed past either edge, a block stops at it, and never narrower than a twentieth.
  const at = round(Math.min(Math.max(left, 0), 95))

  return at < 0.5 && width > 99.5 ? undefined : { left: at, width: round(Math.min(Math.max(width, 5), 100 - at)) }
}

/**
 * Lists every place a block can be moved to, top to bottom. A row of fields
 * is one piece that a block goes above or below, and a section's title has a
 * place on each side: before it, closing the section above, and under it,
 * opening its section.
 *
 * @param content - Editable version-three content.
 * @param blockId - The block to move.
 * @param withinGroup - Whether the places inside the block's own group count,
 *   as they do for moving it a step at a time; a drag goes only beside rows.
 * @returns The places, or none when the block is missing.
 */
export function listTemplateBlockSlots(
  content: TemplateContentV3,
  blockId: string,
  withinGroup: boolean
): TemplateBlockSlot[] {
  const lifted = liftTemplateBlock(content, blockId)

  if (!lifted) {
    return []
  }

  const { emptied, others, own, rest, starts } = lifted
  const inside = (gap: number, range: Readonly<{ start: number; end: number }>): boolean => gap > range.start && gap <= range.end
  const slots: TemplateBlockSlot[] = []

  for (let gap = 0; gap <= rest.length; gap += 1) {
    const opens = starts.get(gap) ?? null

    if (others.some((range) => inside(gap, range))) {
      continue
    }

    if (own && inside(gap, own)) {
      if (withinGroup) {
        slots.push({ index: gap, inGroup: true, opens: null })
      }

      continue
    }

    if (withinGroup && own?.end === gap - 1) {
      slots.push({ index: gap, inGroup: true, opens: null })
    }

    slots.push({ index: gap, inGroup: false, opens: null })

    if (emptied && gap === lifted.at) {
      slots.push({ index: gap, inGroup: false, opens: emptied })
    }

    if (opens) {
      slots.push({ index: gap, inGroup: false, opens })
    }

    if (withinGroup && own?.start === gap) {
      slots.push({ index: gap, inGroup: true, opens })
    }
  }

  return slots
}

/**
 * The place a block has now, as `listTemplateBlockSlots` counts places.
 *
 * @param content - Editable version-three content.
 * @param blockId - The block.
 * @returns Its place, or null for a missing block.
 */
export function getTemplateBlockSlot(content: TemplateContentV3, blockId: string): TemplateBlockSlot | null {
  const lifted = liftTemplateBlock(content, blockId)

  return lifted ? currentSlot(lifted) : null
}

/**
 * The place one step up or down from where a block is.
 *
 * @param content - Editable version-three content.
 * @param blockId - The block to move.
 * @param direction - Which way.
 * @returns The place, or null at the top or bottom, or for a missing block.
 */
export function stepTemplateBlockSlot(
  content: TemplateContentV3,
  blockId: string,
  direction: "up" | "down"
): TemplateBlockSlot | null {
  const current = getTemplateBlockSlot(content, blockId)
  const slots = listTemplateBlockSlots(content, blockId, true)
  const at = current ? slots.findIndex((slot) => isSameSlot(slot, current)) : -1

  return at === -1 ? null : (slots[at + (direction === "up" ? -1 : 1)] ?? null)
}

/**
 * Moves a block to a place. Only the block moves: every other block keeps
 * its section and its row, and the block keeps its id, key, condition and
 * rules. It joins the section of its place and leaves its row unless it
 * stays in it; a row left with one field is undone, and a section it leaves
 * with nothing keeps its title over an empty line.
 *
 * @param content - Editable version-three content.
 * @param blockId - The block to move.
 * @param slot - Where to, from `listTemplateBlockSlots`.
 * @param newBlockId - A fresh id, for the line a section it empties keeps.
 * @returns The moved content, or a refusal naming every conditional field
 *   the move would put above its checkbox or dropdown.
 */
export function moveTemplateBlockTo(
  content: TemplateContentV3,
  blockId: string,
  slot: TemplateBlockSlot,
  newBlockId: string
): TemplateMoveResult {
  const lifted = liftTemplateBlock(content, blockId)

  if (!lifted) {
    return { code: "block_not_found", dependentBlockIds: [], message: "The block is no longer available. Select it again before moving it.", success: false }
  }

  if (isSameSlot(slot, currentSlot(lifted)) || slot.index < 0 || slot.index > lifted.rest.length) {
    return { content, success: true }
  }

  const { at, block, emptied, own, rest } = lifted
  const follower = content.blocks[at + 1]
  const blocks = [...rest.slice(0, slot.index), block, ...rest.slice(slot.index)]
  const filler: TemplateBlock | null = emptied ? { alignment: "left", id: newBlockId, text: "", type: "paragraph" } : null

  if (filler) {
    // The emptied section's title sat just above what followed the block, or
    // just above the block when it now opens the section after that title.
    const where = slot.index === at && slot.opens !== null ? blocks.indexOf(block) : follower ? blocks.indexOf(follower) : blocks.length

    blocks.splice(where, 0, filler)
  }

  const conflicts = findVisibilityOrderConflicts(blocks)

  if (conflicts.length > 0) {
    return createOrderConflict(conflicts)
  }

  const index = createBlockIndex(blocks)
  const sections = content.sections
    .map((section: TemplateSection): TemplateSection => {
      if (section.id === slot.opens) {
        return { ...section, startBlockId: block.id }
      }

      if (section.id === emptied && filler) {
        return { ...section, startBlockId: filler.id }
      }

      // A section the block opened is opened by the block after it instead.
      return section.startBlockId === block.id && follower ? { ...section, startBlockId: follower.id } : section
    })
    .sort((left, right) => (index.get(left.startBlockId) ?? 0) - (index.get(right.startBlockId) ?? 0))
  const fieldGroups = content.fieldGroups.flatMap((group: TemplateFieldGroup): TemplateFieldGroup[] => {
    const members = content.blocks
      .slice(content.blocks.findIndex((candidate) => candidate.id === group.startBlockId), content.blocks.findIndex((candidate) => candidate.id === group.endBlockId) + 1)
      .filter((member) => member.id !== block.id || (slot.inGroup && group.id === own?.group.id))
      .map((member) => index.get(member.id) ?? 0)
      .sort((left, right) => left - right)
    const first = blocks[members[0] ?? -1]
    const last = blocks[members.at(-1) ?? -1]

    // One field on its own has nothing to sit beside.
    if (!first || !last || (members.length < 2 && group.label === null && !group.keepTogether)) {
      return []
    }

    return [fitRow({ ...group, endBlockId: last.id, startBlockId: first.id }, members.length)]
  })

  return { content: { ...content, blocks, fieldGroups, sections }, success: true }
}

/**
 * Moves a section, with everything in it, above the section before it or
 * below the one after. Writing before the first section has no section to
 * swap with, so it stays first.
 *
 * @param content - Editable version-three content.
 * @param sectionId - The section.
 * @param direction - Which way.
 * @returns The moved content, unchanged at either end, or a refusal naming
 *   every conditional field the move would put above its source.
 */
export function moveTemplateSection(
  content: TemplateContentV3,
  sectionId: string,
  direction: "up" | "down"
): TemplateMoveResult {
  const indexed = getIndexedSections(content).sort((left, right) => left.startIndex - right.startIndex)
  const at = indexed.findIndex(({ section }) => section.id === sectionId)
  const other = at + (direction === "up" ? -1 : 1)
  const upper = indexed[Math.min(at, other)]
  const lower = indexed[Math.max(at, other)]

  if (at === -1 || !upper || !lower) {
    return { content, success: true }
  }

  const end = indexed[Math.max(at, other) + 1]?.startIndex ?? content.blocks.length
  const blocks = [
    ...content.blocks.slice(0, upper.startIndex),
    ...content.blocks.slice(lower.startIndex, end),
    ...content.blocks.slice(upper.startIndex, lower.startIndex),
    ...content.blocks.slice(end),
  ]
  const conflicts = findVisibilityOrderConflicts(blocks)

  if (conflicts.length > 0) {
    return createOrderConflict(conflicts)
  }

  const index = createBlockIndex(blocks)

  return {
    content: {
      ...content,
      blocks,
      sections: [...content.sections].sort((left, right) => (index.get(left.startBlockId) ?? 0) - (index.get(right.startBlockId) ?? 0)),
    },
    success: true,
  }
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

  // The first block of an empty page starts no section: a section prints its
  // label, and a blank page should print only what its author writes.
  if (content.blocks.length === 0) {
    return reconcileTemplateStructure(content, blocks, [], [])
  }

  // A section that opens the page keeps a block typed above it; one that
  // starts partway down moves along with its first block.
  const sections = getIndexedSections(content).map(
    ({ section, startIndex }: IndexedSection) => ({
      section,
      startIndex:
        insertIndex === 0 && startIndex === 0
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
 * Duplicates a block immediately after the original, retaining its layout rules.
 *
 * Existing conditions continue to refer to their original source. A copied
 * conditional field keeps that source too, which remains earlier in the flow.
 *
 * @param content - Canonical editable template content.
 * @param blockId - Source block to copy.
 * @param newBlockId - Fresh UUID supplied by the caller.
 * @returns New content, or the unchanged content for a missing source, id
 * collision, or a template already at its block limit.
 */
export function duplicateTemplateBlock(
  content: TemplateContentV3,
  blockId: string,
  newBlockId: string
): TemplateContentV3 {
  const source = content.blocks.find((block) => block.id === blockId)
  if (
    !source || content.blocks.length >= MAX_TEMPLATE_BLOCK_COUNT ||
    content.blocks.some((block) => block.id === newBlockId)
  ) {
    return content
  }

  // Template blocks contain JSON values only; nested rows/options must be
  // independent so editing the duplicate cannot change the original.
  const block = JSON.parse(JSON.stringify(source)) as TemplateBlock
  block.id = newBlockId

  // A copy of a picture placed on a page sits a little down and across from
  // it, so both can be seen.
  if (block.type === "image" && block.placement) {
    const { height, width, x, y } = block.placement

    block.placement = { ...block.placement, x: Math.min(x + 3, 100 - width), y: Math.min(y + 3, 100 - height) }
  }

  const inserted = insertTemplateBlock(content, blockId, block)
  const rule = content.blockRules.find((candidate) => candidate.blockId === blockId)

  return {
    ...inserted,
    fieldGroups: inserted.fieldGroups.map((group) =>
      group.endBlockId === blockId ? { ...group, endBlockId: newBlockId } : group
    ),
    blockRules: rule
      ? [...inserted.blockRules, { ...rule, blockId: newBlockId }]
      : inserted.blockRules,
  }
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

// The block taken out of the flow, and where everything else sits without it.
function liftTemplateBlock(content: TemplateContentV3, blockId: string): LiftedBlock | null {
  const at = content.blocks.findIndex((block: TemplateBlock): boolean => block.id === blockId)
  const block = content.blocks[at]

  if (!block) {
    return null
  }

  const rest = content.blocks.filter((candidate: TemplateBlock): boolean => candidate.id !== blockId)
  const restIndex = createBlockIndex(rest)
  const follower = content.blocks[at + 1]
  const starts = new Map<number, string>()
  let emptied: string | null = null
  let opens: string | null = null

  for (const section of content.sections) {
    if (section.startBlockId !== blockId) {
      const start = restIndex.get(section.startBlockId)

      if (start !== undefined) {
        starts.set(start, section.id)
      }
    } else if (follower && !content.sections.some((candidate) => candidate.startBlockId === follower.id)) {
      opens = section.id
      starts.set(at, section.id)
    } else {
      opens = section.id
      emptied = section.id
    }
  }

  const ranges = getIndexedFieldGroups(content).map(({ endIndex, group, startIndex }) => ({
    end: at <= endIndex ? endIndex - 1 : endIndex,
    group,
    holds: at >= startIndex && at <= endIndex,
    start: at < startIndex ? startIndex - 1 : startIndex,
  }))
  const own = ranges.find((range) => range.holds && range.end >= range.start) ?? null

  return {
    at,
    block,
    emptied,
    opens,
    others: ranges.filter((range) => !range.holds),
    own: own && { end: own.end, group: own.group, start: own.start },
    rest,
    starts,
  }
}

function currentSlot(lifted: LiftedBlock): TemplateBlockSlot {
  return { index: lifted.at, inGroup: lifted.own !== null, opens: lifted.opens }
}

function isSameSlot(left: TemplateBlockSlot, right: TemplateBlockSlot): boolean {
  return left.index === right.index && left.opens === right.opens && left.inGroup === right.inGroup
}

function createOrderConflict(dependentBlockIds: readonly string[]): Extract<TemplateMoveResult, { success: false }> {
  const fieldWord = dependentBlockIds.length === 1 ? "field" : "fields"

  return {
    code: "visibility_order_conflict",
    dependentBlockIds,
    message: `This move would place ${dependentBlockIds.length} conditional ${fieldWord} before the checkbox or dropdown that controls visibility. Keep each source above the fields it controls, or change the affected conditions first.`,
    success: false,
  }
}

/**
 * Lets go of structure that no longer fits its blocks, as when two people's
 * edits meet: a section, group or rule on a block that is gone, a group that
 * now crosses a section, a condition on a field that moved above its source.
 *
 * @param content - Content whose blocks are settled.
 * @returns The content with only the structure its blocks still support.
 */
export function repairTemplateStructure(content: TemplateContentV3): TemplateContentV3 {
  return reconcileTemplateStructure(content, content.blocks, getIndexedSections(content), getIndexedFieldGroups(content))
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
      !ruleHasEffect(rule)
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
  // Content without sections is one implicit, unlabeled section, and what
  // comes before the first section belongs to none.
  if (blocks.length === 0 || indexedSections.length === 0) {
    return []
  }

  const sectionByStartIndex = new Map<number, TemplateSection>()

  for (const { section, startIndex } of indexedSections) {
    if (startIndex >= 0 && startIndex < blocks.length) {
      sectionByStartIndex.set(startIndex, section)
    }
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

    if (startSectionIndex !== endSectionIndex || groupedBlocks.some(isPinnedBlock)) {
      continue
    }

    const startBlock = blocks[startIndex]
    const endBlock = blocks[endIndex]

    if (startBlock === undefined || endBlock === undefined) {
      continue
    }

    groups.push(
      fitRow({ ...group, startBlockId: startBlock.id, endBlockId: endBlock.id }, groupedBlocks.length)
    )
    seenGroupIds.add(group.id)
    priorEndIndex = endIndex
  }

  return groups
}

// A row sets its blocks side by side, so it never has more columns than
// blocks; widths size columns, so they go when the count changes.
function fitRow(group: TemplateFieldGroup, members: number): TemplateFieldGroup {
  const columns = Math.max(1, Math.min(group.columns, members))
  const fitted = columns === group.columns ? group : { ...group, columns }

  return fitted.widths !== undefined && fitted.widths.length !== columns ? withoutWidths(fitted) : fitted
}

function withoutWidths(group: TemplateFieldGroup): TemplateFieldGroup {
  const { widths, ...rest } = group

  return widths === undefined ? group : rest
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
