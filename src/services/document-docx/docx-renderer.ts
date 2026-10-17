
import {
  Document,
  Footer,
  Header,
  HorizontalPositionRelativeFrom,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  TextRun,
  TextWrappingType,
  VerticalPositionRelativeFrom,
  type ParagraphChild
} from "docx"

import { shouldRenderTemplateFooter, shouldRenderTemplateHeader } from "@/services/templates/template-render-plan"
import type { TemplateBlock, TemplateLayout, TextRun as TextRunOf } from "@/types/template"

import { PDF_BOLD_FONT_PATH, PDF_BOLD_ITALIC_FONT_PATH, PDF_ITALIC_FONT_PATH, PDF_REGULAR_FONT_PATH, readBundledFont } from "../document-pdf/constants"
import { boxedPdfMetrics, createPdfLayoutMetrics, getPdfRowFrames, listItemInset, SECTION_BOX_EDGE, SECTION_BOX_GAP, SECTION_BOX_INSET, SIGNER_NAME_LEADING } from "../document-pdf/layout"
import { readPicture } from "../document-pdf/pdf-lib-images"
import { measuringFace } from "../document-pdf/planner"
import { readablePdfTextOn, wrapPdfText } from "../document-pdf/pdf-lib-text"
import type { PdfLibRenderContext } from "../document-pdf/pdf-lib-types"
import { formatSignedAt, isCellRow } from "../document-pdf/shared"
import type { DocumentPdfSigner, NormalizedPdfInput, PdfBlockFlowItem, PdfFlowItem, PdfPagePlan } from "../document-pdf/types"
import { cellRow, fieldBlocks, rowsFieldBlocks } from "./docx-fields"
import {
  CARD_EDGE,
  cell,
  clean,
  docxUnits,
  DOCX_FONT_FAMILY,
  EDGE,
  hex,
  INK,
  MUTED,
  para,
  picture,
  richWords,
  row,
  RULE,
  spacer,
  SUBTLE,
  tab,
  table,
  wholeArea,
  words,
  type DocxArea,
  type DocxBlock,
  type DocxContext,
  type DocxPicture
} from "./docx-parts"

/**
 * Writes the PDF's page plans as a Word document: the same page size and
 * margins, each planned page starting a new page, and each item in the fonts,
 * sizes, colours and spacing the PDF draws it in.
 *
 * @param input - Validated document input, as the PDF renders it.
 * @param pages - The PDF planner's pages.
 * @param options - Reads stored pictures' print copies.
 * @returns The .docx bytes.
 */
export async function renderDocxDocument(input: NormalizedPdfInput, pages: readonly PdfPagePlan[], { readImage }: { readImage?: PdfLibRenderContext["readImage"] } = {}): Promise<Buffer> {
  const { geometry } = input.renderPlan
  const layout = createPdfLayoutMetrics(geometry, input.renderPlan.layout)
  const pictures = new Map<string, Promise<DocxPicture>>()
  const ctx: DocxContext = {
    answers: input.answers,
    content: input.content,
    extra: 0,
    layout,
    picture: (source) => {
      const key = typeof source === "string" ? source : source.asset ? `asset:${source.asset.id}` : (source.dataUrl ?? "")
      const loaded =
        pictures.get(key) ??
        readPicture(source, readImage).then(({ bytes, dimensions, format }) => ({ data: bytes, height: dimensions.height, type: format === "png" ? ("png" as const) : ("jpg" as const), width: dimensions.width }))

      pictures.set(key, loaded)

      return loaded
    },
    signers: input.signers,
    u: docxUnits(geometry.scale),
    workflowStatus: input.workflowStatus
  }
  const body: DocxBlock[] = []

  for (const [index, plan] of pages.entries()) {
    const placed = await placedPictures(ctx, input, index + 1)

    // Each planned page starts a new one, holding the pictures placed on it.
    if (index > 0 || placed.length > 0) {
      body.push(spacer(ctx, 0.05, { children: placed, pageBreakBefore: index > 0 }))
    }

    body.push(...(await pageBlocks(ctx, plan.items)))
  }

  const { u } = ctx
  const [first, rest] = [1, 2].map((page: number) => marginParagraphs(ctx, input, page))
  const landscape = geometry.widthPoints > geometry.heightPoints
  // Slanted faces only for a document with slanted words, as the PDF embeds them.
  const faces = [PDF_REGULAR_FONT_PATH, PDF_BOLD_FONT_PATH, ...(JSON.stringify(input.content).includes('"italic":true') ? [PDF_ITALIC_FONT_PATH, PDF_BOLD_ITALIC_FONT_PATH] : [])]
  const document = new Document({
    creator: "BizFlow Docs",
    description: "Generated business document",
    // Word shows the letters the PDF prints, wherever it opens.
    fonts: await Promise.all(faces.map(async (path: string) => ({ data: await readBundledFont(path), name: DOCX_FONT_FAMILY }))),
    sections: [
      {
        children: body,
        footers: { default: new Footer({ children: [rest!.footer] }), first: new Footer({ children: [first!.footer] }) },
        headers: { default: new Header({ children: [rest!.header] }), first: new Header({ children: [first!.header] }) },
        properties: {
          page: {
            margin: {
              bottom: u.twip(geometry.margins.bottom),
              footer: u.twip(Math.max(0, geometry.margins.bottom / 2 - 3)),
              header: u.twip(Math.max(0, geometry.margins.top / 2 - 4)),
              left: u.twip(geometry.margins.left),
              right: u.twip(geometry.margins.right),
              top: u.twip(geometry.margins.top)
            },
            // Word swaps a landscape page's sides itself.
            size: landscape
              ? { height: u.twip(geometry.widthPoints), orientation: PageOrientation.LANDSCAPE, width: u.twip(geometry.heightPoints) }
              : { height: u.twip(geometry.heightPoints), width: u.twip(geometry.widthPoints) }
          },
          titlePage: true
        }
      }
    ],
    styles: { default: { document: { run: { color: hex(INK), font: DOCX_FONT_FAMILY, size: u.half(10) } } } },
    title: clean(input.title)
  })

  return Packer.toBuffer(document, false, [{ data: fontTable(document.FontTable.fontOptionsWithKey.map(({ fontKey }) => fontKey)), path: "word/fontTable.xml" }])
}

// docx embeds each face as a font of its own; Word wants them as one family's
// regular, bold, italic and bold italic faces, in that order.
function fontTable(keys: readonly string[]): string {
  const faces = ["embedRegular", "embedBold", "embedItalic", "embedBoldItalic"]
    .slice(0, keys.length)
    .map((face: string, index: number) => `<w:${face} r:id="rId${index + 1}" w:fontKey="{${keys[index]!.toUpperCase()}}"/>`)
    .join("")

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:font w:name="${DOCX_FONT_FAMILY}"><w:family w:val="swiss"/><w:pitch w:val="variable"/>${faces}</w:font></w:fonts>`
}

// A page's items; a boxed section's run of them inside one box.
async function pageBlocks(ctx: DocxContext, items: readonly PdfFlowItem[]): Promise<DocxBlock[]> {
  const blocks: DocxBlock[] = []
  let index = 0

  while (index < items.length) {
    const item = items[index]!
    const sectionId = item.box?.sectionId
    let end = index + 1

    while (sectionId !== undefined && items[end]?.box?.sectionId === sectionId) {
      end += 1
    }

    blocks.push(...(sectionId === undefined ? await flowBlocks(ctx, item) : await boxBlocks(ctx, items.slice(index, end))))
    index = end
  }

  return blocks
}

// A boxed section's items on one page, inside its edge: along its top where
// it opens and its foot where it closes, the space under it after.
async function boxBlocks(ctx: DocxContext, items: readonly PdfFlowItem[]): Promise<DocxBlock[]> {
  const inner = { ...ctx, layout: boxedPdfMetrics(ctx.layout) }
  const opens = items[0]?.box?.opens === true
  const closes = items.at(-1)?.box?.closes === true
  const edge = { color: EDGE, size: SECTION_BOX_EDGE }
  const children: DocxBlock[] = []

  for (const item of items) {
    children.push(...(await flowBlocks(inner, { ...item, box: undefined })))
  }

  const box = cell(ctx, children, {
    edges: { bottom: closes ? edge : undefined, left: edge, right: edge, top: opens ? edge : undefined },
    pad: { bottom: closes ? SECTION_BOX_INSET : 0, left: SECTION_BOX_INSET, right: SECTION_BOX_INSET, top: opens ? SECTION_BOX_INSET : 0 },
    width: ctx.layout.contentWidth
  })

  return [table(ctx, [row(ctx, [box])], [ctx.layout.contentWidth], wholeArea(ctx.layout.contentWidth)), spacer(ctx, closes ? SECTION_BOX_GAP : 0.05)]
}

async function flowBlocks(base: DocxContext, item: PdfFlowItem): Promise<DocxBlock[]> {
  const joins = (item.kind === "block" || item.kind === "columns") && item.joinsNext === true
  const ctx = { ...base, extra: joins ? 0 : base.layout.densityItemGapAdjustment }
  const whole = wholeArea(ctx.layout.contentWidth)
  const primary = ctx.content.branding.primaryColor

  switch (item.kind) {
    case "branding":
      return brandingBlocks(ctx, whole)
    case "title":
      return [para(ctx, words(ctx, item.title, { bold: true, color: primary, size: 24 }), { after: 16 + ctx.extra, area: whole, leading: 35 })]
    case "section_label":
      return ctx.layout.sectionStyle === "band"
        ? [
            table(ctx, [row(ctx, [cell(ctx, [para(ctx, words(ctx, item.label, { bold: true, color: readablePdfTextOn(primary), size: 11 }), { area: wholeArea(whole.width - 12), leading: 15 })], { fill: primary, pad: { bottom: 5, left: 6, right: 6, top: 5 }, width: whole.width })])], [whole.width], whole),
            spacer(ctx, 8 + ctx.extra)
          ]
        : [para(ctx, words(ctx, item.label, { bold: true, color: primary, size: 15 }), { after: 10 + ctx.extra, area: whole, leading: 22 })]
    case "field_group_label":
      return [para(ctx, words(ctx, item.label.toUpperCase(), { bold: true, color: MUTED, size: 9 }), { after: 8 + ctx.extra, area: whole, leading: 13 })]
    case "cue":
      return [para(ctx, words(ctx, item.label, { color: MUTED, size: 9 }), { after: 4 + ctx.extra, area: whole, leading: 12 })]
    case "space":
      return [spacer(ctx, item.height)]
    case "block":
      return blockBlocks(ctx, item, item.frame ? { full: whole.width, left: (whole.width * item.frame.left) / 100, width: (whole.width * item.frame.width) / 100 } : whole)
    case "columns":
      return columnBlocks(ctx, item)
    case "signing_intro":
      return [
        para(ctx, words(ctx, "Signing record", { bold: true, size: 14 }), { area: whole, before: 10, leading: 18, topRule: { edge: { color: RULE, size: 0.8 }, space: 6 } }),
        para(ctx, words(ctx, ctx.workflowStatus === "completed" ? "All parties have signed." : "Waiting for all required parties to sign.", { color: SUBTLE, size: 9 }), { after: ctx.extra, area: whole, leading: 16 })
      ]
    case "signer":
      return signerBlocks(ctx, item.signer, whole)
  }
}

// Whether formatted words bigger than the block's own make its lines taller.
function grows(runs: readonly TextRunOf[] | null | undefined, size: number): boolean {
  return Boolean(runs?.some((run) => (run.size ?? size) > size))
}

async function blockBlocks(ctx: DocxContext, item: PdfBlockFlowItem, area: DocxArea): Promise<DocxBlock[]> {
  const { block } = item
  const primary = ctx.content.branding.primaryColor
  const spacing = ctx.layout.lineSpacing

  switch (block.type) {
    case "heading": {
      const size = block.level === 1 ? 20 : block.level === 2 ? 16 : 13
      const leading = spacing ? size * spacing : block.level === 1 ? 29 : block.level === 2 ? 24 : 20
      const look = { bold: true, color: primary, size }

      return [para(ctx, block.runs ? richWords(ctx, block.runs, look) : words(ctx, block.text, look), { after: 6 + ctx.extra, align: block.alignment, area, before: 10, grow: grows(block.runs, size), leading })]
    }
    case "paragraph": {
      const look = { size: 10 }

      return [para(ctx, block.runs ? richWords(ctx, block.runs, look) : words(ctx, block.text, look), { after: 8 + ctx.extra, align: block.alignment, area, grow: grows(block.runs, 10), leading: 10 * (spacing ?? 1.5) })]
    }
    case "bullet_list":
    case "numbered_list":
      return listBlocks(ctx, item, block, area)
    case "image":
      return imageBlocks(ctx, block, area)
    case "table": {
      const width = area.width / block.headers.length
      const edges = { bottom: { color: EDGE, size: 0.7 }, left: { color: EDGE, size: 0.7 }, right: { color: EDGE, size: 0.7 }, top: { color: EDGE, size: 0.7 } }
      const line = (cells: readonly string[], bold: boolean, fill?: string) =>
        row(
          ctx,
          block.headers.map((_header: string, column: number) =>
            cell(ctx, [para(ctx, words(ctx, cells[column] ?? "", { bold, size: 9 }), { area: wholeArea(width - 10), leading: 12 })], { edges, fill, pad: { bottom: 5, left: 5, right: 5, top: 5 }, width })
          ),
          22
        )

      return [table(ctx, [line(block.headers, true, "F2F4F7"), ...block.rows.map((cells: string[]) => line(cells, false))], block.headers.map(() => width), area), spacer(ctx, 10 + ctx.extra)]
    }
    case "divider":
      return [para(ctx, [], { after: 14 + ctx.extra, area, leading: 6, rules: { color: RULE, size: 0.8 } })]
    case "choice_grid_field":
    case "table_field":
      return rowsFieldBlocks(ctx, item, area)
    default:
      return fieldBlocks(ctx, item, area)
  }
}

// A list's items, each marker in its place and the words hanging clear of it.
function listBlocks(ctx: DocxContext, item: PdfBlockFlowItem, block: Extract<TemplateBlock, { type: "bullet_list" | "numbered_list" }>, area: DocxArea): DocxBlock[] {
  const leading = 10 * (ctx.layout.lineSpacing ?? 1.5)

  return block.items.map((value: string, index: number) => {
    const marker = item.listMarkers?.[index] ?? (block.type === "bullet_list" ? "-" : `${index + 1}.`)
    const inset = listItemInset(block.type, item.listLevels?.[index] ?? 0)
    const runs = block.itemRuns?.[index]
    const text = runs ? richWords(ctx, runs, { size: 10 }) : words(ctx, value, { size: 10 })

    // A piece carried over from the page before has no marker: its words start where they hang.
    const from = marker ? inset.marker : inset.words

    return para(ctx, marker ? [...words(ctx, marker, { size: 10 }), tab(), ...text] : text, {
      after: 3 + (index === block.items.length - 1 ? 5 + ctx.extra : 0),
      area: { ...area, left: area.left + from, width: area.width - from },
      grow: grows(runs, 10),
      hanging: marker ? inset.words - inset.marker : undefined,
      leading
    })
  })
}

async function imageBlocks(ctx: DocxContext, block: Extract<TemplateBlock, { type: "image" }>, area: DocxArea): Promise<DocxBlock[]> {
  const fitted = picture(ctx, await ctx.picture(block), area.width * (block.widthPercent / 100), Math.min(260, ctx.layout.pageCapacity * 0.72))

  return [
    para(ctx, [fitted.run], { after: block.caption ? 4 : 4 + ctx.extra, align: block.alignment, area, leading: 10 }),
    ...(block.caption ? [para(ctx, words(ctx, block.caption, { color: MUTED, size: 8 }), { after: 8 + ctx.extra, align: block.alignment, area, leading: 11 })] : [])
  ]
}

// Blocks side by side: cells that touch as one row of cells; anything else in
// columns with the gap between.
async function columnBlocks(ctx: DocxContext, item: Extract<PdfFlowItem, { kind: "columns" }>): Promise<DocxBlock[]> {
  const frames = getPdfRowFrames(ctx.layout, item)
  const whole = wholeArea(ctx.layout.contentWidth)

  if (isCellRow(item.cells, ctx.layout.fieldStyle)) {
    return cellRow(ctx, item.cells, frames.map((frame) => frame.width), whole, item.joinsNext === true)
  }

  const inCell = { ...ctx, extra: 0 }
  const widths: number[] = []
  const cells = []
  let x = ctx.layout.margin

  for (const [column, frame] of frames.entries()) {
    const content = item.cells[column]

    if (frame.x - x > 0.01) {
      widths.push(frame.x - x)
      cells.push(cell(ctx, [], { width: frame.x - x }))
    }

    widths.push(frame.width)
    cells.push(cell(ctx, content ? await blockBlocks(inCell, content, wholeArea(frame.width)) : [], { width: frame.width }))
    x = frame.x + frame.width
  }

  return [table(ctx, [row(ctx, cells)], widths, whole), spacer(ctx, ctx.extra)]
}

// The logo and the organisation's name: side by side when the logo sits left,
// otherwise the name under it, both aligned as the logo is.
async function brandingBlocks(ctx: DocxContext, area: DocxArea): Promise<DocxBlock[]> {
  const { branding } = ctx.content
  const hasLogo = Boolean(branding.logoAsset || branding.logoDataUrl)
  const logo = hasLogo ? picture(ctx, await ctx.picture({ asset: branding.logoAsset, dataUrl: branding.logoDataUrl }), area.width * (branding.logoWidthPercent / 100), 34) : null
  const name = branding.organizationName ? words(ctx, branding.organizationName, { bold: true, color: branding.primaryColor, size: 12 }) : null
  const align = branding.logoAlignment
  const tall = Math.max(46, (logo?.height ?? 0) + 8)

  if (logo && name && align === "left") {
    const rest = area.width - logo.width - 10

    return [
      table(ctx, [row(ctx, [cell(ctx, [para(ctx, [logo.run], { area: wholeArea(logo.width), leading: 10 })], { width: logo.width + 10 }), cell(ctx, [para(ctx, name, { area: wholeArea(rest), leading: 16 })], { pad: { top: 2 }, width: rest })], tall)], [logo.width + 10, rest], area),
      spacer(ctx, ctx.extra)
    ]
  }

  return [
    ...(logo ? [para(ctx, [logo.run], { after: name ? 0 : tall - logo.height + ctx.extra, align, area, leading: 10 })] : []),
    ...(name ? [para(ctx, name, { after: 8 + ctx.extra, align, area, leading: 16 })] : [])
  ]
}

// A signer's card: name, address and where their signature stands, with any
// signature and initials at its right; its edge runs round all of it.
async function signerBlocks(ctx: DocxContext, signer: DocumentPdfSigner, area: DocxArea): Promise<DocxBlock[]> {
  const nameWidth = area.width - 14 - (signer.signatureDataUrl ? 98 : 0) - (signer.initialsDataUrl ? 58 : 0)
  const status = signer.status === "signed" && signer.signedAt ? `Signed ${formatSignedAt(signer.signedAt)}` : signer.requiresSignature ? "Signature pending" : "Signature not required"
  const drawing = async (dataUrl: string, label: string, width: number, gap: number) => {
    const fitted = picture(ctx, await ctx.picture(dataUrl), width, 26)

    return { children: [para(ctx, words(ctx, label, { color: MUTED, size: 6 }), { area: wholeArea(width), leading: 8 }), para(ctx, [fitted.run], { area: wholeArea(width), leading: 10 })], pad: { right: gap, top: 4 }, width: width + gap }
  }
  const parts = [
    {
      children: [
        para(ctx, words(ctx, signer.name, { bold: true, size: 10 }), { area: wholeArea(nameWidth), leading: SIGNER_NAME_LEADING }),
        para(ctx, words(ctx, signer.email, { color: SUBTLE, size: 8 }), { area: wholeArea(nameWidth), leading: 14 }),
        para(ctx, words(ctx, status, { color: SUBTLE, size: 8 }), { area: wholeArea(nameWidth), leading: 13 })
      ],
      pad: { left: 7, right: 7, top: 6 },
      width: nameWidth + 14
    },
    ...(signer.signatureDataUrl ? [await drawing(signer.signatureDataUrl, "Signature", 88, 10)] : []),
    ...(signer.initialsDataUrl ? [await drawing(signer.initialsDataUrl, "Initials", 48, 10)] : [])
  ]
  const edge = { color: CARD_EDGE, size: 0.8 }
  const cells = parts.map(({ children, pad, width }, index: number) =>
    cell(ctx, children, { edges: { bottom: edge, left: index === 0 ? edge : undefined, right: index === parts.length - 1 ? edge : undefined, top: edge }, pad, width })
  )
  const height = (signer.signatureDataUrl || signer.initialsDataUrl ? 68 : 54) + (wrapPdfText(signer.name, measuringFace(true), 10, nameWidth).length - 1) * SIGNER_NAME_LEADING

  return [table(ctx, [row(ctx, cells, height)], parts.map((part) => part.width), area), spacer(ctx, 6 + ctx.extra)]
}

// Pictures placed on a page rather than in the flow, over the text there,
// fitted to their saved box as the PDF fits them.
async function placedPictures(ctx: DocxContext, input: NormalizedPdfInput, page: number): Promise<ParagraphChild[]> {
  const { pageHeight, pageWidth } = ctx.layout
  const placed = input.renderPlan.blocks.flatMap(({ block }) => (block.type === "image" && block.placement?.page === page ? [{ block, box: block.placement }] : []))

  return Promise.all(
    placed.map(async ({ block, box }) => {
      const left = (pageWidth * box.x) / 100
      const top = (pageHeight * box.y) / 100
      const width = (pageWidth * box.width) / 100
      const height = Math.max(1, (pageHeight * box.height) / 100 - (block.caption ? 14 : 0))

      return picture(ctx, await ctx.picture(block), width, height, (size) => ({
        allowOverlap: true,
        horizontalPosition: { offset: ctx.u.emu(left + (width - size.width) / 2), relative: HorizontalPositionRelativeFrom.PAGE },
        verticalPosition: { offset: ctx.u.emu(top + (height - size.height) / 2), relative: VerticalPositionRelativeFrom.PAGE },
        wrap: { type: TextWrappingType.NONE }
      })).run
    })
  )
}

/**
 * The words in a page's top and bottom margins, as the PDF prints them on the
 * first page or on the pages after it: the layout's margin text with its
 * {title} filled in and {page} and {pages} as Word's own page fields, and
 * "Page X of Y" at the footer's right when numbering is on and nothing is
 * written there. A rule runs over the footer when it holds anything.
 */
function marginParagraphs(ctx: DocxContext, input: NormalizedPdfInput, page: number): { footer: Paragraph; header: Paragraph } {
  const layout = input.renderPlan.layout
  const width = ctx.layout.contentWidth
  const title = input.renderPlan.title || input.title
  const fill = (text: string | undefined, size: number): ParagraphChild[] =>
    (text ?? "")
      .trim()
      .split(/(\{(?:pages|page|title)\})/)
      .flatMap((part: string): ParagraphChild[] => {
        const look = { color: MUTED, size }

        if (part === "{page}" || part === "{pages}") {
          return [new TextRun({ children: [part === "{page}" ? PageNumber.CURRENT : PageNumber.TOTAL_PAGES], color: hex(MUTED), size: ctx.u.half(size) })]
        }

        return part ? words(ctx, part === "{title}" ? title : part, look) : []
      })
  const slots = (text: TemplateLayout["headerText"], right?: ParagraphChild[]): ParagraphChild[] => [
    ...fill(text?.left, 7.5),
    tab(),
    ...fill(text?.center, 7.5),
    tab(),
    ...(right ?? fill(text?.right, 7.5))
  ]
  const tabs = [{ at: width / 2 }, { at: width, right: true }]
  const footerOn = shouldRenderTemplateFooter(layout, page)
  const footerText = footerOn ? layout.footerText : undefined
  const label = footerOn && layout.pageNumbering === "page_x_of_y" && !footerText?.right?.trim()
  const pageLabel = label ? [...fill("Page {page} of {pages}", 7)] : undefined
  const anything = Boolean(pageLabel || Object.values(footerText ?? {}).some((text) => text?.trim()))
  const centred = { area: wholeArea(width), leading: 10, tabs }

  return {
    footer: para(ctx, slots(footerText, pageLabel), anything ? { ...centred, topRule: { edge: { color: CARD_EDGE, size: 0.8 }, space: Math.max(0, input.renderPlan.geometry.margins.bottom / 2 - 9) } } : centred),
    header: para(ctx, slots(shouldRenderTemplateHeader(layout, page) ? layout.headerText : undefined), centred)
  }
}
