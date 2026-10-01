import {
  shouldRenderTemplateFooter,
  shouldRenderTemplateHeader,
  type TemplateRenderBlock
} from "@/services/templates/template-render-plan"
import type { TemplateBlock, TemplateContent, TextRun } from "@/types/template"

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
  getPdfColumnFrames,
  scalePdfCharacterEstimate,
  type PdfLayoutMetrics
} from "./layout"
import {
  ANSWER_BOX_PADDING,
  answerBoxHeight,
  CHECKBOX_LABEL_INSET,
  packRadioOptions,
  formatFieldValue,
  normalizeDrawingDataUrl
} from "./shared"
import type {
  DocumentPdfSigner,
  NormalizedPdfInput,
  PdfBlockFlowItem,
  PdfFieldBlock,
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

  // A picture placed on a later page than the text reaches still gets its page.
  const lastPlacedPage = Math.max(1, ...input.renderPlan.blocks.map(({ block }) => (block.type === "image" ? (block.placement?.page ?? 1) : 1)))

  while (pages.length < lastPlacedPage) {
    pages.push(createMutablePdfPage(input, metrics, pages.length + 1).plan)
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
    // A document that prints no title starts with its content.
    ...(input.renderPlan.title.length > 0
      ? [
          {
            item: { kind: "title", title: input.renderPlan.title },
            pageBreakBefore: false,
            keepTogetherKeys: [],
            keepWithNext: false
          } satisfies PdfPaginationUnit
        ]
      : []),
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
  // Placed pictures print over their pages, outside the flow.
  const blocks = input.renderPlan.blocks.filter(({ block }) => !(block.type === "image" && block.placement))
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
    const space = spaceAbove(renderBlock)

    // The space asked for above a block goes before its section's title and
    // starts the page they start; a row's rows take theirs as they come.
    units.push(...space, ...clearLeadingPageBreak(structureLabelUnits, space.length > 0))

    if (renderBlock.fieldGroupId && renderBlock.fieldGroupColumns > 1) {
      const groupedBlocks: TemplateRenderBlock[] = []
      let groupIndex = blockIndex

      while (
        groupIndex < blocks.length &&
        blocks[groupIndex]?.fieldGroupId === renderBlock.fieldGroupId
      ) {
        groupedBlocks.push(blocks[groupIndex])
        groupIndex += 1
      }

      const columnUnits = createRowPaginationUnits(
          groupedBlocks,
          input,
          metrics
        )

      units.push(
        ...clearLeadingPageBreak(
          columnUnits,
          structureLabelUnits.length > 0 || space.length > 0
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
      ...clearLeadingPageBreak(blockUnits, structureLabelUnits.length > 0 || space.length > 0)
    )
    blockIndex += 1
  }

  return units
}

// Space left above a block, moving with it to the next page.
function spaceAbove(renderBlock: TemplateRenderBlock | undefined): PdfPaginationUnit[] {
  return renderBlock?.spaceAbove
    ? [{ item: { height: renderBlock.spaceAbove, kind: "space" }, keepTogetherKeys: [], keepWithNext: true, pageBreakBefore: renderBlock.pageBreakBefore }]
    : []
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
  const room = emptyPageRoom(input, metrics)
  const expand = (frame: TemplateRenderBlock["frame"]): PdfBlockFlowItem[] =>
    expandBlockForPagination(
      renderBlock,
      input.answers,
      frame ? (metrics.contentWidth * frame.width) / 100 : metrics.contentWidth,
      metrics.pageCapacity,
      room
    ).map((item: PdfBlockFlowItem): PdfBlockFlowItem => (frame ? { ...item, frame } : item))
  const framed = expand(renderBlock.frame)
  // Put somewhere too narrow for a page to hold it, a block prints across the page instead.
  const items =
    renderBlock.frame && framed.some((item: PdfBlockFlowItem): boolean => estimateFlowItemHeight(item, input, metrics) > room)
      ? expand(null)
      : framed
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

function createRowPaginationUnits(
  renderBlocks: readonly TemplateRenderBlock[],
  input: NormalizedPdfInput,
  metrics: PdfLayoutMetrics
): PdfPaginationUnit[] {
  const units: PdfPaginationUnit[] = []
  const first = renderBlocks[0]
  const columns = first?.fieldGroupColumns ?? 1
  const widths = first?.fieldGroupWidths ?? Array.from({ length: columns }, () => 12 / columns)
  const frames = getPdfColumnFrames(metrics, widths)
  let blockIndex = 0

  while (blockIndex < renderBlocks.length) {
    // A row takes up to its column count; a page break starts the next row.
    const row: TemplateRenderBlock[] = []

    for (const renderBlock of renderBlocks.slice(blockIndex)) {
      if (row.length === columns || (row.length > 0 && renderBlock.pageBreakBefore)) {
        break
      }

      row.push(renderBlock)
    }

    const cellItems = row.map((renderBlock: TemplateRenderBlock, column: number): PdfBlockFlowItem[] =>
      expandBlockForPagination(renderBlock, input.answers, frames[column]?.width ?? metrics.contentWidth, metrics.pageCapacity, emptyPageRoom(input, metrics))
    )
    const pieceCount = Math.max(...cellItems.map((items) => items.length))
    const keepTogetherKeys = Array.from(
      new Set<string>(row.flatMap((renderBlock: TemplateRenderBlock): string[] => getKeepTogetherKeys(renderBlock, input)))
    )
    const lastBlock = row.at(-1)

    // The group's first row had its space put in before its labels.
    if (blockIndex > 0) {
      units.push(...spaceAbove(row[0]))
    }

    // A long block is split into pieces; each piece of the row prints as one line of cells.
    for (let piece = 0; piece < pieceCount; piece += 1) {
      units.push({
        item: {
          cells: widths.map((_: number, column: number): PdfBlockFlowItem | null => cellItems[column]?.[piece] ?? null),
          kind: "columns",
          widths
        },
        pageBreakBefore: piece === 0 && row[0]?.pageBreakBefore === true,
        keepTogetherKeys,
        keepWithNext: piece === pieceCount - 1 && lastBlock?.keepWithNext === true
      })
    }

    blockIndex += row.length
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
  sizedBlock: TemplateRenderBlock,
  answers: Record<string, unknown>,
  availableWidth: number,
  pageCapacity: number,
  room: number
): PdfBlockFlowItem[] {
  const renderBlock = fitBoxToPage(sizedBlock, availableWidth, room)
  const { block } = renderBlock

  switch (block.type) {
    case "paragraph": {
      const chunkCharacters = resolveChunkCharacters(
        PARAGRAPH_CHUNK_CHARACTERS,
        availableWidth,
        pageCapacity
      )

      // Formatted text is cut in the same places, each piece keeping its own formatting.
      if (block.runs) {
        return splitRuns(block.runs, scaleChunk(chunkCharacters, block.runs, 10)).map(
          (runs: TextRun[]): PdfBlockFlowItem => ({
            kind: "block",
            block: { ...block, runs, text: runs.map((run: TextRun): string => run.text).join("") },
            renderBlock
          })
        )
      }

      return splitText(block.text, chunkCharacters).map(
        (text: string): PdfBlockFlowItem => ({
          kind: "block",
          block: { ...block, text },
          renderBlock
        })
      )
    }
    case "bullet_list":
    case "numbered_list":
      return splitListBlock(block, renderBlock, availableWidth, pageCapacity)
    case "table":
      return splitTableBlock(block, renderBlock, availableWidth, pageCapacity)
    case "signature_field":
    case "initials_field":
    case "file_field":
    case "checkbox_field":
      return [{ kind: "block", block, renderBlock }]
    case "text_field":
    case "date_field":
    case "dropdown_field": {
      const answer = formatFieldValue(block, answers[block.fieldKey])

      if (block.type === "dropdown_field" && block.display === "radios") {
        return splitRadioOptions(block, renderBlock, answer, availableWidth, room)
      }

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

// The least room an empty page has, whichever page a block lands on: the
// first can carry the template's header, and so can every one after it.
function emptyPageRoom(input: NormalizedPdfInput, metrics: PdfLayoutMetrics): number {
  return Math.min(getEmptyPageContentCapacity(input, metrics, 1), getEmptyPageContentCapacity(input, metrics, 2))
}

// An answer box made taller than a page can hold under its label and above
// its help is drawn as tall as a page allows.
function fitBoxToPage(renderBlock: TemplateRenderBlock, availableWidth: number, room: number): TemplateRenderBlock {
  const { block } = renderBlock

  if (!("boxHeight" in block) || block.boxHeight === undefined) {
    return renderBlock
  }

  const most = Math.floor(room - estimateFieldLabelHeight(block, availableWidth) - estimateHelpHeight(block, availableWidth) - 13)

  return block.boxHeight <= most ? renderBlock : { ...renderBlock, block: { ...block, boxHeight: Math.max(most, 27) } }
}

// Radio buttons print an option a line, in pieces a page holds; an answer
// given before the options changed prints as one more, chosen.
function splitRadioOptions(
  block: Extract<TemplateBlock, { type: "dropdown_field" }>,
  renderBlock: TemplateRenderBlock,
  answer: string,
  availableWidth: number,
  room: number
): PdfBlockFlowItem[] {
  const options = answer && !block.options.includes(answer) ? [...block.options, answer] : block.options
  const most = room - estimateFieldLabelHeight(block, availableWidth) - estimateHelpHeight(block, availableWidth) - 13
  const pieces: string[][] = [[]]
  let height = 0

  // Options side by side stay together, as a checkbox does.
  if (block.across) {
    return [{ kind: "block", block: { ...block, options }, renderBlock }]
  }

  for (const option of options) {
    const optionHeight = estimateRadioOptionHeight(option, availableWidth)
    const piece = pieces[pieces.length - 1]

    if (piece.length > 0 && height + optionHeight > most) {
      pieces.push([option])
      height = optionHeight
    } else {
      piece.push(option)
      height += optionHeight
    }
  }

  return pieces.map(
    (piece: string[], index: number): PdfBlockFlowItem => ({
      kind: "block",
      block: { ...block, options: piece },
      renderBlock,
      fieldContinued: index > 0
    })
  )
}

// A generous guess at a side-by-side option's width at 10 points, so a line
// the renderer measures never holds fewer options than the planner reserved.
function estimateRadioOptionWidth(option: string): number {
  return CHECKBOX_LABEL_INSET + option.length * 6
}

function estimateRadioOptionHeight(option: string, availableWidth: number): number {
  return estimateWrappedTextHeight(option, scalePdfCharacterEstimate(88, availableWidth - CHECKBOX_LABEL_INSET), 15)
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
    ): Array<{ marker: string; runs?: TextRun[]; text: string }> => {
      const formatted = block.itemRuns?.[itemIndex]
      const pieces = formatted
        ? splitRuns(formatted, scaleChunk(entryCharacters, formatted, 10)).map((runs: TextRun[]) => ({ runs, text: runs.map((run: TextRun): string => run.text).join("") }))
        : splitText(item, entryCharacters).map((text: string) => ({ text }))

      return pieces.map((piece, chunkIndex: number) => ({
        ...piece,
        marker:
          chunkIndex === 0
            ? block.type === "bullet_list"
              ? "-"
              : `${itemIndex + 1}.`
            : ""
      }))
    }
  )
  const chunks: PdfBlockFlowItem[] = []
  const chunkHeight = Math.min(LIST_CHUNK_HEIGHT, pageCapacity * 0.72)
  let currentEntries: Array<{ marker: string; runs?: TextRun[]; text: string }> = []
  let currentHeight = 0

  const flush = (): void => {
    if (currentEntries.length === 0) {
      return
    }

    chunks.push({
      kind: "block",
      block: {
        ...block,
        items: currentEntries.map((entry): string => entry.text),
        // The formatting of this piece's own entries, if any has some.
        itemRuns: currentEntries.some((entry) => entry.runs)
          ? currentEntries.map((entry) => entry.runs ?? null)
          : undefined
      },
      renderBlock,
      listMarkers: currentEntries.map((entry): string => entry.marker)
    })
    currentEntries = []
    currentHeight = 0
  }

  for (const entry of entries) {
    const entryHeight = estimateListEntryHeight(entry.text, availableWidth, entry.runs)

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

/**
 * Cuts formatted text where splitText would cut the same words: whitespace
 * folded to single spaces, the ends trimmed, and each piece keeping the
 * formatting of the words in it.
 *
 * @param runs - The text and its formatting.
 * @param maximumCharacters - The longest a piece may be.
 * @returns The pieces, each as formatted text.
 */
function splitRuns(runs: readonly TextRun[], maximumCharacters: number): TextRun[][] {
  // Character by character, as the text units splitText slices by.
  const letters: Array<{ character: string; run: TextRun }> = []

  for (const run of runs) {
    for (let index = 0; index < run.text.length; index += 1) {
      const character = run.text[index] ?? ""
      const space = /\s/.test(character)

      if (!space || (letters.length > 0 && letters.at(-1)?.character !== " ")) {
        letters.push({ character: space ? " " : character, run })
      }
    }
  }

  while (letters.at(-1)?.character === " ") {
    letters.pop()
  }

  const text = letters.map((letter): string => letter.character).join("")
  let from = 0

  return splitText(text, maximumCharacters).map((piece: string): TextRun[] => {
    const start = text.indexOf(piece, from)
    const grouped: Array<{ run: TextRun; source: TextRun }> = []
    from = start + piece.length

    for (const { character, run } of letters.slice(start, start + piece.length)) {
      const last = grouped.at(-1)

      if (last?.source === run) {
        last.run.text += character
      } else {
        grouped.push({ run: { ...run, text: character }, source: run })
      }
    }

    return grouped.map(({ run }) => run)
  })
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
    case "space":
      return item.height
    case "block":
      baseHeight = estimateBlockHeight(
        item.block,
        input.answers,
        item.frame ? (metrics.contentWidth * item.frame.width) / 100 : metrics.contentWidth,
        item.answerOverride,
        metrics.lineSpacing
      )
      break
    case "columns": {
      const frames = getPdfColumnFrames(metrics, item.widths)

      baseHeight = Math.max(
        0,
        ...item.cells.map((cell, column: number): number =>
          cell
            ? estimateBlockHeight(
                cell.block,
                input.answers,
                frames[column]?.width ?? metrics.contentWidth,
                cell.answerOverride,
                metrics.lineSpacing
              )
            : 0
        )
      )
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
  answerOverride?: string,
  lineSpacing?: number
): number {
  switch (block.type) {
    case "heading": {
      const baselineCharacters =
        block.level === 1 ? 55 : block.level === 2 ? 65 : 75
      const size = block.level === 1 ? 20 : block.level === 2 ? 16 : 13
      const lineHeight = lineSpacing ? size * lineSpacing : block.level === 1 ? 29 : block.level === 2 ? 24 : 20
      const scale = runScale(block.runs, size)

      return (
        estimateWrappedTextHeight(
          block.text,
          scalePdfCharacterEstimate(baselineCharacters, availableWidth) / scale,
          lineHeight * scale
        ) + 16
      )
    }
    case "paragraph": {
      const scale = runScale(block.runs, 10)

      return (
        estimateWrappedTextHeight(
          block.text,
          scalePdfCharacterEstimate(88, availableWidth) / scale,
          10 * (lineSpacing ?? 1.5) * scale
        ) + 10
      )
    }
    case "bullet_list":
    case "numbered_list":
      return (
        block.items.reduce(
          (height: number, item: string, index: number): number =>
            height + estimateListEntryHeight(item, availableWidth, block.itemRuns?.[index]) * ((lineSpacing ?? 1.5) / 1.5),
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
      return (
        estimateFieldLabelHeight(block, availableWidth) +
        (normalizeDrawingDataUrl(answers[block.fieldKey]) ? Math.max(answerBoxHeight(block), 45 + ANSWER_BOX_PADDING * 2) : answerBoxHeight(block)) +
        estimateHelpHeight(block, availableWidth) +
        13
      )
    case "checkbox_field":
      return (
        Math.max(
          15,
          estimateWrappedTextHeight(
            block.label,
            scalePdfCharacterEstimate(88, availableWidth - CHECKBOX_LABEL_INSET),
            15
          )
        ) +
        estimateHelpHeight(block, availableWidth) +
        10
      )
    case "file_field": {
      const labelHeight = estimateWrappedTextHeight(
        block.label,
        scalePdfCharacterEstimate(78, availableWidth),
        13
      )
      const noticeHeight = estimateWrappedTextHeight(
        "Uploads are only in submissions.",
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
      if (block.type === "dropdown_field" && block.display === "radios") {
        const lines = block.across ? packRadioOptions(block.options, availableWidth, estimateRadioOptionWidth) : block.options.map((option: string): string[] => [option])

        return (
          estimateFieldLabelHeight(block, availableWidth) +
          lines.reduce((height: number, line: string[]): number => height + Math.max(...line.map((option: string): number => estimateRadioOptionHeight(option, availableWidth))), 0) +
          estimateHelpHeight(block, availableWidth) +
          13
        )
      }

      const answer =
        answerOverride ?? formatFieldValue(block, answers[block.fieldKey])
      const answerHeight = answer
        ? estimateWrappedTextHeight(
            answer,
            scalePdfCharacterEstimate(88, availableWidth - ANSWER_BOX_PADDING * 2),
            15
          )
        : 0

      return (
        estimateFieldLabelHeight(block, availableWidth) +
        Math.max(answerBoxHeight(block), answerHeight + ANSWER_BOX_PADDING * 2) +
        estimateHelpHeight(block, availableWidth) +
        13
      )
    }
  }
}

function estimateFieldLabelHeight(block: PdfFieldBlock, availableWidth: number): number {
  return estimateWrappedTextHeight(block.label, scalePdfCharacterEstimate(78, availableWidth), 13)
}

function estimateHelpHeight(block: PdfFieldBlock, availableWidth: number): number {
  return block.helpText
    ? estimateWrappedTextHeight(block.helpText, scalePdfCharacterEstimate(110, availableWidth), 10)
    : 0
}

function estimateBrandingHeight(content: TemplateContent): number {
  return hasBranding(content) ? 46 : 0
}

function hasBranding(content: TemplateContent): boolean {
  return Boolean(
    content.branding.logoAsset || content.branding.logoDataUrl || content.branding.organizationName
  )
}

function estimateListEntryHeight(
  value: string,
  availableWidth: number,
  runs?: readonly TextRun[] | null
): number {
  const scale = runScale(runs, 10)

  return (
    estimateWrappedTextHeight(
      value,
      scalePdfCharacterEstimate(82, availableWidth) / scale,
      15 * scale
    ) + 4
  )
}

/**
 * How many times the block's own size its biggest words are. Estimates treat
 * every word as that big: a line stands as tall as its tallest word, so a
 * little extra room is the price of never running off the page.
 *
 * @param runs - The text's formatting, if it has any.
 * @param size - The block's own font size.
 * @returns At least 1.
 */
function runScale(runs: readonly TextRun[] | null | undefined, size: number): number {
  return Math.max(1, ...(runs ?? []).map((run: TextRun): number => (run.size ?? size) / size))
}

// Bigger words fill a piece faster, down as well as across.
function scaleChunk(characters: number, runs: readonly TextRun[], size: number): number {
  return Math.max(1, Math.floor(characters / runScale(runs, size) ** 2))
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
