import { readFile } from "node:fs/promises"

import * as fontkit from "fontkit"
import {
  PDFDocument,
  PDFRadioGroup,
  rgb,
  type PDFFont,
  type PDFImage,
  type RGB
} from "pdf-lib"

import { DocumentFontError, getDocumentFontAsset, resolveDocumentFont } from "@/services/document-font-service"
import type { TemplateBlock } from "@/types/template"

import {
  PDF_BOLD_FONT_PATH,
  PDF_BOLD_ITALIC_FONT_PATH,
  PDF_ITALIC_FONT_PATH,
  PDF_REGULAR_FONT_PATH
} from "./constants"
import { DocumentPdfServiceError } from "./errors"
import { embedPdfLibImage, fitPdfImage } from "./pdf-lib-images"
import { drawRichPdfText } from "./pdf-lib-rich-text"
import { drawPdfLibSigner, drawPdfLibSigningIntro } from "./pdf-lib-signing"
import {
  drawWrappedPdfText,
  hexToPdfColor,
  normalizeStandardFontText,
  wrapPdfText
} from "./pdf-lib-text"
import type { PdfLibRenderContext } from "./pdf-lib-types"
import { createPdfLayoutMetrics, getPdfColumnFrames } from "./layout"
import {
  ANSWER_BOX_PADDING,
  answerBoxHeight,
  CHECKBOX_LABEL_INSET,
  formatFieldValue,
  isFieldChecked,
  normalizeDrawingDataUrl,
  packRadioOptions,
  RADIO_ACROSS_GAP
} from "./shared"
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
  pages: PdfPagePlan[],
  { fillable = false, readImage }: { fillable?: boolean; readImage?: PdfLibRenderContext["readImage"] } = {}
): Promise<Buffer> {
  const document = await PDFDocument.create()
  const imageCache = new Map<string, PDFImage>()
  const fontBytes = await loadBundledPdfFonts()
  const layout = createPdfLayoutMetrics(
    input.renderPlan.geometry,
    input.renderPlan.layout
  )

  document.registerFontkit(fontkit)
  // Only the glyphs a document draws are embedded: whole faces made even a
  // one-line document about 0.9 MB.
  const regularFont = await document.embedFont(fontBytes.regular, { subset: true })
  const boldFont = await document.embedFont(fontBytes.bold, { subset: true })
  // The whole face, not a subset: whoever fills the form in may type any letter.
  const formFont = fillable ? await document.embedFont(fontBytes.regular) : undefined
  // Slanted faces only for a document with italic words, so others stay as they were.
  const faces = new Map<string, Promise<PDFFont>>([
    ["bold", Promise.resolve(boldFont)],
    ["regular", Promise.resolve(regularFont)]
  ])
  const defaultFace = (bold: boolean, italic: boolean): Promise<PDFFont> => {
    const key = `${bold ? "bold" : "regular"}${italic ? "-italic" : ""}`
    const face =
      faces.get(key) ??
      readFile(bold ? PDF_BOLD_ITALIC_FONT_PATH : PDF_ITALIC_FONT_PATH).then((bytes: Buffer) => document.embedFont(bytes, { subset: true }))

    faces.set(key, face)

    return face
  }
  // A chosen family prints a character from the file that holds it; one the
  // family lacks, or a family no longer offered, prints in the default face.
  const characterSets = new Map<PDFFont, Set<number>>()
  const familyFace = async (font: string, bold: boolean, italic: boolean, character: string): Promise<PDFFont> => {
    const resolved = await resolveDocumentFont(font, bold, italic, character)

    if (!resolved) {
      return defaultFace(bold, italic)
    }

    const key = `${font}/${resolved.file}`
    const face =
      faces.get(key) ??
      getDocumentFontAsset(font, resolved.file).then(
        ({ body }) => document.embedFont(body, { subset: true }),
        (error: unknown) => {
          // Fontsource being unreachable passes; a PDF printed without the font would not.
          throw error instanceof DocumentFontError
            ? new DocumentPdfServiceError("A font this document uses is unavailable right now. Please try again.", 503)
            : error
        }
      )

    faces.set(key, face)

    const embedded = await face
    const drawn = characterSets.get(embedded) ?? new Set(embedded.getCharacterSet())

    characterSets.set(embedded, drawn)

    return drawn.has(character.codePointAt(0) ?? 32) ? embedded : defaultFace(bold, italic)
  }
  const chosenFaces = new Map<string, Promise<PDFFont>>()
  const faceFor: PdfLibRenderContext["faceFor"] = (bold, italic, font, character = " ") => {
    if (!font) {
      return defaultFace(bold, italic)
    }

    const key = `${font}:${bold}:${italic}:${character}`
    const face = chosenFaces.get(key) ?? familyFace(font, bold, italic, character)

    chosenFaces.set(key, face)

    return face
  }

  const freeImages = input.renderPlan.blocks.flatMap(({ block }) => (block.type === "image" && block.placement ? [block] : []))

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
      faceFor,
      formFont,
      freeImages,
      hasSigners: input.signers.length > 0,
      imageCache,
      layout,
      page,
      readImage,
      regularFont,
      workflowStatus: input.workflowStatus
    }

    await drawPdfLibPage(
      context,
      pages[pageIndex],
      pageIndex + 1,
      pages.length
    )

    // Drawn on the page the content was designed on, then printed on its paper.
    if (input.renderPlan.geometry.scale !== 1) {
      page.scale(input.renderPlan.geometry.scale, input.renderPlan.geometry.scale)
    }
  }

  // Drawn once every field is on its page, in a face that writes every answer.
  if (formFont) {
    document.getForm().updateFieldAppearances(formFont)
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
  return Buffer.from(await document.save({ updateFieldAppearances: false, useObjectStreams: false }))
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

  for (const block of context.freeImages) {
    if (block.placement?.page === pageNumber) {
      await drawPdfLibPlacedImage(context, block, block.placement)
    }
  }
}

// A picture placed on its page prints over the text there, fitted to its saved
// box, with any caption along the box's foot.
async function drawPdfLibPlacedImage(
  context: PdfLibRenderContext,
  block: PdfLibRenderContext["freeImages"][number],
  box: NonNullable<PdfLibRenderContext["freeImages"][number]["placement"]>
): Promise<void> {
  const { pageHeight, pageWidth } = context.layout
  const left = (pageWidth * box.x) / 100
  const top = pageHeight * (1 - box.y / 100)
  const width = (pageWidth * box.width) / 100
  const pictureHeight = Math.max(1, (pageHeight * box.height) / 100 - (block.caption ? 14 : 0))
  const image = await embedPdfLibImage(context, block)
  const fitted = image.scaleToFit(width, pictureHeight)

  context.page.drawImage(image, {
    height: fitted.height,
    width: fitted.width,
    x: left + (width - fitted.width) / 2,
    y: top - (pictureHeight + fitted.height) / 2,
  })

  if (block.caption) {
    drawWrappedPdfText(context, block.caption, top - pictureHeight, left, width, 8, 10, context.regularFont, rgb(0.4, 0.4, 0.4), "center")
  }
}

function drawPdfLibFooter(
  context: PdfLibRenderContext,
  pageNumber: number,
  totalPages: number
): void {
  const { contentWidth, margin } = context.layout
  const footerTop = context.layout.marginBottom

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
    y: context.layout.marginBottom / 2,
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
    case "space":
      return topY - item.height
    case "block":
      bottomY = await drawPdfLibBlock(
        item,
        context,
        topY,
        item.frame
          ? { width: (fullFrame.width * item.frame.width) / 100, x: fullFrame.x + (fullFrame.width * item.frame.left) / 100 }
          : fullFrame
      )
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

  const hasLogo = Boolean(branding.logoAsset || branding.logoDataUrl)

  if (!hasLogo && !branding.organizationName) {
    return topY
  }

  const availableWidth = contentWidth
  let logoHeight = 0
  let logoWidth = 0
  let logoX = margin

  if (hasLogo) {
    const logo = await embedPdfLibImage(context, { asset: branding.logoAsset, dataUrl: branding.logoDataUrl })
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
      hasLogo && branding.logoAlignment === "left"
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
      const lineHeight = context.layout.lineSpacing ? size * context.layout.lineSpacing : block.level === 1 ? 29 : block.level === 2 ? 24 : 20

      if (block.runs) {
        return (
          (await drawRichPdfText(context, block.runs, topY - 10, frame.x, frame.width, size, lineHeight, true, primaryColor, block.alignment)) - 6
        )
      }

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
      if (block.runs) {
        return (
          (await drawRichPdfText(context, block.runs, topY, frame.x, frame.width, 10, 10 * (context.layout.lineSpacing ?? 1.5), false, rgb(0.07, 0.09, 0.13), block.alignment)) - 8
        )
      }

      return (
        drawWrappedPdfText(
          context,
          block.text,
          topY,
          frame.x,
          frame.width,
          10,
          10 * (context.layout.lineSpacing ?? 1.5),
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
  const frames = getPdfColumnFrames(context.layout, item.widths)
  let bottom = topY

  for (const [column, cell] of item.cells.entries()) {
    const frame = frames[column]

    if (cell && frame) {
      bottom = Math.min(bottom, await drawPdfLibBlock(cell, context, topY, frame))
    }
  }

  return bottom
}

async function drawPdfLibList(
  item: PdfBlockFlowItem,
  context: PdfLibRenderContext,
  topY: number,
  frame: PdfContentFrame
): Promise<number> {
  if (
    item.block.type !== "bullet_list" &&
    item.block.type !== "numbered_list"
  ) {
    return topY
  }

  let cursorY = topY

  for (const [index, value] of item.block.items.entries()) {
    const defaultMarker =
      item.block.type === "bullet_list" ? "-" : `${index + 1}.`
    const marker = item.listMarkers?.[index] ?? defaultMarker
    const text = `${marker}${marker.length === 0 ? "    " : " "}${value}`
    const runs = item.block.itemRuns?.[index]

    if (runs) {
      cursorY =
        (await drawRichPdfText(
          context,
          marker ? [{ text: `${marker} ` }, ...runs] : runs,
          cursorY,
          frame.x + 12,
          frame.width - 12,
          10,
          10 * (context.layout.lineSpacing ?? 1.5),
          false,
          rgb(0.07, 0.09, 0.13),
          "left"
        )) - 3
      continue
    }

    cursorY =
      drawWrappedPdfText(
        context,
        text,
        cursorY,
        frame.x + 12,
        frame.width - 12,
        10,
        10 * (context.layout.lineSpacing ?? 1.5),
        context.regularFont,
        rgb(0.07, 0.09, 0.13),
        "left"
      ) - 3
  }

  return cursorY - 5
}

async function drawPdfLibContentImage(
  context: PdfLibRenderContext,
  block: Extract<TemplateBlock, { type: "image" }>,
  topY: number,
  frame: PdfContentFrame
): Promise<number> {
  const image = await embedPdfLibImage(context, block)
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
  const ink = rgb(0.07, 0.09, 0.13)
  const edge = rgb(0.61, 0.64, 0.69)
  let cursorY: number

  // A checkbox prints as the editor shows it: a box with its label beside it.
  if (block.type === "checkbox_field") {
    const size = 10
    context.page.drawRectangle({
      borderColor: edge,
      borderWidth: 0.7,
      height: size,
      width: size,
      x: frame.x,
      y: topY - 2 - size,
    })

    const checked = isFieldChecked(block, context.answers[block.fieldKey])

    if (context.formFont) {
      const box = context.document.getForm().createCheckBox(formFieldName(context, block.fieldKey))
      box.addToPage(context.page, { borderWidth: 0, height: size, width: size, x: frame.x, y: topY - 2 - size })

      if (checked) {
        box.check()
      }
    } else if (checked) {
      context.page.drawLine({ color: ink, end: { x: frame.x + 4, y: topY - 10 }, start: { x: frame.x + 2, y: topY - 7 }, thickness: 1.2 })
      context.page.drawLine({ color: ink, end: { x: frame.x + 8.5, y: topY - 4 }, start: { x: frame.x + 4, y: topY - 10 }, thickness: 1.2 })
    }

    cursorY = drawWrappedPdfText(context, label, topY, frame.x + CHECKBOX_LABEL_INSET, frame.width - CHECKBOX_LABEL_INSET, 10, 15, context.regularFont, ink, "left")
  } else if (block.type === "dropdown_field" && block.display === "radios") {
    // Radio buttons print as the editor shows them: under the label, each
    // option on its own line beside a circle, the chosen one filled.
    const size = 10
    const answer = formatFieldValue(block, context.answers[block.fieldKey])
    const form = context.document.getForm()
    // A piece carried to the next page answers the question its first piece began.
    const earlier = item.fieldContinued ? form.getFieldMaybe(block.fieldKey) : undefined
    const group = context.formFont
      ? earlier instanceof PDFRadioGroup
        ? earlier
        : form.createRadioGroup(formFieldName(context, block.fieldKey))
      : null

    cursorY = drawWrappedPdfText(context, label, topY, frame.x, frame.width, 9, 13, context.boldFont, ink, "left") - 3

    // Side by side, options share a line until it is full; otherwise one a line.
    const measure = (option: string): number => CHECKBOX_LABEL_INSET + context.regularFont.widthOfTextAtSize(option, 10)
    const lines = block.across ? packRadioOptions(block.options, frame.width, measure) : block.options.map((option: string): string[] => [option])

    for (const line of lines) {
      let x = frame.x
      let lineBottom = cursorY

      for (const option of line) {
        const circle = { x: x + size / 2, y: cursorY - 2 - size / 2 }

        if (group) {
          group.addOptionToPage(option, context.page, { borderColor: edge, borderWidth: 0.7, height: size, textColor: ink, width: size, x, y: cursorY - 2 - size })
        } else {
          context.page.drawCircle({ ...circle, borderColor: edge, borderWidth: 0.7, size: size / 2 })

          if (option === answer) {
            context.page.drawCircle({ ...circle, color: ink, size: 2.5 })
          }
        }

        lineBottom = Math.min(lineBottom, drawWrappedPdfText(context, option, cursorY, x + CHECKBOX_LABEL_INSET, frame.x + frame.width - x - CHECKBOX_LABEL_INSET, 10, 15, context.regularFont, ink, "left"))
        x += measure(option) + RADIO_ACROSS_GAP
      }

      cursorY = lineBottom
    }

    if (group && block.options.includes(answer)) {
      group.select(answer)
    }
  } else {
    cursorY = drawWrappedPdfText(context, label, topY, frame.x, frame.width, 9, 13, context.boldFont, ink, "left") - 3

    const boxTop = cursorY
    const inner = frame.width - ANSWER_BOX_PADDING * 2
    const drawingDataUrl =
      block.type === "signature_field" || block.type === "initials_field"
        ? normalizeDrawingDataUrl(context.answers[block.fieldKey])
        : null
    let contentBottom = boxTop

    if (drawingDataUrl) {
      const drawing = await embedPdfLibImage(context, drawingDataUrl)
      const size = fitPdfImage(drawing, Math.min(150, inner), 45)
      context.page.drawImage(drawing, {
        x: frame.x + ANSWER_BOX_PADDING,
        y: boxTop - ANSWER_BOX_PADDING - size.height,
        height: size.height,
        width: size.width
      })
      contentBottom = boxTop - ANSWER_BOX_PADDING - size.height
    } else {
      const answer =
        (block.type === "signature_field" || block.type === "initials_field") &&
        context.hasSigners
          ? "Captured per signer in signing record below"
          : (item.answerOverride ??
            formatFieldValue(block, context.answers[block.fieldKey]))

      if (context.formFont && FORM_FIELD_TYPES.has(block.type)) {
        // The box keeps the height its answer takes, so both PDFs page alike.
        contentBottom = boxTop - ANSWER_BOX_PADDING - (answer ? wrapPdfText(answer, context.regularFont, 10, inner).length * 15 : 0)
      } else if (answer) {
        contentBottom = drawWrappedPdfText(context, answer, boxTop - ANSWER_BOX_PADDING, frame.x + ANSWER_BOX_PADDING, inner, 10, 15, context.regularFont, ink, "left")
      }
    }

    const boxHeight = Math.max(answerBoxHeight(block), boxTop - contentBottom + ANSWER_BOX_PADDING)

    if (context.formFont && FORM_FIELD_TYPES.has(block.type)) {
      addPdfFormField(context, item, block, { height: boxHeight, width: frame.width, x: frame.x, y: boxTop - boxHeight })
    }

    // A faint edge, so the page reads as a document and still shows where to write;
    // a signature's foot is the full line it is signed on.
    context.page.drawRectangle({
      borderColor: rgb(0.85, 0.83, 0.81),
      borderWidth: 0.7,
      height: boxHeight,
      width: frame.width,
      x: frame.x,
      y: boxTop - boxHeight,
    })

    if (block.type === "signature_field" || block.type === "initials_field") {
      context.page.drawLine({ color: edge, end: { x: frame.x + frame.width, y: boxTop - boxHeight }, start: { x: frame.x, y: boxTop - boxHeight }, thickness: 0.7 })
    }

    cursorY = boxTop - boxHeight
  }

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

// Answers someone can type or pick in a PDF viewer; a signature is drawn in the viewer's own way.
const FORM_FIELD_TYPES = new Set<PdfFieldBlock["type"]>(["date_field", "dropdown_field", "text_field"])

/**
 * A field's name in the PDF's form: its key, or its key and a number for the
 * second box a field fills, such as the rest of an answer on the next page.
 */
function formFieldName(context: PdfLibRenderContext, fieldKey: string): string {
  const form = context.document.getForm()
  let name = fieldKey

  for (let count = 2; form.getFieldMaybe(name); count += 1) {
    name = `${fieldKey} ${count}`
  }

  return name
}

/**
 * Puts a form field where an answer prints, holding the answer so far.
 *
 * @param context - The page being drawn, with the form's face.
 * @param item - The field, or the part of a long answer on this page.
 * @param block - The field.
 * @param rectangle - Where its box prints.
 */
function addPdfFormField(
  context: PdfLibRenderContext,
  item: PdfBlockFlowItem,
  block: PdfFieldBlock,
  rectangle: { height: number; width: number; x: number; y: number }
): void {
  const form = context.document.getForm()
  const name = formFieldName(context, block.fieldKey)
  const value = item.answerOverride ?? formatFieldValue(block, context.answers[block.fieldKey])
  const widget = { ...rectangle, borderWidth: 0, font: context.formFont }

  if (block.type === "dropdown_field") {
    const dropdown = form.createDropdown(name)
    dropdown.addOptions(block.options)

    if (value && !block.options.includes(value)) {
      // An answer from before the choices changed stays as it was given.
      dropdown.enableEditing()
    }

    if (value) {
      dropdown.select(value, true)
    }

    dropdown.addToPage(context.page, widget)
    return
  }

  const text = form.createTextField(name)

  if (block.type === "text_field" && block.multiline) {
    text.enableMultiline()
  }

  text.addToPage(context.page, widget)
  text.setText(value)
  text.setFontSize(10)
}
