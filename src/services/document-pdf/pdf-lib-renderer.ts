import { readFile } from "node:fs/promises"

import fontkit from "@pdf-lib/fontkit"
import {
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFImage,
  type RGB
} from "pdf-lib"

import type { TemplateBlock } from "@/types/template"

import {
  PDF_BOLD_FONT_PATH,
  PDF_REGULAR_FONT_PATH
} from "./constants"
import { embedPdfLibImage, fitPdfImage } from "./pdf-lib-images"
import { drawPdfLibSigner, drawPdfLibSigningIntro } from "./pdf-lib-signing"
import {
  drawWrappedPdfText,
  hexToPdfColor,
  normalizeStandardFontText,
  wrapPdfText
} from "./pdf-lib-text"
import type { PdfLibRenderContext } from "./pdf-lib-types"
import { createPdfLayoutMetrics, getPdfColumnWidth } from "./layout"
import { formatFieldValue, normalizeDrawingDataUrl } from "./shared"
import type {
  NormalizedPdfInput,
  PdfBlockFlowItem,
  PdfFieldBlock,
  PdfFlowItem,
  PdfPagePlan
} from "./types"

type PdfContentFrame = Readonly<{ x: number; width: number }>

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
  const layout = createPdfLayoutMetrics(
    input.renderPlan.geometry,
    input.renderPlan.layout
  )

  document.registerFontkit(fontkit)
  const regularFont = await document.embedFont(fontBytes.regular)
  const boldFont = await document.embedFont(fontBytes.bold)

  document.setTitle(input.title)
  document.setAuthor(input.content.branding.organizationName || "BizFlow Docs")
  document.setSubject("Generated business document")
  document.setCreator("BizFlow Docs")
  document.setProducer("BizFlow Docs")

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = document.addPage([layout.pageWidth, layout.pageHeight])
    const context: PdfLibRenderContext = {
      answers: input.answers,
      boldFont,
      content: input.content,
      document,
      hasSigners: input.signers.length > 0,
      imageCache,
      layout,
      page,
      regularFont,
      workflowStatus: input.workflowStatus
    }

    await drawPdfLibPage(
      context,
      pages[pageIndex],
      pageIndex + 1,
      pages.length
    )
  }

  // pdf-lib refreshes the modification date while pages and resources change,
  // so immutable metadata must be applied only after all drawing is complete.
  if (input.metadataTimestamp) {
    const metadataDate = new Date(input.metadataTimestamp)

    document.setCreationDate(metadataDate)
    document.setModificationDate(metadataDate)
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
    readFile(PDF_BOLD_FONT_PATH)
  ]).then(([regular, bold]: [Buffer, Buffer]) => ({ bold, regular }))

  return bundledPdfFontsPromise
}

async function drawPdfLibPage(
  context: PdfLibRenderContext,
  plan: PdfPagePlan,
  pageNumber: number,
  totalPages: number
): Promise<void> {
  let cursorY = context.layout.flowTopY

  for (const item of plan.items) {
    cursorY = await drawPdfLibFlowItem(item, context, cursorY)
  }

  if (plan.showPageNumber) {
    drawPdfLibFooter(context, pageNumber, totalPages)
  }
}

function drawPdfLibFooter(
  context: PdfLibRenderContext,
  pageNumber: number,
  totalPages: number
): void {
  const { contentWidth, margin } = context.layout
  const footerTop = margin

  context.page.drawLine({
    start: { x: margin, y: footerTop },
    end: { x: margin + contentWidth, y: footerTop },
    color: rgb(0.9, 0.91, 0.93),
    thickness: 0.8
  })

  const pageLabel = `Page ${pageNumber} of ${totalPages}`
  const safeLabel = normalizeStandardFontText(pageLabel, context.regularFont)
  const labelWidth = context.regularFont.widthOfTextAtSize(safeLabel, 7)

  context.page.drawText(safeLabel, {
    x: margin + contentWidth - labelWidth,
    y: margin / 2,
    color: rgb(0.42, 0.45, 0.5),
    font: context.regularFont,
    size: 7
  })
}

async function drawPdfLibFlowItem(
  item: PdfFlowItem,
  context: PdfLibRenderContext,
  topY: number
): Promise<number> {
  const fullFrame: PdfContentFrame = {
    x: context.layout.margin,
    width: context.layout.contentWidth
  }
  let bottomY: number

  switch (item.kind) {
    case "branding":
      bottomY = await drawPdfLibBranding(context, topY)
      break
    case "title":
      bottomY =
        drawWrappedPdfText(
          context,
          item.title,
          topY,
          fullFrame.x,
          fullFrame.width,
          24,
          35,
          context.boldFont,
          hexToPdfColor(context.content.branding.primaryColor),
          "left"
        ) - 16
      break
    case "section_label":
      bottomY =
        drawWrappedPdfText(
          context,
          item.label,
          topY,
          fullFrame.x,
          fullFrame.width,
          15,
          22,
          context.boldFont,
          hexToPdfColor(context.content.branding.primaryColor),
          "left"
        ) - 10
      break
    case "field_group_label":
      bottomY =
        drawWrappedPdfText(
          context,
          item.label.toUpperCase(),
          topY,
          fullFrame.x,
          fullFrame.width,
          9,
          13,
          context.boldFont,
          rgb(0.42, 0.45, 0.5),
          "left"
        ) - 8
      break
    case "block":
      bottomY = await drawPdfLibBlock(item, context, topY, fullFrame)
      break
    case "columns":
      bottomY = await drawPdfLibColumns(item, context, topY)
      break
    case "signing_intro":
      bottomY = drawPdfLibSigningIntro(context, topY)
      break
    case "signer":
      bottomY = await drawPdfLibSigner(context, item.signer, topY)
      break
  }

  return bottomY - context.layout.densityItemGapAdjustment
}

async function drawPdfLibBranding(
  context: PdfLibRenderContext,
  topY: number
): Promise<number> {
  const { branding } = context.content
  const { contentWidth, margin } = context.layout

  if (!branding.logoDataUrl && !branding.organizationName) {
    return topY
  }

  const availableWidth = contentWidth
  let logoHeight = 0
  let logoWidth = 0
  let logoX = margin

  if (branding.logoDataUrl) {
    const logo = await embedPdfLibImage(context, branding.logoDataUrl)
    const size = fitPdfImage(
      logo,
      availableWidth * (branding.logoWidthPercent / 100),
      34
    )
    logoHeight = size.height
    logoWidth = size.width
    logoX =
      branding.logoAlignment === "center"
        ? margin + (availableWidth - size.width) / 2
        : branding.logoAlignment === "right"
          ? margin + availableWidth - size.width
          : margin
    context.page.drawImage(logo, {
      x: logoX,
      y: topY - size.height,
      height: size.height,
      width: size.width
    })
  }

  if (branding.organizationName) {
    const sideBySide =
      branding.logoDataUrl !== null && branding.logoAlignment === "left"
    const textX = sideBySide ? logoX + logoWidth + 10 : margin
    const textWidth = sideBySide
      ? margin + availableWidth - textX
      : availableWidth
    const lines = wrapPdfText(
      branding.organizationName,
      context.boldFont,
      12,
      textWidth
    )
    const firstLineY = sideBySide ? topY - 14 : topY - logoHeight - 14

    lines.forEach((line: string, index: number): void => {
      const lineWidth = context.boldFont.widthOfTextAtSize(line, 12)
      const alignedTextX =
        branding.logoAlignment === "center" && !sideBySide
          ? margin + (availableWidth - lineWidth) / 2
          : branding.logoAlignment === "right" && !sideBySide
            ? margin + availableWidth - lineWidth
            : textX

      context.page.drawText(line, {
        x: alignedTextX,
        y: firstLineY - index * 16,
        color: hexToPdfColor(branding.primaryColor),
        font: context.boldFont,
        size: 12
      })
    })

    if (!sideBySide) {
      return topY - logoHeight - lines.length * 16 - 8
    }
  }

  return topY - Math.max(46, logoHeight + 8)
}

async function drawPdfLibBlock(
  item: PdfBlockFlowItem,
  context: PdfLibRenderContext,
  topY: number,
  frame: PdfContentFrame
): Promise<number> {
  const { block } = item
  const primaryColor = hexToPdfColor(context.content.branding.primaryColor)

  switch (block.type) {
    case "heading": {
      const size = block.level === 1 ? 20 : block.level === 2 ? 16 : 13
      const lineHeight = block.level === 1 ? 29 : block.level === 2 ? 24 : 20

      return (
        drawWrappedPdfText(
          context,
          block.text,
          topY - 10,
          frame.x,
          frame.width,
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
          frame.x,
          frame.width,
          10,
          15,
          context.regularFont,
          rgb(0.07, 0.09, 0.13),
          block.alignment
        ) - 8
      )
    case "bullet_list":
    case "numbered_list":
      return drawPdfLibList(item, context, topY, frame)
    case "image":
      return drawPdfLibContentImage(context, block, topY, frame)
    case "table":
      return drawPdfLibTable(context, block, topY, frame)
    case "divider":
      context.page.drawLine({
        start: { x: frame.x, y: topY - 6 },
        end: { x: frame.x + frame.width, y: topY - 6 },
        color: rgb(0.82, 0.84, 0.87),
        thickness: 0.8
      })
      return topY - 20
    case "file_field":
      return drawPdfLibField(item, context, topY, frame)
    default:
      return drawPdfLibField(item, context, topY, frame)
  }
}

async function drawPdfLibColumns(
  item: Extract<PdfFlowItem, { kind: "columns" }>,
  context: PdfLibRenderContext,
  topY: number
): Promise<number> {
  const columnWidth = getPdfColumnWidth(context.layout)
  const leftFrame: PdfContentFrame = {
    x: context.layout.margin,
    width: columnWidth
  }
  const rightFrame: PdfContentFrame = {
    x: context.layout.margin + columnWidth + context.layout.columnGap,
    width: columnWidth
  }
  const leftBottom = item.left
    ? await drawPdfLibBlock(item.left, context, topY, leftFrame)
    : topY
  const rightBottom = item.right
    ? await drawPdfLibBlock(item.right, context, topY, rightFrame)
    : topY

  return Math.min(leftBottom, rightBottom)
}

function drawPdfLibList(
  item: PdfBlockFlowItem,
  context: PdfLibRenderContext,
  topY: number,
  frame: PdfContentFrame
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
        frame.x + 12,
        frame.width - 12,
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
  topY: number,
  frame: PdfContentFrame
): Promise<number> {
  const image = await embedPdfLibImage(context, block.dataUrl)
  const maximumWidth = frame.width * (block.widthPercent / 100)
  const maximumHeight = Math.min(260, context.layout.pageCapacity * 0.72)
  const size = fitPdfImage(image, maximumWidth, maximumHeight)
  const imageX =
    block.alignment === "left"
      ? frame.x
      : block.alignment === "right"
        ? frame.x + frame.width - size.width
        : frame.x + (frame.width - size.width) / 2

  context.page.drawImage(image, {
    x: imageX,
    y: topY - size.height,
    height: size.height,
    width: size.width
  })

  let cursorY = topY - size.height - 4

  if (block.caption) {
    cursorY =
      drawWrappedPdfText(
        context,
        block.caption,
        cursorY,
        frame.x,
        frame.width,
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
  topY: number,
  frame: PdfContentFrame
): number {
  const columnCount = block.headers.length
  const columnWidth = frame.width / columnCount
  let cursorY = topY

  const drawRow = (cells: string[], font: PDFFont, fillColor?: RGB): void => {
    const wrappedCells = Array.from(
      { length: columnCount },
      (_value: unknown, index: number): string[] =>
        wrapPdfText(cells[index] ?? "", font, 9, columnWidth - 10)
    )
    const rowHeight =
      Math.max(
        1,
        ...wrappedCells.map((lines: string[]): number => lines.length)
      ) *
        12 +
      10

    wrappedCells.forEach((lines: string[], cellIndex: number): void => {
      const x = frame.x + cellIndex * columnWidth
      context.page.drawRectangle({
        x,
        y: cursorY - rowHeight,
        width: columnWidth,
        height: rowHeight,
        borderColor: rgb(0.61, 0.64, 0.69),
        borderWidth: 0.7,
        color: fillColor
      })

      lines.forEach((line: string, lineIndex: number): void => {
        context.page.drawText(line, {
          x: x + 5,
          y: cursorY - 5 - 9 - lineIndex * 12,
          color: rgb(0.07, 0.09, 0.13),
          font,
          size: 9
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
  item: PdfBlockFlowItem,
  context: PdfLibRenderContext,
  topY: number,
  frame: PdfContentFrame
): Promise<number> {
  const block = item.block as PdfFieldBlock
  const label = `${block.label}${
    item.fieldContinued ? " (continued)" : block.required ? " *" : ""
  }`
  let cursorY = drawWrappedPdfText(
    context,
    label,
    topY,
    frame.x,
    frame.width,
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
    const size = fitPdfImage(drawing, Math.min(150, frame.width), 45)
    context.page.drawImage(drawing, {
      x: frame.x,
      y: cursorY - size.height,
      height: size.height,
      width: size.width
    })
    cursorY -= Math.max(45, size.height)
  } else {
    const answer =
      (block.type === "signature_field" || block.type === "initials_field") &&
      context.hasSigners
        ? "Captured per signer in signing record below"
        : (item.answerOverride ??
          formatFieldValue(block, context.answers[block.fieldKey]))
    const answerBottom = drawWrappedPdfText(
      context,
      answer,
      cursorY,
      frame.x,
      frame.width,
      10,
      15,
      context.regularFont,
      rgb(0.07, 0.09, 0.13),
      "left"
    )
    cursorY = Math.min(cursorY - 18, answerBottom)
  }

  context.page.drawLine({
    start: { x: frame.x, y: cursorY },
    end: { x: frame.x + frame.width, y: cursorY },
    color: rgb(0.61, 0.64, 0.69),
    thickness: 0.7
  })
  cursorY -= 3

  if (block.helpText && !item.fieldContinued) {
    cursorY = drawWrappedPdfText(
      context,
      block.helpText,
      cursorY,
      frame.x,
      frame.width,
      7,
      10,
      context.regularFont,
      rgb(0.42, 0.45, 0.5),
      "left"
    )
  }

  return cursorY - 7
}
