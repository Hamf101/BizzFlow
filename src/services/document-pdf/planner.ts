import type { TemplateBlock, TemplateContent } from "@/types/template"

import {
  FIELD_CHUNK_CHARACTERS,
  LIST_CHUNK_HEIGHT,
  LIST_ENTRY_CHUNK_CHARACTERS,
  MAX_REPEATED_FOOTER_HEIGHT,
  MAX_REPEATED_HEADER_HEIGHT,
  MIN_PAGE_FLOW_HEIGHT,
  PAGE_FLOW_HEIGHT,
  PARAGRAPH_CHUNK_CHARACTERS,
  REPEATED_FOOTER_GAP,
  REPEATED_HEADER_GAP,
  TABLE_CHUNK_HEIGHT,
} from "./constants"
import { DocumentPdfServiceError } from "./errors"
import { formatFieldValue, normalizeDrawingDataUrl } from "./shared"
import type {
  DocumentPdfSigner,
  NormalizedPdfInput,
  PdfFlowItem,
  PdfPagePlan,
} from "./types"

/**
 * Creates deterministic printable page plans from normalized document input.
 *
 * @param input - Validated PDF input with a canonical template snapshot.
 * @returns Ordered page plans consumed by the production renderer.
 * @throws DocumentPdfServiceError when repeated regions or a block cannot fit.
 */
export function createPdfPagePlans(input: NormalizedPdfInput): PdfPagePlan[] {
  const repeatedHeaderHeight = input.content.repeat.header
    ? estimateBrandingHeight(input.content) +
      estimateBlocksHeight(
        input.content.sections.header.blocks,
        input.answers
      )
    : 0
  const repeatedFooterHeight = input.content.repeat.footer
    ? estimateBlocksHeight(
        input.content.sections.footer.blocks,
        input.answers
      )
    : 0

  if (repeatedHeaderHeight > MAX_REPEATED_HEADER_HEIGHT) {
    throw new DocumentPdfServiceError(
      "The repeated header is too tall. Shorten it or turn off header repetition.",
      400
    )
  }

  if (repeatedFooterHeight > MAX_REPEATED_FOOTER_HEIGHT) {
    throw new DocumentPdfServiceError(
      "The repeated footer is too tall. Shorten it or turn off footer repetition.",
      400
    )
  }

  const pageCapacity =
    PAGE_FLOW_HEIGHT -
    (input.content.repeat.header
      ? repeatedHeaderHeight + REPEATED_HEADER_GAP
      : 0) -
    (input.content.repeat.footer
      ? repeatedFooterHeight + REPEATED_FOOTER_GAP
      : 0)

  if (pageCapacity < MIN_PAGE_FLOW_HEIGHT) {
    throw new DocumentPdfServiceError(
      "The repeated header and footer leave too little room for document content.",
      400
    )
  }

  const flowItems = createPdfFlowItems(input)
  const pages: PdfPagePlan[] = []
  let currentItems: PdfFlowItem[] = []
  let currentHeight = 0

  for (const item of flowItems) {
    const itemHeight = estimateFlowItemHeight(item, input)

    if (itemHeight > pageCapacity) {
      throw new DocumentPdfServiceError(
        "A document block is too tall to fit on a printable page.",
        400
      )
    }

    if (
      currentItems.length > 0 &&
      currentHeight + itemHeight > pageCapacity
    ) {
      pages.push({ items: currentItems })
      currentItems = []
      currentHeight = 0
    }

    currentItems.push(item)
    currentHeight += itemHeight
  }

  if (currentItems.length > 0) {
    pages.push({ items: currentItems })
  }

  return pages.length > 0 ? pages : [{ items: [] }]
}

function createPdfFlowItems(input: NormalizedPdfInput): PdfFlowItem[] {
  const items: PdfFlowItem[] = []

  if (!input.content.repeat.header) {
    items.push({ kind: "branding" })
    items.push(
      ...expandBlocksForPagination(
        input.content.sections.header.blocks,
        input.answers
      )
    )
  }

  items.push({ kind: "title" })
  items.push(
    ...expandBlocksForPagination(
      input.content.sections.body.blocks,
      input.answers
    )
  )

  if (input.signers.length > 0) {
    items.push({ kind: "signing_intro" })
    items.push(
      ...input.signers.map(
        (signer: DocumentPdfSigner): PdfFlowItem => ({
          kind: "signer",
          signer,
        })
      )
    )
  }

  if (!input.content.repeat.footer) {
    items.push(
      ...expandBlocksForPagination(
        input.content.sections.footer.blocks,
        input.answers
      )
    )
  }

  return items
}

function expandBlocksForPagination(
  blocks: TemplateBlock[],
  answers: Record<string, unknown>
): PdfFlowItem[] {
  return blocks.flatMap(
    (block: TemplateBlock): PdfFlowItem[] =>
      expandBlockForPagination(block, answers)
  )
}

function expandBlockForPagination(
  block: TemplateBlock,
  answers: Record<string, unknown>
): PdfFlowItem[] {
  switch (block.type) {
    case "paragraph":
      return splitText(block.text, PARAGRAPH_CHUNK_CHARACTERS).map(
        (text: string): PdfFlowItem => ({
          kind: "block",
          block: { ...block, text },
        })
      )
    case "bullet_list":
    case "numbered_list":
      return splitListBlock(block)
    case "table":
      return splitTableBlock(block)
    case "signature_field":
    case "initials_field":
      return [{ kind: "block", block }]
    case "text_field":
    case "date_field":
    case "checkbox_field":
    case "dropdown_field": {
      const answer = formatFieldValue(block, answers[block.fieldKey])

      return splitText(answer, FIELD_CHUNK_CHARACTERS).map(
        (answerOverride: string, index: number): PdfFlowItem => ({
          kind: "block",
          block,
          answerOverride,
          fieldContinued: index > 0,
        })
      )
    }
    default:
      return [{ kind: "block", block }]
  }
}

function splitListBlock(
  block: Extract<
    TemplateBlock,
    { type: "bullet_list" } | { type: "numbered_list" }
  >
): PdfFlowItem[] {
  const entries = block.items.flatMap(
    (
      item: string,
      itemIndex: number
    ): Array<{ marker: string; text: string }> =>
      splitText(item, LIST_ENTRY_CHUNK_CHARACTERS).map(
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
          text,
        })
      )
  )
  const chunks: PdfFlowItem[] = []
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
        ),
      },
      listMarkers: currentEntries.map(
        (entry: { marker: string; text: string }): string => entry.marker
      ),
    })
    currentEntries = []
    currentHeight = 0
  }

  for (const entry of entries) {
    const entryHeight = estimateListEntryHeight(entry.text)

    if (
      currentEntries.length > 0 &&
      currentHeight + entryHeight > LIST_CHUNK_HEIGHT
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
  block: Extract<TemplateBlock, { type: "table" }>
): PdfFlowItem[] {
  const columnCount = block.headers.length
  const expandedRows = block.rows.flatMap((row: string[]): string[][] =>
    splitTableRow(row, columnCount)
  )

  if (expandedRows.length === 0) {
    return [{ kind: "block", block }]
  }

  const chunks: PdfFlowItem[] = []
  const headerHeight = estimateTableRowHeight(block.headers, columnCount)
  let currentRows: string[][] = []
  let currentHeight = headerHeight

  const flush = (): void => {
    if (currentRows.length === 0) {
      return
    }

    chunks.push({
      kind: "block",
      block: { ...block, rows: currentRows },
    })
    currentRows = []
    currentHeight = headerHeight
  }

  for (const row of expandedRows) {
    const rowHeight = estimateTableRowHeight(row, columnCount)

    if (
      currentRows.length > 0 &&
      currentHeight + rowHeight > TABLE_CHUNK_HEIGHT
    ) {
      flush()
    }

    currentRows.push(row)
    currentHeight += rowHeight
  }

  flush()
  return chunks
}

function splitTableRow(row: string[], columnCount: number): string[][] {
  const segmentLength = Math.max(40, Math.floor(850 / columnCount))
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

function estimateFlowItemHeight(
  item: PdfFlowItem,
  input: NormalizedPdfInput
): number {
  switch (item.kind) {
    case "branding":
      return estimateBrandingHeight(input.content)
    case "title":
      return estimateWrappedTextHeight(input.title, 55, 35) + 16
    case "block":
      return estimateBlockHeight(
        item.block,
        input.answers,
        item.answerOverride
      )
    case "signing_intro":
      return 52
    case "signer":
      return Math.max(
        item.signer.signatureDataUrl || item.signer.initialsDataUrl ? 74 : 60,
        estimateWrappedTextHeight(item.signer.name, 75, 12) +
          estimateWrappedTextHeight(item.signer.email, 90, 10) +
          24
      )
  }
}

/**
 * Estimates the vertical space required by a collection of template blocks.
 *
 * @param blocks - Canonical blocks to measure.
 * @param answers - Stored field answers used when measuring printable values.
 * @returns Estimated height in PDF points.
 */
export function estimateBlocksHeight(
  blocks: TemplateBlock[],
  answers: Record<string, unknown>
): number {
  return blocks.reduce(
    (height: number, block: TemplateBlock): number =>
      height + estimateBlockHeight(block, answers),
    0
  )
}

function estimateBlockHeight(
  block: TemplateBlock,
  answers: Record<string, unknown>,
  answerOverride?: string
): number {
  switch (block.type) {
    case "heading": {
      const charactersPerLine =
        block.level === 1 ? 55 : block.level === 2 ? 65 : 75
      const lineHeight =
        block.level === 1 ? 29 : block.level === 2 ? 24 : 20

      return estimateWrappedTextHeight(
        block.text,
        charactersPerLine,
        lineHeight
      ) + 16
    }
    case "paragraph":
      return estimateWrappedTextHeight(block.text, 88, 15) + 10
    case "bullet_list":
    case "numbered_list":
      return (
        block.items.reduce(
          (height: number, item: string): number =>
            height + estimateListEntryHeight(item),
          0
        ) + 8
      )
    case "image":
      return block.caption ? 292 : 274
    case "table":
      return (
        estimateTableRowHeight(block.headers, block.headers.length) +
        block.rows.reduce(
          (height: number, row: string[]): number =>
            height + estimateTableRowHeight(row, block.headers.length),
          0
        ) +
        10
      )
    case "divider":
      return 20
    case "signature_field":
    case "initials_field":
      return normalizeDrawingDataUrl(answers[block.fieldKey]) ? 78 : 48
    default: {
      const answer =
        answerOverride ?? formatFieldValue(block, answers[block.fieldKey])
      const labelHeight = estimateWrappedTextHeight(block.label, 78, 13)
      const answerHeight = estimateWrappedTextHeight(answer, 88, 15)
      const helpHeight = block.helpText
        ? estimateWrappedTextHeight(block.helpText, 110, 10)
        : 0

      return labelHeight + answerHeight + helpHeight + 20
    }
  }
}

function estimateBrandingHeight(content: TemplateContent): number {
  return content.branding.logoDataUrl || content.branding.organizationName
    ? 46
    : 8
}

function estimateListEntryHeight(value: string): number {
  return estimateWrappedTextHeight(value, 82, 15) + 4
}

function estimateTableRowHeight(
  cells: string[],
  columnCount: number
): number {
  const charactersPerLine = Math.max(4, Math.floor(103 / columnCount))
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
