import { Paragraph, type ParagraphChild, type TableCell } from "docx"

import type { TemplateBlock } from "@/types/template"

import { measuringFace } from "../document-pdf/planner"
import { fieldLabel } from "../document-pdf/pdf-lib-renderer"
import { hexToPdfColor, wrapPdfText } from "../document-pdf/pdf-lib-text"
import {
  AFFIX_GAP,
  ANSWER_BOX_PADDING,
  answerBoxHeight,
  CAPTION_GAP,
  CAPTION_LEADING,
  CAPTION_SIZE,
  CELL_LABEL_GAP,
  CELL_LABEL_LEADING,
  CELL_LABEL_SIZE,
  CELL_PADDING,
  CHECKBOX_LABEL_INSET,
  COMB_HEIGHT,
  combBoxes,
  combWidth,
  drawingRoom,
  drawnBoxNote,
  FIELD_GAP_BELOW,
  FIELD_RULE_WIDTH,
  formatFieldValue,
  GRID_HEADER,
  GRID_ROW_PADDING,
  GRID_STATEMENT_GAP,
  gridChoice,
  gridOptionWidth,
  isChoiceList,
  isFieldChecked,
  isStyledField,
  LINE_LABEL_GAP,
  LINE_LABEL_SHARE,
  normalizeDrawingDataUrl,
  packRadioOptions,
  RADIO_ACROSS_GAP,
  RULED_LINE_PITCH,
  TABLE_CELL_PADDING,
  TABLE_ROW_LEAST,
  tickedOptions,
  type StyledFieldBlock
} from "../document-pdf/shared"
import type { PdfBlockFlowItem, PdfFieldBlock } from "../document-pdf/types"
import {
  cell,
  EDGE,
  FAINT_EDGE,
  INK,
  MUTED,
  para,
  picture,
  row,
  spacer,
  tab,
  table,
  wholeArea,
  words,
  type DocxArea,
  type DocxBlock,
  type DocxContext,
  type Edge
} from "./docx-parts"

const EDGE_LINE: Edge = { color: EDGE, size: FIELD_RULE_WIDTH }

/** A field's help under it, then the space under the field; or the space alone. */
export function gapAfter(ctx: DocxContext, area: DocxArea, help: string | null | undefined, gap = FIELD_GAP_BELOW): Paragraph[] {
  return help
    ? [para(ctx, words(ctx, help, { color: MUTED, size: 7 }), { after: gap - 3 + ctx.extra, area, before: 3, leading: 10 })]
    : [spacer(ctx, gap + ctx.extra)]
}

function helpOf(item: PdfBlockFlowItem): string | null {
  const block = item.block as PdfFieldBlock

  return item.fieldContinued ? null : block.helpText
}

// Bold 9 on 13, 3 over what it labels.
function labelParagraph(ctx: DocxContext, item: PdfBlockFlowItem, area: DocxArea): Paragraph {
  return para(ctx, words(ctx, fieldLabel(item), { bold: true, size: 9 }), { after: 3, area, leading: 13 })
}

/**
 * The room a typed answer has after its prefix and before its suffix, as the
 * PDF measures it: never under 30% of the width.
 */
function answerRoom(block: TemplateBlock, width: number): { after: number; before: number; width: number } {
  const face = measuringFace(false)
  const room = (text: string | undefined): number => (text ? face.widthOfTextAtSize(text, 10) + AFFIX_GAP : 0)
  const before = block.type === "text_field" ? room(block.prefix) : 0
  const after = block.type === "text_field" ? room(block.suffix) : 0

  return { after, before, width: Math.max(width * 0.3, width - before - after) }
}

// What a field prints as its answer: a signature's drawing or note, or the answer given.
function styledAnswer(ctx: DocxContext, item: PdfBlockFlowItem, block: PdfFieldBlock): { answer: string; drawing: string | null } {
  if (block.type === "signature_field" || block.type === "initials_field") {
    const drawing = normalizeDrawingDataUrl(ctx.answers[block.fieldKey])

    return { answer: drawing ? "" : drawnBoxNote(block, ctx.signers), drawing }
  }

  return { answer: item.answerOverride ?? formatFieldValue(block, ctx.answers[block.fieldKey]), drawing: null }
}

/**
 * An answer in its room, then any space under it: any prefix in muted words
 * at the start, the answer where the prefix leaves off, any suffix at the
 * end, each in a cell of its own so every viewer puts them where the PDF does.
 */
function answerBlocks(ctx: DocxContext, block: TemplateBlock, answer: string, area: DocxArea, after = 0): DocxBlock[] {
  const prefix = block.type === "text_field" ? block.prefix : undefined
  const suffix = block.type === "text_field" ? block.suffix : undefined
  const text = (value: string, width: number, align: "left" | "right" = "left", color = INK): Paragraph =>
    para(ctx, words(ctx, value, { color, size: 10 }), { after: prefix || suffix ? 0 : after, align, area: wholeArea(width), leading: 15 })

  if (!prefix && !suffix) {
    return [text(answer, area.width)]
  }

  const room = answerRoom(block, area.width)
  const before = prefix ? room.before : 0
  const end = suffix ? Math.max(0, area.width - before - room.width) : 0
  const parts = [
    ...(before > 0 ? [{ text: text(prefix ?? "", before, "left", MUTED), width: before }] : []),
    { text: text(answer, room.width), width: room.width },
    ...(end > 0 ? [{ text: text(suffix ?? "", end, "right", MUTED), width: end }] : [])
  ]

  return [table(ctx, [row(ctx, parts.map((part) => cell(ctx, [part.text], { width: part.width })))], parts.map((part) => part.width), area), spacer(ctx, after)]
}

/**
 * A comb: a box a character, 22 points tall, from the start of the answer's
 * room, any prefix and suffix either side.
 */
function combTable(ctx: DocxContext, block: TemplateBlock, answer: string, area: DocxArea): DocxBlock[] {
  const boxes = combBoxes(block, answer)
  const room = answerRoom(block, area.width)
  const box = combWidth(boxes, room.width)
  const letters = Array.from(answer)
  const prefix = block.type === "text_field" ? block.prefix : undefined
  const suffix = block.type === "text_field" ? block.suffix : undefined
  const end = suffix ? Math.max(0, area.width - room.before - box * boxes) : 0
  const affix = (text: string, width: number, align: "left" | "right") => ({
    cell: cell(ctx, [para(ctx, words(ctx, text, { color: MUTED, size: 10 }), { align, area: wholeArea(width), leading: 15 })], { middle: true, width }),
    width
  })
  const parts = [
    ...(prefix && room.before > 0 ? [affix(prefix, room.before, "left")] : []),
    ...Array.from({ length: boxes }, (_value: unknown, index: number) => ({
      cell: cell(ctx, [para(ctx, words(ctx, letters[index] ?? "", { size: 10 }), { align: "center", area: wholeArea(box), leading: 12 })], {
        edges: { bottom: EDGE_LINE, left: EDGE_LINE, right: EDGE_LINE, top: EDGE_LINE },
        middle: true,
        width: box
      }),
      width: box
    })),
    ...(suffix && end > 0 ? [affix(suffix, end, "right")] : [])
  ]

  return [table(ctx, [row(ctx, parts.map((part) => part.cell), COMB_HEIGHT, true)], parts.map((part) => part.width), area)]
}

// A signature's drawing, fitted as the PDF fits it, or its note.
async function drawingOrAnswer(ctx: DocxContext, block: TemplateBlock, shown: { answer: string; drawing: string | null }, area: DocxArea): Promise<DocxBlock[]> {
  if (shown.drawing) {
    const drawn = picture(ctx, await ctx.picture(shown.drawing), Math.min(150, area.width), 45)

    return [para(ctx, [drawn.run], { area, leading: 10 })]
  }

  return answerBlocks(ctx, block, shown.answer, area)
}

/**
 * A field as the PDF draws it in the layout's field style: a box, a line, or a
 * cell; a checkbox, radio buttons and an upload as they always print.
 *
 * @returns The field's paragraphs and tables, with the space under it.
 */
export async function fieldBlocks(ctx: DocxContext, item: PdfBlockFlowItem, area: DocxArea): Promise<DocxBlock[]> {
  const block = item.block as PdfFieldBlock

  if (block.type === "checkbox_field") {
    const mark = isFieldChecked(block, ctx.answers[block.fieldKey]) ? "☒" : "☐"

    return [
      para(ctx, [...words(ctx, mark, { size: 10 }), tab(), ...words(ctx, fieldLabel(item), { size: 10 })], { area, hanging: CHECKBOX_LABEL_INSET, leading: 15 }),
      ...gapAfter(ctx, area, helpOf(item))
    ]
  }

  if (isChoiceList(block)) {
    return choiceList(ctx, item, block, area)
  }

  if (ctx.layout.fieldStyle === "cell" && isStyledField(block)) {
    return cellRow(ctx, [item], [area.width], area, item.joinsNext === true)
  }

  if (ctx.layout.fieldStyle === "line" && isStyledField(block)) {
    return [...(await lineField(ctx, item, block, area)), ...gapAfter(ctx, area, helpOf(item))]
  }

  const shown = styledAnswer(ctx, item, block)

  if (block.type === "text_field" && combBoxes(block, shown.answer)) {
    return [labelParagraph(ctx, item, area), ...combTable(ctx, block, shown.answer, area), ...gapAfter(ctx, area, helpOf(item))]
  }

  const signing = block.type === "signature_field" || block.type === "initials_field"
  const faint: Edge = { color: FAINT_EDGE, size: 0.7 }
  const inner = wholeArea(area.width - ANSWER_BOX_PADDING * 2)
  const box = cell(ctx, await drawingOrAnswer(ctx, block, shown, inner), {
    edges: { bottom: signing ? { color: EDGE, size: 0.7 } : faint, left: faint, right: faint, top: faint },
    pad: { bottom: ANSWER_BOX_PADDING, left: ANSWER_BOX_PADDING, right: ANSWER_BOX_PADDING, top: ANSWER_BOX_PADDING },
    width: area.width
  })

  return [labelParagraph(ctx, item, area), table(ctx, [row(ctx, [box], answerBoxHeight(block))], [area.width], area), ...gapAfter(ctx, area, helpOf(item))]
}

// Radio buttons or checkboxes under their label: one a line, or side by side
// in lines as full as the PDF packs them.
function choiceList(ctx: DocxContext, item: PdfBlockFlowItem, block: Extract<PdfFieldBlock, { type: "dropdown_field" }>, area: DocxArea): DocxBlock[] {
  const value = ctx.answers[block.fieldKey]
  const answer = formatFieldValue(block, value)
  const ticked = tickedOptions(value)
  const mark = (option: string): string => (block.multiple ? (ticked.includes(option) ? "☒" : "☐") : option === answer ? "●" : "○")
  const face = measuringFace(false)
  const measure = (option: string): number => CHECKBOX_LABEL_INSET + face.widthOfTextAtSize(option, 10)
  const lines = block.across ? packRadioOptions(block.options, area.width, measure) : block.options.map((option: string): string[] => [option])

  return [
    labelParagraph(ctx, item, area),
    ...lines.map((line: string[]): Paragraph => {
      const tabs: Array<{ at: number }> = []
      const children: ParagraphChild[] = []
      let x = 0

      line.forEach((option: string, index: number): void => {
        if (index > 0) {
          tabs.push({ at: x })
          children.push(tab())
        }

        tabs.push({ at: x + CHECKBOX_LABEL_INSET })
        children.push(...words(ctx, mark(option), { size: 10 }), tab(), ...words(ctx, option, { size: 10 }))
        x += measure(option) + RADIO_ACROSS_GAP
      })

      return para(ctx, children, { area, hanging: line.length === 1 ? CHECKBOX_LABEL_INSET : undefined, leading: 15, tabs: line.length > 1 ? tabs : undefined })
    }),
    ...gapAfter(ctx, area, helpOf(item))
  ]
}

/**
 * A field on a line: a short answer on a line beside its label (or under a
 * long label), a long one on ruled lines, a signature over a line with its
 * label as a caption beneath.
 */
async function lineField(ctx: DocxContext, item: PdfBlockFlowItem, block: StyledFieldBlock, area: DocxArea): Promise<DocxBlock[]> {
  const label = fieldLabel(item)
  const shown = styledAnswer(ctx, item, block)
  const face = measuringFace(false)

  if (block.type === "signature_field" || block.type === "initials_field") {
    const noteHeight = shown.answer ? wrapPdfText(shown.answer, face, 10, area.width - ANSWER_BOX_PADDING * 2).length * 15 + ANSWER_BOX_PADDING * 2 : 0
    const room = cell(ctx, await drawingOrAnswer(ctx, block, shown, wholeArea(area.width - ANSWER_BOX_PADDING * 2)), {
      edges: { bottom: EDGE_LINE },
      pad: { left: ANSWER_BOX_PADDING, right: ANSWER_BOX_PADDING, top: ANSWER_BOX_PADDING },
      width: area.width
    })

    return [
      table(ctx, [row(ctx, [room], Math.max(drawingRoom(block, Boolean(shown.drawing)), noteHeight))], [area.width], area),
      para(ctx, words(ctx, label, { color: MUTED, size: CAPTION_SIZE }), { area, before: CAPTION_GAP, leading: CAPTION_LEADING })
    ]
  }

  if (block.type === "text_field" && block.multiline) {
    const room = answerRoom(block, area.width)
    const lines = shown.answer ? wrapPdfText(shown.answer, face, 10, room.width) : []
    const count = Math.max(1, Math.round(Math.max(answerBoxHeight(block), lines.length * RULED_LINE_PITCH) / RULED_LINE_PITCH))

    return [
      para(ctx, words(ctx, label, { size: 10 }), { after: 3, area, leading: 15 }),
      ...Array.from({ length: count }, (_value: unknown, index: number): Paragraph =>
        para(ctx, words(ctx, lines[index] ?? "", { size: 10 }), { area: { ...area, left: area.left + room.before, width: room.width }, leading: RULED_LINE_PITCH, rules: { color: FAINT_EDGE, size: FIELD_RULE_WIDTH } })
      )
    ]
  }

  const natural = face.widthOfTextAtSize(label, 10)
  const combed = block.type === "text_field" && combBoxes(block, shown.answer) > 0

  // A label longer than its share stands over a line the width of the column.
  if (natural > area.width * LINE_LABEL_SHARE) {
    return [
      para(ctx, words(ctx, label, { size: 10 }), { area, leading: 15 }),
      ...(combed ? combTable(ctx, block, shown.answer, area) : [ruled(ctx, area, block, shown.answer)])
    ]
  }

  const answerWidth = area.width - natural - LINE_LABEL_GAP
  const answerArea = wholeArea(answerWidth)

  return [
    table(
      ctx,
      [
        row(ctx, [
          cell(ctx, [para(ctx, words(ctx, label, { size: 10 }), { area: wholeArea(natural + LINE_LABEL_GAP), leading: 15 })], { bottom: true, width: natural + LINE_LABEL_GAP }),
          cell(ctx, combed ? combTable(ctx, block, shown.answer, answerArea) : answerBlocks(ctx, block, shown.answer, answerArea), {
            bottom: true,
            edges: combed ? {} : { bottom: EDGE_LINE },
            width: answerWidth
          })
        ])
      ],
      [natural + LINE_LABEL_GAP, answerWidth],
      area
    )
  ]
}

// An answer on its own line: the line under it, the width of the column.
function ruled(ctx: DocxContext, area: DocxArea, block: TemplateBlock, answer: string): DocxBlock {
  return table(ctx, [row(ctx, [cell(ctx, answerBlocks(ctx, block, answer, wholeArea(area.width)), { edges: { bottom: EDGE_LINE }, width: area.width })])], [area.width], area)
}

/**
 * Fields as bordered cells that touch, as on a printed form: a small muted
 * label in each, the answer under it, any help inside; the row as tall as
 * its tallest cell.
 *
 * @param joinsNext - Whether the next row sits on this one with no gap.
 */
export async function cellRow(ctx: DocxContext, items: ReadonlyArray<PdfBlockFlowItem | null>, widths: readonly number[], area: DocxArea, joinsNext: boolean): Promise<DocxBlock[]> {
  const face = measuringFace(false)
  const cells = await Promise.all(
    items.map(async (item: PdfBlockFlowItem | null, column: number): Promise<TableCell> => {
      const width = widths[column] ?? 0

      if (!item) {
        return cell(ctx, [], { width })
      }

      const block = item.block as StyledFieldBlock
      const inner = wholeArea(width - CELL_PADDING * 2)
      const shown = styledAnswer(ctx, item, block)
      const least =
        block.type === "signature_field" || block.type === "initials_field"
          ? drawingRoom(block, Boolean(shown.drawing))
          : block.type === "text_field" && block.multiline
            ? answerBoxHeight(block) - ANSWER_BOX_PADDING * 2
            : 15
      const lines = wrapPdfText(shown.answer, face, 10, answerRoom(block, inner.width).width).length * 15
      const help = helpOf(item)
      const answer = shown.drawing
        ? await drawingOrAnswer(ctx, block, shown, inner)
        : block.type === "text_field" && combBoxes(block, shown.answer)
          ? combTable(ctx, block, shown.answer, inner)
          : answerBlocks(ctx, block, shown.answer, inner, least - lines)

      return cell(
        ctx,
        [
          para(ctx, words(ctx, fieldLabel(item), { color: MUTED, size: CELL_LABEL_SIZE }), { after: CELL_LABEL_GAP, area: inner, leading: CELL_LABEL_LEADING }),
          ...answer,
          ...(help ? [para(ctx, words(ctx, help, { color: MUTED, size: 7 }), { area: inner, leading: 10 })] : [])
        ],
        {
          edges: { bottom: EDGE_LINE, left: EDGE_LINE, right: EDGE_LINE, top: EDGE_LINE },
          pad: { bottom: CELL_PADDING, left: CELL_PADDING, right: CELL_PADDING, top: CELL_PADDING },
          width
        }
      )
    })
  )

  return [table(ctx, [row(ctx, cells)], widths, area), ...(joinsNext ? [] : [spacer(ctx, FIELD_GAP_BELOW + ctx.extra)])]
}

/**
 * A piece of a choice grid or fill-in table: its title and header row unless
 * it goes on under the piece above, then its rows, with the help after the last.
 */
export function rowsFieldBlocks(ctx: DocxContext, item: PdfBlockFlowItem, area: DocxArea): DocxBlock[] {
  const block = item.block as Extract<TemplateBlock, { type: "choice_grid_field" | "table_field" }>
  const head = item.joinsAbove ? [] : [labelParagraph(ctx, item, area)]
  const rows = block.type === "choice_grid_field" ? gridTable(ctx, item, block, area) : fillInTable(ctx, item, block, area)

  return [...head, rows, ...(item.joinsNext ? [] : gapAfter(ctx, area, item.last ? block.helpText : null))]
}

// A grid without upright rules: its choices across the top in small muted
// words, then each statement with a circle under each choice, a rule under every row.
function gridTable(ctx: DocxContext, item: PdfBlockFlowItem, block: Extract<TemplateBlock, { type: "choice_grid_field" }>, area: DocxArea): DocxBlock {
  const optionWidth = gridOptionWidth(block, area.width)
  const statementWidth = area.width - optionWidth * block.options.length
  const widths = [statementWidth, ...block.options.map(() => optionWidth)]
  const under = { bottom: EDGE_LINE }
  const choiceCell = (text: string, look: { color?: typeof MUTED; size: number; leading: number }, pad: number): TableCell =>
    cell(ctx, [para(ctx, words(ctx, text, look), { align: "center", area: wholeArea(optionWidth - 4), leading: look.leading })], { edges: under, middle: true, pad: { bottom: pad, left: 2, right: 2, top: pad }, width: optionWidth })
  const header = item.joinsAbove ? [] : [row(ctx, [cell(ctx, [], { edges: under, width: statementWidth }), ...block.options.map((option: string) => choiceCell(option, { color: MUTED, leading: GRID_HEADER.leading, size: GRID_HEADER.size }, GRID_HEADER.padding))])]
  const statements = (item.rows ?? []).map((statement) => {
    const text = statement.cells[0] ?? ""
    const choice = gridChoice(ctx.answers[block.fieldKey], text)

    return row(ctx, [
      cell(ctx, [para(ctx, words(ctx, text, { size: 10 }), { area: wholeArea(statementWidth - GRID_STATEMENT_GAP), leading: 15 })], {
        edges: under,
        pad: { bottom: GRID_ROW_PADDING, right: GRID_STATEMENT_GAP, top: GRID_ROW_PADDING },
        width: statementWidth
      }),
      ...block.options.map((option: string) => choiceCell(option === choice ? "●" : "○", { leading: 15, size: 10 }, GRID_ROW_PADDING))
    ])
  })

  return table(ctx, [...header, ...statements], widths, area)
}

// A table's ruled rows: its column names in bold on the brand colour lightly, then its rows.
function fillInTable(ctx: DocxContext, item: PdfBlockFlowItem, block: Extract<TemplateBlock, { type: "table_field" }>, area: DocxArea): DocxBlock {
  const brand = hexToPdfColor(ctx.content.branding.primaryColor)
  const width = area.width / block.columns.length
  const { across, down } = TABLE_CELL_PADDING
  const all = { bottom: { color: EDGE, size: 0.7 }, left: { color: EDGE, size: 0.7 }, right: { color: EDGE, size: 0.7 }, top: { color: EDGE, size: 0.7 } }
  const text = (value: string, bold: boolean, leading: number, size: number, look: { fill?: string; pad: number }): TableCell =>
    cell(ctx, [para(ctx, words(ctx, value, { bold, size }), { area: wholeArea(width - across * 2), leading })], { edges: all, fill: look.fill, pad: { bottom: look.pad, left: across, right: across, top: look.pad }, width })
  // The brand colour at 8%, on white.
  const tint = [brand.red, brand.green, brand.blue].map((part: number) => Math.round((0.92 + 0.08 * part) * 255).toString(16).padStart(2, "0")).join("")
  const header = item.joinsAbove ? [] : [row(ctx, block.columns.map((column) => text(column.label, true, 13, 9, { fill: tint, pad: across })))]
  const rows = (item.rows ?? []).map((tableRow) => row(ctx, block.columns.map((_column, index: number) => text(tableRow.cells[index] ?? "", tableRow.index < 0, 15, 10, { pad: down })), TABLE_ROW_LEAST))

  return table(ctx, [...header, ...rows], block.columns.map(() => width), area)
}
