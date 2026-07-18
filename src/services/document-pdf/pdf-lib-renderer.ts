import { readFile } from "node:fs/promises"

import fontkit from "@pdf-lib/fontkit"
import {
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFImage,
  type RGB,
} from "pdf-lib"

import type { TemplateBlock } from "@/types/template"

import {
  A4_HEIGHT,
  A4_WIDTH,
  PAGE_BOTTOM_MARGIN,
  PAGE_HORIZONTAL_MARGIN,
  PAGE_TOP_MARGIN,
  PDF_BOLD_FONT_PATH,
  PDF_CONTENT_WIDTH,
  PDF_REGULAR_FONT_PATH,
  REPEATED_HEADER_GAP,
} from "./constants"
import { estimateBlocksHeight } from "./planner"
import { embedPdfLibImage, fitPdfImage } from "./pdf-lib-images"
import {
  drawPdfLibSigner,
  drawPdfLibSigningIntro,
} from "./pdf-lib-signing"
import {
  drawWrappedPdfText,
  hexToPdfColor,
  normalizeStandardFontText,
  wrapPdfText,
} from "./pdf-lib-text"
import type { PdfLibRenderContext } from "./pdf-lib-types"
import {
  formatFieldValue,
  normalizeDrawingDataUrl,
} from "./shared"
import type {
  NormalizedPdfInput,
  PdfFieldBlock,
  PdfFlowItem,
  PdfPagePlan,
} from "./types"

let bundledPdfFontsPromise: Promise<{
  bold: Buffer
  regular: Buffer
}> | null = null

/**
 * Renders normalized page plans through the production pdf-lib adapter.
 *
 * @param input - Validated generated-document PDF input.
 * @param pages - Ordered page plans produced by the planner.
 * @returns Complete PDF bytes.
 * @throws DocumentPdfServiceError when images or other render data are invalid.
 */
export async function renderPdfLibDocument(
  input: NormalizedPdfInput,
  pages: PdfPagePlan[]
): Promise<Buffer> {
  const document = await PDFDocument.create()
  const imageCache = new Map<string, PDFImage>()
  const fontBytes = await loadBundledPdfFonts()

  document.registerFontkit(fontkit)
  const regularFont = await document.embedFont(fontBytes.regular)
  const boldFont = await document.embedFont(fontBytes.bold)

  document.setTitle(input.title)
  document.setAuthor(
    input.content.branding.organizationName || "BizFlow Docs"
  )
  document.setSubject("Generated business document")
  document.setCreator("BizFlow Docs")
  document.setProducer("BizFlow Docs")

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = document.addPage([A4_WIDTH, A4_HEIGHT])
    const context: PdfLibRenderContext = {
      answers: input.answers,
      boldFont,
      content: input.content,
      document,
      hasSigners: input.signers.length > 0,
      imageCache,
      page,
      regularFont,
      workflowStatus: input.workflowStatus,
    }

    await drawPdfLibPage(
      context,
      pages[pageIndex],
      pageIndex + 1,
      pages.length,
      input.title
    )
  }

  // Plain indirect objects maximize compatibility with strict PDF processors
  // and print pipelines that do not reliably support compressed object streams.
  return Buffer.from(await document.save({ useObjectStreams: false }))
}

async function loadBundledPdfFonts(): Promise<{
  bold: Buffer
  regular: Buffer
}> {
  bundledPdfFontsPromise ??= Promise.all([
    readFile(PDF_REGULAR_FONT_PATH),
    readFile(PDF_BOLD_FONT_PATH),
  ]).then(([regular, bold]: [Buffer, Buffer]) => ({ bold, regular }))

  return bundledPdfFontsPromise
}

async function drawPdfLibPage(
  context: PdfLibRenderContext,
  plan: PdfPagePlan,
  pageNumber: number,
  totalPages: number,
  title: string
): Promise<void> {
  let cursorY = A4_HEIGHT - PAGE_TOP_MARGIN

  if (context.content.repeat.header) {
    cursorY = await drawPdfLibBranding(context, cursorY)
    cursorY = await drawPdfLibBlocks(
      context.content.sections.header.blocks,
      context,
      cursorY
    )
    cursorY -= REPEATED_HEADER_GAP
  }

  for (const item of plan.items) {
    cursorY = await drawPdfLibFlowItem(item, context, cursorY, title)
  }

  await drawPdfLibFooter(context, pageNumber, totalPages)
}

async function drawPdfLibFooter(
  context: PdfLibRenderContext,
  pageNumber: number,
  totalPages: number
): Promise<void> {
  const footerHeight = context.content.repeat.footer
    ? estimateBlocksHeight(
        context.content.sections.footer.blocks,
        context.answers
      )
    : 0
  const footerTop = PAGE_BOTTOM_MARGIN + 17 + footerHeight

  context.page.drawLine({
    start: { x: PAGE_HORIZONTAL_MARGIN, y: footerTop + 3 },
    end: { x: A4_WIDTH - PAGE_HORIZONTAL_MARGIN, y: footerTop + 3 },
    color: rgb(0.9, 0.91, 0.93),
    thickness: 0.8,
  })

  if (context.content.repeat.footer) {
    await drawPdfLibBlocks(
      context.content.sections.footer.blocks,
      context,
      footerTop
    )
  }

  const pageLabel = `Page ${pageNumber} of ${totalPages}`
  const safeLabel = normalizeStandardFontText(
    pageLabel,
    context.regularFont
  )
  const labelWidth = context.regularFont.widthOfTextAtSize(safeLabel, 7)

  context.page.drawText(safeLabel, {
    x: A4_WIDTH - PAGE_HORIZONTAL_MARGIN - labelWidth,
    y: PAGE_BOTTOM_MARGIN,
    color: rgb(0.42, 0.45, 0.5),
    font: context.regularFont,
    size: 7,
  })
}

async function drawPdfLibBlocks(
  blocks: TemplateBlock[],
  context: PdfLibRenderContext,
  topY: number
): Promise<number> {
  let cursorY = topY

  for (const block of blocks) {
    cursorY = await drawPdfLibBlock({ kind: "block", block }, context, cursorY)
  }

  return cursorY
}

async function drawPdfLibFlowItem(
  item: PdfFlowItem,
  context: PdfLibRenderContext,
  topY: number,
  title: string
): Promise<number> {
  switch (item.kind) {
    case "branding":
      return drawPdfLibBranding(context, topY)
    case "title":
      return (
        drawWrappedPdfText(
          context,
          title,
          topY,
          PAGE_HORIZONTAL_MARGIN,
          PDF_CONTENT_WIDTH,
          24,
          35,
          context.boldFont,
          hexToPdfColor(context.content.branding.primaryColor),
          "left"
        ) - 16
      )
    case "block":
      return drawPdfLibBlock(item, context, topY)
    case "signing_intro":
      return drawPdfLibSigningIntro(context, topY)
    case "signer":
      return drawPdfLibSigner(context, item.signer, topY)
  }
}

async function drawPdfLibBranding(
  context: PdfLibRenderContext,
  topY: number
): Promise<number> {
  const { branding } = context.content

  if (!branding.logoDataUrl && !branding.organizationName) {
    return topY - 8
  }

  let textX = PAGE_HORIZONTAL_MARGIN

  if (branding.logoDataUrl) {
    const logo = await embedPdfLibImage(context, branding.logoDataUrl)
    const size = fitPdfImage(logo, 70, 34)
    context.page.drawImage(logo, {
      x: PAGE_HORIZONTAL_MARGIN,
      y: topY - size.height,
      height: size.height,
      width: size.width,
    })
    textX += size.width + 10
  }

  if (branding.organizationName) {
    const lines = wrapPdfText(
      branding.organizationName,
      context.boldFont,
      12,
      A4_WIDTH - PAGE_HORIZONTAL_MARGIN - textX
    )

    lines.forEach((line: string, index: number): void => {
      context.page.drawText(line, {
        x: textX,
        y: topY - 14 - index * 16,
        color: hexToPdfColor(branding.primaryColor),
        font: context.boldFont,
        size: 12,
      })
    })
  }

  return topY - 46
}

async function drawPdfLibBlock(
  item: Extract<PdfFlowItem, { kind: "block" }>,
  context: PdfLibRenderContext,
  topY: number
): Promise<number> {
  const { block } = item
  const primaryColor = hexToPdfColor(
    context.content.branding.primaryColor
  )

  switch (block.type) {
    case "heading": {
      const size = block.level === 1 ? 20 : block.level === 2 ? 16 : 13
      const lineHeight = block.level === 1 ? 29 : block.level === 2 ? 24 : 20

      return (
        drawWrappedPdfText(
          context,
          block.text,
          topY - 10,
          PAGE_HORIZONTAL_MARGIN,
          PDF_CONTENT_WIDTH,
          size,
          lineHeight,
          context.boldFont,
          primaryColor,
          block.alignment
        ) - 6
      )
    }
    case "paragraph":
      return (
        drawWrappedPdfText(
          context,
          block.text,
          topY,
          PAGE_HORIZONTAL_MARGIN,
          PDF_CONTENT_WIDTH,
          10,
          15,
          context.regularFont,
          rgb(0.07, 0.09, 0.13),
          block.alignment
        ) - 8
      )
    case "bullet_list":
    case "numbered_list":
      return drawPdfLibList(item, context, topY)
    case "image":
      return drawPdfLibContentImage(context, block, topY)
    case "table":
      return drawPdfLibTable(context, block, topY)
    case "divider":
      context.page.drawLine({
        start: { x: PAGE_HORIZONTAL_MARGIN, y: topY - 6 },
        end: { x: A4_WIDTH - PAGE_HORIZONTAL_MARGIN, y: topY - 6 },
        color: rgb(0.82, 0.84, 0.87),
        thickness: 0.8,
      })
      return topY - 20
    default:
      return drawPdfLibField(item, context, topY)
  }
}

function drawPdfLibList(
  item: Extract<PdfFlowItem, { kind: "block" }>,
  context: PdfLibRenderContext,
  topY: number
): number {
  if (
    item.block.type !== "bullet_list" &&
    item.block.type !== "numbered_list"
  ) {
    return topY
  }

  let cursorY = topY

  item.block.items.forEach((value: string, index: number): void => {
    const defaultMarker =
      item.block.type === "bullet_list" ? "-" : `${index + 1}.`
    const marker = item.listMarkers?.[index] ?? defaultMarker
    const text = `${marker}${marker.length === 0 ? "    " : " "}${value}`

    cursorY =
      drawWrappedPdfText(
        context,
        text,
        cursorY,
        PAGE_HORIZONTAL_MARGIN + 12,
        PDF_CONTENT_WIDTH - 12,
        10,
        15,
        context.regularFont,
        rgb(0.07, 0.09, 0.13),
        "left"
      ) - 3
  })

  return cursorY - 5
}

async function drawPdfLibContentImage(
  context: PdfLibRenderContext,
  block: Extract<TemplateBlock, { type: "image" }>,
  topY: number
): Promise<number> {
  const image = await embedPdfLibImage(context, block.dataUrl)
  const maximumWidth = PDF_CONTENT_WIDTH * (block.widthPercent / 100)
  const size = fitPdfImage(image, maximumWidth, 260)
  const imageX =
    block.alignment === "left"
      ? PAGE_HORIZONTAL_MARGIN
      : block.alignment === "right"
        ? A4_WIDTH - PAGE_HORIZONTAL_MARGIN - size.width
        : PAGE_HORIZONTAL_MARGIN + (PDF_CONTENT_WIDTH - size.width) / 2

  context.page.drawImage(image, {
    x: imageX,
    y: topY - size.height,
    height: size.height,
    width: size.width,
  })

  let cursorY = topY - size.height - 4

  if (block.caption) {
    cursorY =
      drawWrappedPdfText(
        context,
        block.caption,
        cursorY,
        PAGE_HORIZONTAL_MARGIN,
        PDF_CONTENT_WIDTH,
        8,
        11,
        context.regularFont,
        rgb(0.42, 0.45, 0.5),
        block.alignment
      ) - 8
  }

  return cursorY
}

function drawPdfLibTable(
  context: PdfLibRenderContext,
  block: Extract<TemplateBlock, { type: "table" }>,
  topY: number
): number {
  const columnCount = block.headers.length
  const columnWidth = PDF_CONTENT_WIDTH / columnCount
  let cursorY = topY

  const drawRow = (
    cells: string[],
    font: PDFFont,
    fillColor?: RGB
  ): void => {
    const wrappedCells = Array.from(
      { length: columnCount },
      (_value: unknown, index: number): string[] =>
        wrapPdfText(
          cells[index] ?? "",
          font,
          9,
          columnWidth - 10
        )
    )
    const rowHeight =
      Math.max(
        1,
        ...wrappedCells.map((lines: string[]): number => lines.length)
      ) *
        12 +
      10

    wrappedCells.forEach((lines: string[], cellIndex: number): void => {
      const x = PAGE_HORIZONTAL_MARGIN + cellIndex * columnWidth
      context.page.drawRectangle({
        x,
        y: cursorY - rowHeight,
        width: columnWidth,
        height: rowHeight,
        borderColor: rgb(0.61, 0.64, 0.69),
        borderWidth: 0.7,
        color: fillColor,
      })

      lines.forEach((line: string, lineIndex: number): void => {
        context.page.drawText(line, {
          x: x + 5,
          y: cursorY - 5 - 9 - lineIndex * 12,
          color: rgb(0.07, 0.09, 0.13),
          font,
          size: 9,
        })
      })
    })

    cursorY -= rowHeight
  }

  drawRow(block.headers, context.boldFont, rgb(0.95, 0.96, 0.97))
  block.rows.forEach((row: string[]): void => {
    drawRow(row, context.regularFont)
  })

  return cursorY - 10
}

async function drawPdfLibField(
  item: Extract<PdfFlowItem, { kind: "block" }>,
  context: PdfLibRenderContext,
  topY: number
): Promise<number> {
  const block = item.block as PdfFieldBlock
  const label = `${block.label}${
    item.fieldContinued ? " (continued)" : block.required ? " *" : ""
  }`
  let cursorY = drawWrappedPdfText(
    context,
    label,
    topY,
    PAGE_HORIZONTAL_MARGIN,
    PDF_CONTENT_WIDTH,
    9,
    13,
    context.boldFont,
    rgb(0.07, 0.09, 0.13),
    "left"
  )
  cursorY -= 3

  const drawingDataUrl =
    block.type === "signature_field" || block.type === "initials_field"
      ? normalizeDrawingDataUrl(context.answers[block.fieldKey])
      : null

  if (drawingDataUrl) {
    const drawing = await embedPdfLibImage(context, drawingDataUrl)
    const size = fitPdfImage(drawing, 150, 45)
    context.page.drawImage(drawing, {
      x: PAGE_HORIZONTAL_MARGIN,
      y: cursorY - size.height,
      height: size.height,
      width: size.width,
    })
    cursorY -= Math.max(45, size.height)
  } else {
    const answer =
      (block.type === "signature_field" ||
        block.type === "initials_field") &&
      context.hasSigners
        ? "Captured per signer in signing record below"
        : (item.answerOverride ??
          formatFieldValue(block, context.answers[block.fieldKey]))
    const answerBottom = drawWrappedPdfText(
      context,
      answer,
      cursorY,
      PAGE_HORIZONTAL_MARGIN,
      PDF_CONTENT_WIDTH,
      10,
      15,
      context.regularFont,
      rgb(0.07, 0.09, 0.13),
      "left"
    )
    cursorY = Math.min(cursorY - 18, answerBottom)
  }

  context.page.drawLine({
    start: { x: PAGE_HORIZONTAL_MARGIN, y: cursorY },
    end: { x: A4_WIDTH - PAGE_HORIZONTAL_MARGIN, y: cursorY },
    color: rgb(0.61, 0.64, 0.69),
    thickness: 0.7,
  })
  cursorY -= 3

  if (block.helpText && !item.fieldContinued) {
    cursorY = drawWrappedPdfText(
      context,
      block.helpText,
      cursorY,
      PAGE_HORIZONTAL_MARGIN,
      PDF_CONTENT_WIDTH,
      7,
      10,
      context.regularFont,
      rgb(0.42, 0.45, 0.5),
      "left"
    )
  }

  return cursorY - 7
}
