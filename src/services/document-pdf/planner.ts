import {
  shouldRenderTemplateFooter,
  shouldRenderTemplateHeader,
  type TemplateRenderBlock
} from "@/services/templates/template-render-plan"
import type { TemplateBlock, TemplateContent } from "@/types/template"

import {
  FIELD_CHUNK_CHARACTERS,
  LIST_CHUNK_HEIGHT,
  LIST_ENTRY_CHUNK_CHARACTERS,
  PAGE_FLOW_HEIGHT,
  PARAGRAPH_CHUNK_CHARACTERS,
  TABLE_CHUNK_HEIGHT
} from "./constants"
import { DocumentPdfServiceError } from "./errors"
import {
  createPdfLayoutMetrics,
  getPdfColumnWidth,
  scalePdfCharacterEstimate,
  type PdfLayoutMetrics
} from "./layout"
import { formatFieldValue, normalizeDrawingDataUrl } from "./shared"
import type {
  DocumentPdfSigner,
  NormalizedPdfInput,
  PdfBlockFlowItem,
  PdfFlowItem,
  PdfPagePlan
} from "./types"

type PdfPaginationUnit = Readonly<{
  item: PdfFlowItem
  pageBreakBefore: boolean
  keepTogetherKeys: readonly string[]
  keepWithNext: boolean
}>

type MutablePdfPage = {
  plan: PdfPagePlan
  height: number
  contentItemCount: number
}

/**
 * Creates deterministic printable page plans from normalized document input.
 *
 * @param input - Validated PDF input with a canonical template render plan.
 * @returns Ordered page plans consumed by the production renderer.
 * @throws DocumentPdfServiceError when a repeated region or block cannot fit.
 */
export function createPdfPagePlans(input: NormalizedPdfInput): PdfPagePlan[] {
  const metrics = createPdfLayoutMetrics(
    input.renderPlan.geometry,
    input.renderPlan.layout
  )
  const units = createPdfPaginationUnits(input, metrics)
  const pages: PdfPagePlan[] = []
  let pageNumber = 1
  let currentPage = createMutablePdfPage(input, metrics, pageNumber)
  let unitIndex = 0

  while (unitIndex < units.length) {
    const unit = units[unitIndex]
    const itemHeight = estimateFlowItemHeight(unit.item, input, metrics)
    const usableEmptyCapacity = getEmptyPageContentCapacity(
      input,
      metrics,
      pageNumber
    )
    const nextEmptyCapacity = getEmptyPageContentCapacity(
      input,
      metrics,
      pageNumber + 1
    )

    if (itemHeight > usableEmptyCapacity) {
      if (
        currentPage.contentItemCount > 0 &&
        itemHeight <= nextEmptyCapacity
      ) {
        pages.push(currentPage.plan)
        pageNumber += 1
        currentPage = createMutablePdfPage(input, metrics, pageNumber)
        continue
      }

      throw new DocumentPdfServiceError(
        "A document block is too tall to fit on a printable page.",
        400
      )
    }

    const remainingCapacity = metrics.pageCapacity - currentPage.height
    const shouldForceBreak =
      currentPage.contentItemCount > 0 && unit.pageBreakBefore
    const shouldKeepRunOnNextPage =
      currentPage.contentItemCount > 0 &&
      shouldMoveKeepTogetherRun(
        units,
        unitIndex,
        remainingCapacity,
        nextEmptyCapacity,
        input,
        metrics
      )
    const shouldKeepChainOnNextPage =
      currentPage.contentItemCount > 0 &&
      unit.keepWithNext &&
      shouldMoveKeepWithNextChain(
        units,
        unitIndex,
        remainingCapacity,
        nextEmptyCapacity,
        input,
        metrics
      )
    const shouldBreakForCapacity =
      currentPage.contentItemCount > 0 && itemHeight > remainingCapacity

    if (
      shouldForceBreak ||
      shouldKeepRunOnNextPage ||
      shouldKeepChainOnNextPage ||
      shouldBreakForCapacity
    ) {
      pages.push(currentPage.plan)
      pageNumber += 1
      currentPage = createMutablePdfPage(input, metrics, pageNumber)
      continue
    }

    currentPage.plan.items.push(unit.item)
    currentPage.height += itemHeight
    currentPage.contentItemCount += 1
    unitIndex += 1
  }

  if (currentPage.plan.items.length > 0 || pages.length === 0) {
    pages.push(currentPage.plan)
  }

  return pages
}

function createMutablePdfPage(
  input: NormalizedPdfInput,
  metrics: PdfLayoutMetrics,
  pageNumber: number
): MutablePdfPage {
  const showHeader =
    shouldRenderTemplateHeader(input.renderPlan.layout, pageNumber) &&
    hasBranding(input.content)
  const showFooter =
    shouldRenderTemplateFooter(input.renderPlan.layout, pageNumber) &&
    input.renderPlan.layout.pageNumbering === "page_x_of_y"
  const items: PdfFlowItem[] = []
  let height = 0

  if (showHeader) {
    const brandingItem: PdfFlowItem = { kind: "branding" }

    items.push(brandingItem)
    height = estimateFlowItemHeight(brandingItem, input, metrics)
  }

  if (height > metrics.pageCapacity) {
    throw new DocumentPdfServiceError(
      "The document header is too tall to fit on a printable page.",
      400
    )
  }

  return {
    plan: {
      items,
      showFooter,
      showHeader,
      showPageNumber: showFooter
    },
    height,
    contentItemCount: 0
  }
}

function getEmptyPageContentCapacity(
  input: NormalizedPdfInput,
  metrics: PdfLayoutMetrics,
  pageNumber: number
): number {
  if (
    !shouldRenderTemplateHeader(input.renderPlan.layout, pageNumber) ||
    !hasBranding(input.content)
  ) {
    return metrics.pageCapacity
  }

  return (
    metrics.pageCapacity -
    estimateFlowItemHeight({ kind: "branding" }, input, metrics)
  )
}

function createPdfPaginationUnits(
  input: NormalizedPdfInput,
  metrics: PdfLayoutMetrics
): PdfPaginationUnit[] {
  const units: PdfPaginationUnit[] = [
    {
      item: { kind: "title", title: input.renderPlan.title },
      pageBreakBefore: false,
      keepTogetherKeys: [],
      keepWithNext: false
    },
    ...createBlockPaginationUnits(input, metrics)
  ]

  if (input.signers.length > 0) {
    units.push({
      item: { kind: "signing_intro" },
      pageBreakBefore: false,
      keepTogetherKeys: [],
      keepWithNext: true
    })
    units.push(
      ...input.signers.map(
        (signer: DocumentPdfSigner): PdfPaginationUnit => ({
          item: { kind: "signer", signer },
          pageBreakBefore: false,
          keepTogetherKeys: [],
          keepWithNext: false
        })
      )
    )
  }

  return units
}

function createBlockPaginationUnits(
  input: NormalizedPdfInput,
  metrics: PdfLayoutMetrics
): PdfPaginationUnit[] {
  const units: PdfPaginationUnit[] = []
  const blocks = input.renderPlan.blocks
  let blockIndex = 0

  while (blockIndex < blocks.length) {
    const renderBlock = blocks[blockIndex]
    const priorBlock = blocks[blockIndex - 1]
    const startsSection =
      blockIndex === 0 || priorBlock?.sectionId !== renderBlock.sectionId
    const startsFieldGroup =
      renderBlock.fieldGroupId !== null &&
      priorBlock?.fieldGroupId !== renderBlock.fieldGroupId
    const structureLabelUnits = createStructureLabelUnits(
      renderBlock,
      input,
      startsSection,
      startsFieldGroup
    )

    units.push(...structureLabelUnits)

    if (renderBlock.fieldGroupId && renderBlock.fieldGroupColumns === 2) {
      const groupedBlocks: TemplateRenderBlock[] = []
      let groupIndex = blockIndex

      while (
        groupIndex < blocks.length &&
        blocks[groupIndex]?.fieldGroupId === renderBlock.fieldGroupId &&
        blocks[groupIndex]?.fieldGroupColumns === 2
      ) {
        groupedBlocks.push(blocks[groupIndex])
        groupIndex += 1
      }

      const columnUnits = createTwoColumnPaginationUnits(
          groupedBlocks,
          input,
          metrics
        )

      units.push(
        ...clearLeadingPageBreak(
          columnUnits,
          structureLabelUnits.length > 0
        )
      )
      blockIndex = groupIndex
      continue
    }

    const blockUnits = createSingleBlockPaginationUnits(
      renderBlock,
      input,
      metrics
    )
    units.push(
      ...clearLeadingPageBreak(blockUnits, structureLabelUnits.length > 0)
    )
    blockIndex += 1
  }

  return units
}

function createStructureLabelUnits(
  renderBlock: TemplateRenderBlock,
  input: NormalizedPdfInput,
  startsSection: boolean,
  startsFieldGroup: boolean
): PdfPaginationUnit[] {
  const units: PdfPaginationUnit[] = []
  const keepTogetherKeys = getKeepTogetherKeys(renderBlock, input)

  if (startsSection && renderBlock.sectionLabel) {
    units.push({
      item: { kind: "section_label", label: renderBlock.sectionLabel },
      pageBreakBefore: renderBlock.pageBreakBefore,
      keepTogetherKeys,
      keepWithNext: true
    })
  }

  if (startsFieldGroup && renderBlock.fieldGroupLabel) {
    units.push({
      item: {
        kind: "field_group_label",
        label: renderBlock.fieldGroupLabel
      },
      pageBreakBefore:
        units.length === 0 && renderBlock.pageBreakBefore,
      keepTogetherKeys,
      keepWithNext: true
    })
  }

  return units
}

function clearLeadingPageBreak(
  units: readonly PdfPaginationUnit[],
  shouldClear: boolean
): PdfPaginationUnit[] {
  if (!shouldClear || units.length === 0) {
    return [...units]
  }

  return units.map(
    (unit: PdfPaginationUnit, index: number): PdfPaginationUnit =>
      index === 0 ? { ...unit, pageBreakBefore: false } : unit
  )
}

function createSingleBlockPaginationUnits(
  renderBlock: TemplateRenderBlock,
  input: NormalizedPdfInput,
  metrics: PdfLayoutMetrics
): PdfPaginationUnit[] {
  const items = expandBlockForPagination(
    renderBlock,
    input.answers,
    metrics.contentWidth,
    metrics.pageCapacity
  )
  const keepTogetherKeys = getKeepTogetherKeys(renderBlock, input)

  return items.map(
    (item: PdfBlockFlowItem, itemIndex: number): PdfPaginationUnit => ({
      item,
      pageBreakBefore: itemIndex === 0 && renderBlock.pageBreakBefore,
      keepTogetherKeys,
      keepWithNext:
        itemIndex === items.length - 1 && renderBlock.keepWithNext
    })
  )
}

function createTwoColumnPaginationUnits(
  renderBlocks: readonly TemplateRenderBlock[],
  input: NormalizedPdfInput,
  metrics: PdfLayoutMetrics
): PdfPaginationUnit[] {
  const units: PdfPaginationUnit[] = []
  const columnWidth = getPdfColumnWidth(metrics)
  let blockIndex = 0

  while (blockIndex < renderBlocks.length) {
    const leftBlock = renderBlocks[blockIndex]
    const nextBlock = renderBlocks[blockIndex + 1]
    const rightBlock = nextBlock?.pageBreakBefore ? undefined : nextBlock
    const leftItems = expandBlockForPagination(
      leftBlock,
      input.answers,
      columnWidth,
      metrics.pageCapacity
    )
    const rightItems = rightBlock
      ? expandBlockForPagination(
          rightBlock,
          input.answers,
          columnWidth,
          metrics.pageCapacity
        )
      : []
    const rowCount = Math.max(leftItems.length, rightItems.length)

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const left = leftItems[rowIndex]
      const right = rightItems[rowIndex]

      if (!left && !right) {
        continue
      }

      const keepTogetherKeys = Array.from(
        new Set<string>([
          ...getKeepTogetherKeys(leftBlock, input),
          ...(rightBlock ? getKeepTogetherKeys(rightBlock, input) : [])
        ])
      )
      const isLastRow = rowIndex === rowCount - 1

      units.push({
        item: {
          kind: "columns",
          ...(left ? { left } : {}),
          ...(right ? { right } : {})
        },
        pageBreakBefore: rowIndex === 0 && leftBlock.pageBreakBefore,
        keepTogetherKeys,
        keepWithNext:
          isLastRow &&
          (rightBlock?.keepWithNext === true ||
            (rightBlock === undefined && leftBlock.keepWithNext))
      })
    }

    blockIndex += rightBlock ? 2 : 1
  }

  return units
}

function getKeepTogetherKeys(
  renderBlock: TemplateRenderBlock,
  input: NormalizedPdfInput
): string[] {
  if (!renderBlock.keepTogether) {
    return []
  }

  const keys: string[] = []
  const sectionKeepsTogether = input.renderPlan.sections.some(
    (section): boolean =>
      section.id === renderBlock.sectionId && section.keepTogether
  )

  if (sectionKeepsTogether && renderBlock.sectionId) {
    keys.push(`section:${renderBlock.sectionId}`)
  } else if (renderBlock.fieldGroupId) {
    // A decorated block is keep-together because either its section or field
    // group requests it. Once a kept section is ruled out, the group is the
    // remaining source of the constraint.
    keys.push(`field-group:${renderBlock.fieldGroupId}`)
  }

  return keys
}

function expandBlockForPagination(
  renderBlock: TemplateRenderBlock,
  answers: Record<string, unknown>,
  availableWidth: number,
  pageCapacity: number
): PdfBlockFlowItem[] {
  const { block } = renderBlock

  switch (block.type) {
    case "paragraph":
      return splitText(
        block.text,
        resolveChunkCharacters(
          PARAGRAPH_CHUNK_CHARACTERS,
          availableWidth,
          pageCapacity
        )
      ).map(
        (text: string): PdfBlockFlowItem => ({
          kind: "block",
          block: { ...block, text },
          renderBlock
        })
      )
    case "bullet_list":
    case "numbered_list":
      return splitListBlock(block, renderBlock, availableWidth, pageCapacity)
    case "table":
      return splitTableBlock(block, renderBlock, availableWidth, pageCapacity)
    case "signature_field":
    case "initials_field":
    case "file_field":
      return [{ kind: "block", block, renderBlock }]
    case "text_field":
    case "date_field":
    case "checkbox_field":
    case "dropdown_field": {
      const answer = formatFieldValue(block, answers[block.fieldKey])

      return splitText(
        answer,
        resolveChunkCharacters(
          FIELD_CHUNK_CHARACTERS,
          availableWidth,
          pageCapacity
        )
      ).map(
        (answerOverride: string, index: number): PdfBlockFlowItem => ({
          kind: "block",
          block,
          renderBlock,
          answerOverride,
          fieldContinued: index > 0
        })
      )
    }
    default:
      return [{ kind: "block", block, renderBlock }]
  }
}

function splitListBlock(
  block: Extract<
    TemplateBlock,
    { type: "bullet_list" } | { type: "numbered_list" }
  >,
  renderBlock: TemplateRenderBlock,
  availableWidth: number,
  pageCapacity: number
): PdfBlockFlowItem[] {
  const entryCharacters = resolveChunkCharacters(
    LIST_ENTRY_CHUNK_CHARACTERS,
    availableWidth,
    pageCapacity
  )
  const entries = block.items.flatMap(
    (
      item: string,
      itemIndex: number
    ): Array<{ marker: string; text: string }> =>
      splitText(item, entryCharacters).map(
        (
          text: string,
          chunkIndex: number
        ): { marker: string; text: string } => ({
          marker:
            chunkIndex === 0
              ? block.type === "bullet_list"
                ? "-"
                : `${itemIndex + 1}.`
              : "",
          text
        })
      )
  )
  const chunks: PdfBlockFlowItem[] = []
  const chunkHeight = Math.min(LIST_CHUNK_HEIGHT, pageCapacity * 0.72)
  let currentEntries: Array<{ marker: string; text: string }> = []
  let currentHeight = 0

  const flush = (): void => {
    if (currentEntries.length === 0) {
      return
    }

    chunks.push({
      kind: "block",
      block: {
        ...block,
        items: currentEntries.map(
          (entry: { marker: string; text: string }): string => entry.text
        )
      },
      renderBlock,
      listMarkers: currentEntries.map(
        (entry: { marker: string; text: string }): string => entry.marker
      )
    })
    currentEntries = []
    currentHeight = 0
  }

  for (const entry of entries) {
    const entryHeight = estimateListEntryHeight(entry.text, availableWidth)

    if (
      currentEntries.length > 0 &&
      currentHeight + entryHeight > chunkHeight
    ) {
      flush()
    }

    currentEntries.push(entry)
    currentHeight += entryHeight
  }

  flush()
  return chunks
}

function splitTableBlock(
  block: Extract<TemplateBlock, { type: "table" }>,
  renderBlock: TemplateRenderBlock,
  availableWidth: number,
  pageCapacity: number
): PdfBlockFlowItem[] {
  const columnCount = block.headers.length
  const expandedRows = block.rows.flatMap((row: string[]): string[][] =>
    splitTableRow(row, columnCount, availableWidth)
  )

  if (expandedRows.length === 0) {
    return [{ kind: "block", block, renderBlock }]
  }

  const chunks: PdfBlockFlowItem[] = []
  const headerHeight = estimateTableRowHeight(
    block.headers,
    columnCount,
    availableWidth
  )
  const chunkHeight = Math.min(TABLE_CHUNK_HEIGHT, pageCapacity * 0.72)
  let currentRows: string[][] = []
  let currentHeight = headerHeight

  const flush = (): void => {
    if (currentRows.length === 0) {
      return
    }

    chunks.push({
      kind: "block",
      block: { ...block, rows: currentRows },
      renderBlock
    })
    currentRows = []
    currentHeight = headerHeight
  }

  for (const row of expandedRows) {
    const rowHeight = estimateTableRowHeight(
      row,
      columnCount,
      availableWidth
    )

    if (
      currentRows.length > 0 &&
      currentHeight + rowHeight > chunkHeight
    ) {
      flush()
    }

    currentRows.push(row)
    currentHeight += rowHeight
  }

  flush()
  return chunks
}

function splitTableRow(
  row: string[],
  columnCount: number,
  availableWidth: number
): string[][] {
  const baselineSegmentLength = Math.max(40, Math.floor(850 / columnCount))
  const segmentLength = scalePdfCharacterEstimate(
    baselineSegmentLength,
    availableWidth
  )
  const cellSegments = Array.from(
    { length: columnCount },
    (_value: unknown, index: number): string[] =>
      splitText(row[index] ?? "", segmentLength)
  )
  const segmentCount = Math.max(
    1,
    ...cellSegments.map((segments: string[]): number => segments.length)
  )

  return Array.from(
    { length: segmentCount },
    (_value: unknown, segmentIndex: number): string[] =>
      cellSegments.map(
        (segments: string[]): string => segments[segmentIndex] ?? ""
      )
  )
}

function splitText(value: string, maximumCharacters: number): string[] {
  const normalized = value.replace(/\s+/g, " ").trim()

  if (normalized.length === 0) {
    return [""]
  }

  const chunks: string[] = []
  let remaining = normalized

  while (remaining.length > maximumCharacters) {
    const candidate = remaining.slice(0, maximumCharacters + 1)
    const whitespaceIndex = candidate.lastIndexOf(" ")
    const splitIndex =
      whitespaceIndex >= Math.floor(maximumCharacters * 0.6)
        ? whitespaceIndex
        : maximumCharacters
    const chunk = remaining.slice(0, splitIndex).trim()

    chunks.push(chunk)
    remaining = remaining.slice(splitIndex).trim()
  }

  if (remaining.length > 0) {
    chunks.push(remaining)
  }

  return chunks
}

function resolveChunkCharacters(
  baselineCharacters: number,
  availableWidth: number,
  pageCapacity: number
): number {
  const widthAdjusted = scalePdfCharacterEstimate(
    baselineCharacters,
    availableWidth
  )

  return Math.max(
    120,
    Math.floor(widthAdjusted * Math.min(1, pageCapacity / PAGE_FLOW_HEIGHT))
  )
}

function estimateFlowItemHeight(
  item: PdfFlowItem,
  input: NormalizedPdfInput,
  metrics: PdfLayoutMetrics
): number {
  let baseHeight: number

  switch (item.kind) {
    case "branding":
      baseHeight = estimateBrandingHeight(input.content)
      break
    case "title":
      baseHeight =
        estimateWrappedTextHeight(
          item.title,
          scalePdfCharacterEstimate(55, metrics.contentWidth),
          35
        ) + 16
      break
    case "section_label":
      baseHeight =
        estimateWrappedTextHeight(
          item.label,
          scalePdfCharacterEstimate(65, metrics.contentWidth),
          22
        ) + 10
      break
    case "field_group_label":
      baseHeight =
        estimateWrappedTextHeight(
          item.label,
          scalePdfCharacterEstimate(90, metrics.contentWidth),
          13
        ) + 8
      break
    case "block":
      baseHeight = estimateBlockHeight(
        item.block,
        input.answers,
        metrics.contentWidth,
        item.answerOverride
      )
      break
    case "columns": {
      const columnWidth = getPdfColumnWidth(metrics)
      const leftHeight = item.left
        ? estimateBlockHeight(
            item.left.block,
            input.answers,
            columnWidth,
            item.left.answerOverride
          )
        : 0
      const rightHeight = item.right
        ? estimateBlockHeight(
            item.right.block,
            input.answers,
            columnWidth,
            item.right.answerOverride
          )
        : 0

      baseHeight = Math.max(leftHeight, rightHeight)
      break
    }
    case "signing_intro":
      baseHeight = 52
      break
    case "signer":
      baseHeight = Math.max(
        item.signer.signatureDataUrl || item.signer.initialsDataUrl ? 74 : 60,
        estimateWrappedTextHeight(
          item.signer.name,
          scalePdfCharacterEstimate(75, metrics.contentWidth),
          12
        ) +
          estimateWrappedTextHeight(
            item.signer.email,
            scalePdfCharacterEstimate(90, metrics.contentWidth),
            10
          ) +
          24
      )
      break
  }

  return Math.max(1, baseHeight + metrics.densityItemGapAdjustment)
}

function estimateBlockHeight(
  block: TemplateBlock,
  answers: Record<string, unknown>,
  availableWidth: number,
  answerOverride?: string
): number {
  switch (block.type) {
    case "heading": {
      const baselineCharacters =
        block.level === 1 ? 55 : block.level === 2 ? 65 : 75
      const lineHeight = block.level === 1 ? 29 : block.level === 2 ? 24 : 20

      return (
        estimateWrappedTextHeight(
          block.text,
          scalePdfCharacterEstimate(baselineCharacters, availableWidth),
          lineHeight
        ) + 16
      )
    }
    case "paragraph":
      return (
        estimateWrappedTextHeight(
          block.text,
          scalePdfCharacterEstimate(88, availableWidth),
          15
        ) + 10
      )
    case "bullet_list":
    case "numbered_list":
      return (
        block.items.reduce(
          (height: number, item: string): number =>
            height + estimateListEntryHeight(item, availableWidth),
          0
        ) + 8
      )
    case "image":
      return block.caption ? 292 : 274
    case "table":
      return (
        estimateTableRowHeight(
          block.headers,
          block.headers.length,
          availableWidth
        ) +
        block.rows.reduce(
          (height: number, row: string[]): number =>
            height +
            estimateTableRowHeight(
              row,
              block.headers.length,
              availableWidth
            ),
          0
        ) +
        10
      )
    case "divider":
      return 20
    case "signature_field":
    case "initials_field":
      return normalizeDrawingDataUrl(answers[block.fieldKey]) ? 78 : 48
    case "file_field": {
      const labelHeight = estimateWrappedTextHeight(
        block.label,
        scalePdfCharacterEstimate(78, availableWidth),
        13
      )
      const noticeHeight = estimateWrappedTextHeight(
        "File uploads are available only in internal submissions.",
        scalePdfCharacterEstimate(88, availableWidth),
        15
      )
      const helpHeight = block.helpText
        ? estimateWrappedTextHeight(
            block.helpText,
            scalePdfCharacterEstimate(110, availableWidth),
            10
          )
        : 0

      return labelHeight + noticeHeight + helpHeight + 20
    }
    default: {
      const answer =
        answerOverride ?? formatFieldValue(block, answers[block.fieldKey])
      const labelHeight = estimateWrappedTextHeight(
        block.label,
        scalePdfCharacterEstimate(78, availableWidth),
        13
      )
      const answerHeight = estimateWrappedTextHeight(
        answer,
        scalePdfCharacterEstimate(88, availableWidth),
        15
      )
      const helpHeight = block.helpText
        ? estimateWrappedTextHeight(
            block.helpText,
            scalePdfCharacterEstimate(110, availableWidth),
            10
          )
        : 0

      return labelHeight + answerHeight + helpHeight + 20
    }
  }
}

function estimateBrandingHeight(content: TemplateContent): number {
  return hasBranding(content) ? 46 : 0
}

function hasBranding(content: TemplateContent): boolean {
  return Boolean(
    content.branding.logoDataUrl || content.branding.organizationName
  )
}

function estimateListEntryHeight(
  value: string,
  availableWidth: number
): number {
  return (
    estimateWrappedTextHeight(
      value,
      scalePdfCharacterEstimate(82, availableWidth),
      15
    ) + 4
  )
}

function estimateTableRowHeight(
  cells: string[],
  columnCount: number,
  availableWidth: number
): number {
  const charactersPerLine = scalePdfCharacterEstimate(
    Math.max(4, Math.floor(103 / columnCount)),
    availableWidth
  )
  const maximumLines = Math.max(
    1,
    ...cells.map((cell: string): number =>
      Math.ceil(Math.max(1, cell.length) / charactersPerLine)
    )
  )

  return maximumLines * 15 + 12
}

function estimateWrappedTextHeight(
  value: string,
  charactersPerLine: number,
  lineHeight: number
): number {
  return (
    Math.max(1, Math.ceil(Math.max(1, value.length) / charactersPerLine)) *
    lineHeight
  )
}

function shouldMoveKeepTogetherRun(
  units: readonly PdfPaginationUnit[],
  unitIndex: number,
  remainingCapacity: number,
  nextPageCapacity: number,
  input: NormalizedPdfInput,
  metrics: PdfLayoutMetrics
): boolean {
  const unit = units[unitIndex]
  const startingKeys = unit.keepTogetherKeys.filter(
    (key: string): boolean =>
      unitIndex === 0 ||
      !units[unitIndex - 1]?.keepTogetherKeys.includes(key)
  )

  return startingKeys.some((key: string): boolean => {
    let runHeight = 0

    for (let index = unitIndex; index < units.length; index += 1) {
      if (!units[index]?.keepTogetherKeys.includes(key)) {
        break
      }

      runHeight += estimateFlowItemHeight(units[index].item, input, metrics)
    }

    return runHeight > remainingCapacity && runHeight <= nextPageCapacity
  })
}

function shouldMoveKeepWithNextChain(
  units: readonly PdfPaginationUnit[],
  unitIndex: number,
  remainingCapacity: number,
  nextPageCapacity: number,
  input: NormalizedPdfInput,
  metrics: PdfLayoutMetrics
): boolean {
  let chainHeight = 0
  let currentIndex = unitIndex

  while (currentIndex < units.length) {
    const currentUnit = units[currentIndex]

    chainHeight += estimateFlowItemHeight(currentUnit.item, input, metrics)

    if (!currentUnit.keepWithNext) {
      break
    }

    currentIndex += 1
  }

  return (
    currentIndex > unitIndex &&
    chainHeight > remainingCapacity &&
    chainHeight <= nextPageCapacity
  )
}
