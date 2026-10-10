import { z } from "zod"

import { resizeTemplateLayout } from "@/services/templates/template-render-plan"
import { templateBlockSchema, type TemplateBlock, type TemplateContentV3 } from "@/types/template"
import { applyDocumentStyle } from "@/types/template-styles"
import {
  createUniqueTemplateFieldKey,
  deleteTemplateBlock,
  frameOf,
  insertTemplateBlock,
  isTemplateFieldBlock,
  moveTemplateBlockTo,
  placeBeside,
  removeTemplateSection,
  rowOf,
  setBlockRule,
  setRowWidths,
  standAlone,
  startTemplateSection,
  updateTemplateBlock,
  updateTemplateSection,
  type TemplateMoveResult
} from "@/types/template-structure"
import type { TemplateFlowLedgerItem } from "@/types/template-flow"
import {
  type EditableFlowDraft,
  type FlowApplicationResult,
  type FlowOperationPayload,
  type FlowWireOperation,
  type GeneratedBlock,
  TemplateFlowServiceError,
  editableFlowDraftSchema,
} from "@/services/template-flow/contracts"
import { describeOperationTarget } from "@/services/template-flow/prompt"

// The first few things a schema refused, each with where it is.
export function describeZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue): string => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ")
}

type OtherCompanionInvariantContext = {
  affectedDropdownIds: Set<string>
  companionIdsByDropdownId: Map<string, Set<string>>
}

function createOtherCompanionInvariantContext(
  content: TemplateContentV3
): OtherCompanionInvariantContext {
  const context: OtherCompanionInvariantContext = {
    affectedDropdownIds: new Set<string>(),
    companionIdsByDropdownId: new Map<string, Set<string>>()
  }

  for (const block of content.blocks) {
    if (isOtherCompanionBlock(block)) {
      rememberOtherCompanion(
        context,
        block.visibleWhen.sourceBlockId,
        block.id
      )
    }
  }

  return context
}

function recordAffectedOtherDropdowns(
  draft: EditableFlowDraft,
  operation: FlowWireOperation,
  context: OtherCompanionInvariantContext
): void {
  const referencedBlockIds = readOperationBlockReferences(operation)

  for (const blockId of referencedBlockIds) {
    const block = draft.content.blocks.find(
      (candidate: TemplateBlock): boolean => candidate.id === blockId
    )

    if (
      block?.type === "dropdown_field" &&
      block.options.includes("Other")
    ) {
      context.affectedDropdownIds.add(block.id)
    }

    for (const [dropdownId, companionIds] of context.companionIdsByDropdownId) {
      if (companionIds.has(blockId)) {
        context.affectedDropdownIds.add(dropdownId)
      }
    }
  }

  if (operation.type === "update_block") {
    if (
      operation.payload.block.type === "dropdown_field" &&
      operation.payload.block.options.includes("Other")
    ) {
      context.affectedDropdownIds.add(operation.payload.blockId)
    }

    if (isOtherCompanionBlock(operation.payload.block)) {
      rememberOtherCompanion(
        context,
        operation.payload.block.visibleWhen.sourceBlockId,
        operation.payload.blockId
      )
      context.affectedDropdownIds.add(
        operation.payload.block.visibleWhen.sourceBlockId
      )
    }
  }

  if (
    operation.type === "add_block" &&
    isOtherCompanionBlock(operation.payload.block)
  ) {
    context.affectedDropdownIds.add(
      operation.payload.block.visibleWhen.sourceBlockId
    )
  }
}

function readOperationBlockReferences(
  operation: FlowWireOperation
): string[] {
  switch (operation.type) {
    case "set_title":
    case "set_description":
    case "set_branding":
    case "set_layout":
      return []
    case "add_block":
      return operation.payload.afterBlockId === null
        ? []
        : [operation.payload.afterBlockId]
    case "update_block":
    case "update_image":
    case "remove_block":
    case "set_section":
    case "stand_alone":
    case "set_block_rule":
      return [operation.payload.blockId]
    case "set_row":
      return operation.payload.blockIds
    case "move_block":
      return operation.payload.afterBlockId === null
        ? [operation.payload.blockId]
        : [operation.payload.blockId, operation.payload.afterBlockId]
  }
}

function rememberOtherCompanion(
  context: OtherCompanionInvariantContext,
  dropdownId: string,
  companionId: string
): void {
  const companionIds =
    context.companionIdsByDropdownId.get(dropdownId) ?? new Set<string>()
  companionIds.add(companionId)
  context.companionIdsByDropdownId.set(dropdownId, companionIds)
}

/**
 * What the field shown for an "Other" answer asks: the question Flow wrote for
 * it, or else one made from its dropdown's label, never a bare "Please specify".
 */
function otherCompanionLabel(dropdownLabel: string, otherLabel?: string): string {
  if (otherLabel) {
    return otherLabel
  }

  // "Vehicle type" asks "Other vehicle type"; a question has no noun to borrow.
  const noun = /^\p{Lu}\p{Ll}/u.test(dropdownLabel) ? dropdownLabel[0]!.toLowerCase() + dropdownLabel.slice(1) : dropdownLabel

  return dropdownLabel.trim().endsWith("?") ? "Please give details" : `Other ${noun}`.slice(0, 240)
}

function isOtherCompanionBlock<TBlock extends TemplateBlock | GeneratedBlock>(
  block: TBlock
): block is Extract<TBlock, { type: "text_field" }> & {
  visibleWhen: {
    sourceBlockId: string
    operator: "equals"
    value: "Other"
  }
} {
  return (
    block.type === "text_field" &&
    block.visibleWhen?.operator === "equals" &&
    block.visibleWhen.value === "Other"
  )
}

function enforceOtherDropdownCompanions(
  draft: EditableFlowDraft,
  context: OtherCompanionInvariantContext,
  createId: () => string
): {
  changedBlockIds: string[]
  companionByDropdownId: Map<string, string>
} {
  const changedBlockIds = new Set<string>()
  const companionByDropdownId = new Map<string, string>()

  for (const dropdownId of context.affectedDropdownIds) {
    const dropdown = draft.content.blocks.find(
      (block: TemplateBlock): boolean => block.id === dropdownId
    )

    if (
      dropdown?.type !== "dropdown_field" ||
      !dropdown.options.includes("Other")
    ) {
      continue
    }

    const knownCompanionIds =
      context.companionIdsByDropdownId.get(dropdownId) ?? new Set<string>()
    const matchingCompanions = draft.content.blocks.filter(
      (
        block: TemplateBlock
      ): block is Extract<TemplateBlock, { type: "text_field" }> =>
        block.type === "text_field" &&
        (knownCompanionIds.has(block.id) ||
          (isOtherCompanionBlock(block) && block.visibleWhen.sourceBlockId === dropdownId))
    )
    // The earliest known is kept, which is the one the document came with:
    // saved answers are stored under its id and key.
    let keeper = [...knownCompanionIds]
      .map((companionId: string) => matchingCompanions.find((block): boolean => block.id === companionId))
      .find((block) => block !== undefined)

    keeper ??= matchingCompanions[0]

    if (keeper === undefined) {
      keeper = parseCanonicalBlock({
        id: createId(),
        type: "text_field",
        fieldKey: createUniqueTemplateFieldKey(
          otherCompanionLabel(dropdown.label),
          draft.content.blocks
        ),
        label: otherCompanionLabel(dropdown.label),
        required: true,
        helpText: null,
        placeholder: null,
        multiline: false,
        visibleWhen: {
          sourceBlockId: dropdownId,
          operator: "equals",
          value: "Other"
        }
      }) as Extract<TemplateBlock, { type: "text_field" }>
      draft.content = insertTemplateBlock(draft.content, dropdownId, keeper)
      rememberOtherCompanion(context, dropdownId, keeper.id)
    }

    for (const duplicate of matchingCompanions) {
      if (duplicate.id !== keeper.id) {
        draft.content = deleteTemplateBlock(draft.content, duplicate.id)
        changedBlockIds.add(duplicate.id)
      }
    }

    const dropdownIndex = draft.content.blocks.findIndex(
      (block: TemplateBlock): boolean => block.id === dropdownId
    )
    const keeperIndex = draft.content.blocks.findIndex(
      (block: TemplateBlock): boolean => block.id === keeper?.id
    )

    if (keeperIndex !== dropdownIndex + 1) {
      draft.content = moveBlockAfter(draft.content, keeper.id, dropdownId, createId)
    }

    const currentKeeper = draft.content.blocks.find(
      (block: TemplateBlock): boolean => block.id === keeper?.id
    )

    if (currentKeeper?.type !== "text_field") {
      throw invalidOperationError()
    }

    draft.content = updateTemplateBlock(draft.content, {
      ...currentKeeper,
      required: true,
      visibleWhen: {
        sourceBlockId: dropdownId,
        operator: "equals",
        value: "Other"
      }
    })
    changedBlockIds.add(dropdownId)
    changedBlockIds.add(currentKeeper.id)
    companionByDropdownId.set(dropdownId, currentKeeper.id)
  }

  return {
    changedBlockIds: [...changedBlockIds],
    companionByDropdownId
  }
}

export function applyFlowOperations(
  currentDraft: EditableFlowDraft,
  operations: FlowWireOperation[],
  createId: () => string
): FlowApplicationResult {
  const nextDraft = structuredClone(currentDraft) as EditableFlowDraft
  const ledgerItems: TemplateFlowLedgerItem[] = []
  const changedBlockIds = new Set<string>()
  const otherInvariantContext = createOtherCompanionInvariantContext(
    currentDraft.content
  )
  // The fields with a condition, and what it rests on: those the document
  // came with, then each an operation gives one, under that operation's name.
  const conditioned = new Map<string, { source: string | null; where: string }>(
    currentDraft.content.blocks.flatMap((block: TemplateBlock) =>
      isTemplateFieldBlock(block) && block.visibleWhen !== undefined
        ? [[block.id, { source: block.visibleWhen.sourceBlockId, where: "operations" }] as const]
        : []
    )
  )

  // Which change added each block, and every change that touched it, so a
  // change can name the earlier ones it cannot stand without.
  const addedBy = new Map<string, number>()
  const touchedBy = new Map<string, number[]>()

  for (const [index, operation] of operations.entries()) {
    recordAffectedOtherDropdowns(nextDraft, operation, otherInvariantContext)
    const target = describeOperationTarget(nextDraft, operation)
    const dependsOn = readOperationDependencies(operation, addedBy, touchedBy)
    let affectedBlockIds: string[]

    try {
      affectedBlockIds = applyFlowOperation(
        nextDraft,
        operation,
        createId,
        otherInvariantContext
      )
    } catch (error: unknown) {
      // The model is told which of its operations failed, and why.
      throw error instanceof FlowOperationError
        ? new FlowOperationError(`operations[${index}] ${operation.type}: ${error.detail}`)
        : error
    }

    if (
      (operation.type === "add_block" || operation.type === "update_block") &&
      "visibleWhen" in operation.payload.block &&
      operation.payload.block.visibleWhen !== undefined &&
      affectedBlockIds[0] !== undefined
    ) {
      conditioned.set(affectedBlockIds[0], { source: null, where: `operations[${index}] ${operation.type}` })
    }

    affectedBlockIds.forEach((blockId: string): void => {
      changedBlockIds.add(blockId)
      touchedBy.set(blockId, [...(touchedBy.get(blockId) ?? []), index])

      if (operation.type === "add_block") {
        addedBy.set(blockId, index)
      }
    })
    ledgerItems.push({
      id: createId(),
      type: operation.type,
      summary: operation.summary,
      target,
      affectedBlockIds,
      dependsOn
    })
  }

  const invariantResult = enforceOtherDropdownCompanions(
    nextDraft,
    otherInvariantContext,
    createId
  )

  invariantResult.changedBlockIds.forEach((blockId: string): void => {
    changedBlockIds.add(blockId)
  })
  for (const [dropdownId, companionId] of invariantResult.companionByDropdownId) {
    const ledgerItem = ledgerItems.find((item: TemplateFlowLedgerItem): boolean =>
      item.affectedBlockIds.includes(dropdownId)
    )

    if (ledgerItem && !ledgerItem.affectedBlockIds.includes(companionId)) {
      ledgerItem.affectedBlockIds.push(companionId)
    }
  }

  // A condition the document cannot keep is taken off its field, as the field
  // goes in or as a move or a changed choice leaves it pointing nowhere. Once
  // every operation has had its say, one still missing is told to Flow, so a
  // field never ends up shown to everyone by mistake. A field whose source
  // was removed on request has nothing left to depend on.
  for (const [blockId, { source, where }] of conditioned) {
    const kept = nextDraft.content.blocks.find(
      (block: TemplateBlock): boolean => block.id === blockId
    )
    const sourceGone =
      source !== null &&
      !nextDraft.content.blocks.some((block: TemplateBlock): boolean => block.id === source)

    if (kept !== undefined && isTemplateFieldBlock(kept) && kept.visibleWhen === undefined && !sourceGone) {
      throw new FlowOperationError(
        `${where}: the field ${JSON.stringify(kept.label)} would lose its visibleWhen, which must name a dropdown or checkbox that comes before the field, and one of its values`
      )
    }
  }

  const parsedDraft = editableFlowDraftSchema.safeParse(nextDraft)

  if (!parsedDraft.success) {
    throw new FlowOperationError(
      `the document these operations make is not valid: ${describeZodIssues(parsedDraft.error)}`
    )
  }

  return {
    draft: parsedDraft.data,
    ledgerItems,
    changedBlockIds: [...changedBlockIds]
  }
}

// A change needs the change that added any block it names, and a condition
// needs every change that shaped its source, such as the choice it compares to.
// ponytail: blocks only. A change that needs another only for its meaning,
// such as a field added to stand in for one removed, is not linked.
function readOperationDependencies(
  operation: FlowWireOperation,
  addedBy: ReadonlyMap<string, number>,
  touchedBy: ReadonlyMap<string, number[]>
): number[] {
  const condition =
    (operation.type === "add_block" || operation.type === "update_block") && "visibleWhen" in operation.payload.block
      ? operation.payload.block.visibleWhen?.sourceBlockId
      : undefined
  const needed = [
    ...readOperationBlockReferences(operation).map((blockId: string) => addedBy.get(blockId)),
    ...(condition === undefined ? [] : (touchedBy.get(condition) ?? []))
  ].filter((index: number | undefined): index is number => index !== undefined)

  return [...new Set(needed)].sort((left: number, right: number) => left - right)
}

function applyFlowOperation(
  draft: EditableFlowDraft,
  operation: FlowWireOperation,
  createId: () => string,
  otherInvariantContext: OtherCompanionInvariantContext
): string[] {
  switch (operation.type) {
    case "set_title":
      draft.title = operation.payload.value
      return []
    case "set_description":
      draft.description = operation.payload.value
      return []
    case "set_branding":
      applyBrandingOperation(draft, operation.payload)
      return []
    case "add_block":
      return applyAddBlockOperation(
        draft,
        operation.payload,
        createId,
        otherInvariantContext
      )
    case "update_block":
      return applyUpdateBlockOperation(draft, operation.payload)
    case "update_image":
      return applyUpdateImageOperation(draft, operation.payload)
    case "move_block":
      return applyMoveBlockOperation(draft, operation.payload, createId)
    case "remove_block":
      return applyRemoveBlockOperation(draft, operation.payload)
    case "set_section":
      return applySetSectionOperation(draft, operation.payload, createId)
    case "set_row":
      return applySetRowOperation(draft, operation.payload, createId)
    case "stand_alone":
      return applyStandAloneOperation(draft, operation.payload, createId)
    case "set_block_rule":
      return applySetBlockRuleOperation(draft, operation.payload)
    case "set_layout":
      applySetLayoutOperation(draft, operation.payload)
      return []
  }
}

// A style first, then what else was asked, so a request such as "official,
// but with answers on lines" keeps both. New paper keeps every line in place.
function applySetLayoutOperation(
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"set_layout">
): void {
  const { orientation, pageSize, sectionNumbers, style, ...rest } = payload
  let layout = style === undefined ? draft.content.layout : applyDocumentStyle(draft.content.layout, style)

  if (pageSize !== undefined || orientation !== undefined) {
    layout = resizeTemplateLayout(layout, { orientation, pageSize })
  }

  layout = { ...layout, ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)) }

  if (sectionNumbers !== undefined) {
    layout.sectionNumbers = sectionNumbers === "none" ? undefined : sectionNumbers
  }

  if (rest.marginPreset !== undefined) {
    layout.margins = undefined
  }

  draft.content.layout = layout
}

// The editor's own helpers leave the document as it was when they cannot do
// what is asked. Flow is told instead, so nothing is reported done that was not.
function assertBlockExists(draft: EditableFlowDraft, blockId: string): void {
  if (!draft.content.blocks.some((block: TemplateBlock): boolean => block.id === blockId)) {
    throw invalidOperationError("blockId is not a block in the document")
  }
}

function applySetSectionOperation(
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"set_section">,
  createId: () => string
): string[] {
  assertBlockExists(draft, payload.blockId)

  const opened = draft.content.sections.find(
    (section): boolean => section.startBlockId === payload.blockId
  )

  if (payload.label === null) {
    if (opened === undefined) {
      throw invalidOperationError("no section starts at this block, so there is none to end")
    }

    draft.content = removeTemplateSection(draft.content, opened.id)
    return [payload.blockId]
  }

  const sectionId = opened?.id ?? createId()

  if (opened === undefined) {
    const started = startTemplateSection(draft.content, payload.blockId, sectionId, payload.label)

    if (started === draft.content) {
      throw invalidOperationError("the row this block is in already opens a section; name the row's first block")
    }

    draft.content = started
  }

  draft.content = updateTemplateSection(draft.content, sectionId, {
    label: payload.label,
    ...(payload.pageBreakBefore === undefined ? {} : { pageBreakBefore: payload.pageBreakBefore }),
    ...(payload.keepTogether === undefined ? {} : { keepTogether: payload.keepTogether })
  })

  // In a row, the section opens at the row's first block.
  return [draft.content.sections.find((section): boolean => section.id === sectionId)?.startBlockId ?? payload.blockId]
}

function applySetRowOperation(
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"set_row">,
  createId: () => string
): string[] {
  const { blockIds, widths } = payload
  const first = blockIds[0] ?? ""
  const last = blockIds[blockIds.length - 1] ?? ""
  // The row these blocks make up, all of them and no others, in this order.
  const theirRow = (content: TemplateContentV3): TemplateContentV3["fieldGroups"][number] | undefined => {
    const at = content.blocks.findIndex((block: TemplateBlock): boolean => block.id === first)

    return content.fieldGroups.find(
      (group): boolean =>
        group.columns === blockIds.length &&
        group.startBlockId === first &&
        group.endBlockId === last &&
        blockIds.every((blockId: string, index: number): boolean => content.blocks[at + index]?.id === blockId)
    )
  }

  if (new Set(blockIds).size !== blockIds.length) {
    throw invalidOperationError("blockIds must name different blocks")
  }

  blockIds.forEach((blockId: string): void => assertBlockExists(draft, blockId))

  if (widths !== undefined && (widths.length !== blockIds.length || widths.some((width: number): boolean => width < 2) || widths.reduce((total: number, width: number): number => total + width, 0) !== 12)) {
    throw invalidOperationError("widths must give each block a whole number of twelfths, 2 or more, adding up to 12")
  }

  const moved = (result: TemplateMoveResult): TemplateContentV3 => {
    if (!result.success) {
      throw invalidOperationError(result.message)
    }

    return result.content
  }
  let content = draft.content

  // The blocks named stay where they are. Whatever else shares a row with one
  // of them steps out onto its own line, so nothing named moves that need not.
  for (const blockId of blockIds) {
    const row = rowOf(content, blockId)
    const from = content.blocks.findIndex((block: TemplateBlock): boolean => block.id === row?.startBlockId)
    const to = content.blocks.findIndex((block: TemplateBlock): boolean => block.id === row?.endBlockId)

    for (const other of row === undefined ? [] : content.blocks.slice(from, to + 1)) {
      if (!blockIds.includes(other.id)) {
        content = moved(standAlone(content, other.id, createId))
      }
    }
  }

  // Then each joins the one before it, unless they already make the row.
  for (const [index, blockId] of blockIds.entries()) {
    if (index > 0 && theirRow(content) === undefined) {
      content = moved(placeBeside(content, blockId, blockIds[index - 1] ?? "", "right", createId))
    }
  }

  const row = theirRow(content)

  if (row === undefined) {
    throw invalidOperationError("these blocks cannot share one row")
  }

  content = widths === undefined ? content : setRowWidths(content, row.id, widths)

  if (payload.label !== undefined) {
    content = { ...content, fieldGroups: content.fieldGroups.map((group) => (group.id === row.id ? { ...group, label: payload.label ?? null } : group)) }
  }

  draft.content = content
  return [...blockIds]
}

function applyStandAloneOperation(
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"stand_alone">,
  createId: () => string
): string[] {
  assertBlockExists(draft, payload.blockId)

  if ((rowOf(draft.content, payload.blockId)?.columns ?? 1) < 2) {
    throw invalidOperationError("the block is not in a row")
  }

  const result = standAlone(draft.content, payload.blockId, createId)

  if (!result.success) {
    throw invalidOperationError(result.message)
  }

  draft.content = result.content
  return [payload.blockId]
}

function applySetBlockRuleOperation(
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"set_block_rule">
): string[] {
  const { blockId, frame, ...rules } = payload

  assertBlockExists(draft, blockId)

  if (frame === undefined && Object.keys(rules).length === 0) {
    throw invalidOperationError("say what to change: pageBreakBefore, keepWithNext, spaceAbove or frame")
  }

  if (frame && (rowOf(draft.content, blockId)?.columns ?? 1) > 1) {
    throw invalidOperationError("a frame places a block that is alone on its line; this one is in a row, so size it with set_row widths")
  }

  draft.content = setBlockRule(draft.content, blockId, {
    ...rules,
    // Null puts the block back across the whole page.
    ...(frame === undefined ? {} : { frame: frame === null ? undefined : frameOf(frame.left, frame.width) })
  })
  return [blockId]
}

function applyBrandingOperation(
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"set_branding">
): void {
  if (payload.organizationName !== undefined) {
    draft.content.branding.organizationName = payload.organizationName
  }
  if (payload.primaryColor !== undefined) {
    draft.content.branding.primaryColor = payload.primaryColor
  }
  if (payload.accentColor !== undefined) {
    draft.content.branding.accentColor = payload.accentColor
  }
  if (payload.logoAlignment !== undefined) {
    draft.content.branding.logoAlignment = payload.logoAlignment
  }
  if (payload.logoWidthPercent !== undefined) {
    draft.content.branding.logoWidthPercent = payload.logoWidthPercent
  }
  if (payload.removeLogo === true) {
    draft.content.branding.logoAsset = null
    draft.content.branding.logoDataUrl = null
  }
}

function applyAddBlockOperation(
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"add_block">,
  createId: () => string,
  otherInvariantContext: OtherCompanionInvariantContext
): string[] {
  if (
    payload.afterBlockId !== null &&
    !draft.content.blocks.some(
      (block: TemplateBlock): boolean => block.id === payload.afterBlockId
    )
  ) {
    throw invalidOperationError("afterBlockId is not a block in the document")
  }

  const blockId = payload.id ?? createId()
  const block = createGeneratedTemplateBlock(
    payload.block,
    blockId,
    draft.content
  )
  const resolvedAfterBlockId =
    payload.afterBlockId ??
    draft.content.blocks[draft.content.blocks.length - 1]?.id ??
    null

  draft.content = insertTemplateBlock(
    draft.content,
    resolvedAfterBlockId,
    block
  )
  const affectedBlockIds = [block.id]

  if (
    block.type === "text_field" &&
    block.visibleWhen?.operator === "equals" &&
    block.visibleWhen.value === "Other"
  ) {
    rememberOtherCompanion(
      otherInvariantContext,
      block.visibleWhen.sourceBlockId,
      block.id
    )
    otherInvariantContext.affectedDropdownIds.add(
      block.visibleWhen.sourceBlockId
    )
  }

  if (block.type === "dropdown_field" && block.options.includes("Other")) {
    const label = otherCompanionLabel(block.label, payload.block.type === "dropdown_field" ? payload.block.otherLabel : undefined)
    const specifyBlock = parseCanonicalBlock({
      id: createId(),
      type: "text_field",
      fieldKey: createUniqueTemplateFieldKey(label, draft.content.blocks),
      label,
      required: true,
      helpText: null,
      placeholder: null,
      multiline: false,
      visibleWhen: {
        sourceBlockId: block.id,
        operator: "equals",
        value: "Other"
      }
    })

    draft.content = insertTemplateBlock(
      draft.content,
      block.id,
      specifyBlock
    )
    rememberOtherCompanion(otherInvariantContext, block.id, specifyBlock.id)
    otherInvariantContext.affectedDropdownIds.add(block.id)
    affectedBlockIds.push(specifyBlock.id)
  }

  return affectedBlockIds
}

function applyUpdateBlockOperation(
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"update_block">
): string[] {
  const blockIndex = draft.content.blocks.findIndex(
    (block: TemplateBlock): boolean => block.id === payload.blockId
  )

  if (blockIndex === -1) {
    throw invalidOperationError("blockId is not a block in the document")
  }

  const existingBlock = draft.content.blocks[blockIndex]

  if (
    existingBlock?.type === "image" ||
    payload.block.type !== existingBlock?.type
  ) {
    throw invalidOperationError(
      `the block is a ${existingBlock?.type}; update_block keeps a block's type, and update_image changes an image`
    )
  }

  const candidate: Record<string, unknown> = {
    // Flow writes words, not formatting: words it leaves alone keep theirs,
    // and a box keeps the height and signer its author gave it unless Flow sets them.
    ..."runs" in existingBlock ? { runs: existingBlock.runs } : {},
    ..."itemRuns" in existingBlock ? { itemRuns: existingBlock.itemRuns } : {},
    ..."boxHeight" in existingBlock ? { boxHeight: existingBlock.boxHeight } : {},
    ..."signer" in existingBlock ? { signer: existingBlock.signer } : {},
    ...payload.block,
    id: payload.blockId
  }

  if (
    existingBlock !== undefined &&
    isTemplateFieldBlock(existingBlock) &&
    "fieldKey" in payload.block
  ) {
    candidate.fieldKey = existingBlock.fieldKey

    if (
      existingBlock.visibleWhen !== undefined &&
      payload.block.visibleWhen === undefined
    ) {
      candidate.visibleWhen = existingBlock.visibleWhen
    }

    // A date's format is the author's regional choice; Flow keeps it unless asked.
    if (
      existingBlock.type === "date_field" &&
      payload.block.type === "date_field" &&
      payload.block.dateFormat === undefined
    ) {
      candidate.dateFormat = existingBlock.dateFormat
    }
  }

  const block = parseCanonicalBlock(candidate)
  draft.content = updateTemplateBlock(draft.content, block)
  return [payload.blockId]
}

function applyUpdateImageOperation(
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"update_image">
): string[] {
  const blockIndex = draft.content.blocks.findIndex(
    (block: TemplateBlock): boolean => block.id === payload.blockId
  )
  const existingBlock = draft.content.blocks[blockIndex]

  if (blockIndex === -1 || existingBlock?.type !== "image") {
    throw invalidOperationError()
  }

  draft.content = updateTemplateBlock(draft.content, {
    ...existingBlock,
    altText: payload.altText,
    caption: payload.caption,
    alignment: payload.alignment,
    widthPercent: payload.widthPercent
  })
  return [payload.blockId]
}

function applyMoveBlockOperation(
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"move_block">,
  createId: () => string
): string[] {
  const sourceExists = draft.content.blocks.some(
    (block: TemplateBlock): boolean => block.id === payload.blockId
  )
  const destinationExists =
    payload.afterBlockId === null ||
    draft.content.blocks.some(
      (block: TemplateBlock): boolean => block.id === payload.afterBlockId
    )

  if (
    !sourceExists ||
    !destinationExists ||
    payload.afterBlockId === payload.blockId
  ) {
    throw invalidOperationError()
  }

  draft.content = moveBlockAfter(draft.content, payload.blockId, payload.afterBlockId, createId)
  return [payload.blockId]
}

// Moves one block to follow another as the editor does: only that block moves,
// and every other block keeps its section and its row.
function moveBlockAfter(
  content: EditableFlowDraft["content"],
  blockId: string,
  afterBlockId: string | null,
  createId: () => string
): EditableFlowDraft["content"] {
  const rest = content.blocks.filter((block: TemplateBlock): boolean => block.id !== blockId)
  const index = afterBlockId === null ? 0 : rest.findIndex((block: TemplateBlock): boolean => block.id === afterBlockId) + 1
  const moved = moveTemplateBlockTo(content, blockId, { index, inGroup: false, opens: null }, createId())

  if (!moved.success) {
    throw invalidOperationError(moved.message)
  }

  return moved.content
}

function applyRemoveBlockOperation(
  draft: EditableFlowDraft,
  payload: FlowOperationPayload<"remove_block">
): string[] {
  const blockExists = draft.content.blocks.some(
    (block: TemplateBlock): boolean => block.id === payload.blockId
  )

  if (!blockExists) {
    throw invalidOperationError()
  }

  draft.content = deleteTemplateBlock(draft.content, payload.blockId)
  return [payload.blockId]
}

function createGeneratedTemplateBlock(
  generatedBlock: GeneratedBlock,
  blockId: string,
  content: TemplateContentV3
): TemplateBlock {
  const candidate: Record<string, unknown> = {
    ...generatedBlock,
    id: blockId
  }

  // Names the field Flow adds for an "Other" answer; the dropdown does not keep it.
  delete candidate.otherLabel

  if ("fieldKey" in generatedBlock) {
    candidate.fieldKey = createUniqueTemplateFieldKey(
      generatedBlock.label,
      content.blocks
    )
  }

  return parseCanonicalBlock(candidate)
}

function parseCanonicalBlock(candidate: unknown): TemplateBlock {
  const result = templateBlockSchema.safeParse(candidate)

  if (!result.success) {
    throw invalidOperationError(`the block is not valid: ${describeZodIssues(result.error)}`)
  }

  return result.data
}

function invalidOperationError(detail = "it does not fit the document"): FlowOperationError {
  return new FlowOperationError(detail)
}

/** An operation the document refused, with why, for the model's one correction. */
export class FlowOperationError extends TemplateFlowServiceError {
  readonly detail: string

  constructor(detail: string) {
    super("Flow returned an edit operation that failed validation.", 502)
    this.detail = detail
  }
}
