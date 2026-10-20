import {
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  HeightRule,
  ImageRun,
  LineRuleType,
  Paragraph,
  ShadingType,
  Tab,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlign,
  WidthType,
  type IFloating,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild
} from "docx"
import { rgb, type RGB } from "pdf-lib"

import type { TemplateImageAsset, TextRun as TemplateTextRun } from "@/types/template"

import type { PdfLayoutMetrics } from "../document-pdf/layout"
import type { NormalizedPdfInput, PdfTextAlignment } from "../document-pdf/types"

/** The family the PDF prints in, embedded in the file so Word shows the same letters. */
export const DOCX_FONT_FAMILY = "DejaVu Sans"

// The PDF's colours, as its renderer draws them.
export const INK = rgb(0.07, 0.09, 0.13)
export const MUTED = rgb(0.42, 0.45, 0.5)
export const EDGE = rgb(0.61, 0.64, 0.69)
export const FAINT_EDGE = rgb(0.85, 0.83, 0.81)
export const RULE = rgb(0.82, 0.84, 0.87)
export const CARD_EDGE = rgb(0.9, 0.91, 0.93)
export const SUBTLE = rgb(0.29, 0.33, 0.39)

/**
 * PDF points in Word's units, on the paper the page prints on: twentieths of
 * a point for lengths, half points for text, eighths for borders, pixels at
 * 96 dpi for pictures and EMUs for where a floating picture sits.
 *
 * @param scale - Physical points per design point.
 */
export function docxUnits(scale: number) {
  const at = (points: number): number => points * scale

  return {
    eighth: (points: number): number => Math.max(2, Math.round(at(points) * 8)),
    emu: (points: number): number => Math.round(at(points) * 12_700),
    half: (points: number): number => Math.max(1, Math.round(at(points) * 2)),
    pixel: (points: number): number => Math.max(1, Math.round((at(points) * 96) / 72)),
    twip: (points: number): number => Math.max(0, Math.round(at(points) * 20))
  }
}

export type DocxPicture = Readonly<{ data: Buffer; height: number; type: "jpg" | "png"; width: number }>

/** Everything one item needs to print. */
export type DocxContext = Readonly<{
  answers: Record<string, unknown>
  content: NormalizedPdfInput["content"]
  /** Space the layout's density adds under the item, in points; negative takes some away. */
  extra: number
  layout: PdfLayoutMetrics
  picture: (picture: string | { asset?: TemplateImageAsset | null; dataUrl?: string | null }) => Promise<DocxPicture>
  signers: NormalizedPdfInput["signers"]
  u: ReturnType<typeof docxUnits>
  workflowStatus: NormalizedPdfInput["workflowStatus"]
}>

/** What a page holds, top to bottom. */
export type DocxBlock = Paragraph | Table

/** Where an item prints inside its container: its left offset and width, and the container's width, in points. */
export type DocxArea = Readonly<{ full: number; left: number; width: number }>

export function wholeArea(width: number): DocxArea {
  return { full: width, left: 0, width }
}

/** A six-digit hex colour, as Word writes one. */
export function hex(color: RGB | string): string {
  return typeof color === "string" ? color.replace("#", "").toUpperCase() : [color.red, color.green, color.blue].map((part: number) => Math.round(part * 255).toString(16).padStart(2, "0")).join("").toUpperCase()
}

// Characters XML 1.0 cannot carry, and halves of a character missing their other half.
const UNWRITABLE = /[\u0000-\u0008\u000B-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** Text Word can read: anything XML cannot hold dropped. */
export function clean(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(UNWRITABLE, "")
}

export type Look = Readonly<{ bold?: boolean; color?: RGB | string; font?: string; italic?: boolean; size: number }>

/** A chosen family by the name the letters' maker gives it: "open-sans" is Open Sans. */
function familyName(font: string | undefined): string | undefined {
  return font?.split("-").map((part: string) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")
}

/**
 * Words in one look, a line apiece where the text breaks its lines.
 *
 * @returns The runs, with a line break before each line after the first.
 */
export function words(ctx: DocxContext, text: string, look: Look, extra: IRunOptions = {}): TextRun[] {
  return clean(text)
    .split("\n")
    .map(
      (line: string, index: number): TextRun =>
        new TextRun({
          ...extra,
          bold: look.bold,
          break: index > 0 ? 1 : undefined,
          color: hex(look.color ?? INK),
          font: familyName(look.font),
          italics: look.italic,
          size: ctx.u.half(look.size),
          text: line
        })
    )
}

/**
 * Formatted text: each run keeps its face, size and colour, and is underlined,
 * struck through, highlighted or linked as it says.
 *
 * @param base - The block's own look, for runs without one.
 */
export function richWords(ctx: DocxContext, runs: readonly TemplateTextRun[], base: Look): ParagraphChild[] {
  return runs.flatMap((run: TemplateTextRun): ParagraphChild[] => {
    const pieces = words(
      ctx,
      run.text,
      { bold: base.bold || run.bold, color: run.color ?? base.color, font: run.font, italic: run.italic, size: run.size ?? base.size },
      {
        shading: run.highlight ? { color: "auto", fill: hex(run.highlight), type: ShadingType.CLEAR } : undefined,
        strike: run.strike,
        underline: run.underline || run.link ? {} : undefined
      }
    )

    return run.link ? [new ExternalHyperlink({ children: pieces, link: run.link })] : pieces
  })
}

export type Edge = Readonly<{ color: RGB; size: number }>
type Sides = Partial<Record<"bottom" | "left" | "right" | "top", Edge>>

function border(ctx: DocxContext, edge: Edge | undefined) {
  return edge ? { color: hex(edge.color), size: ctx.u.eighth(edge.size), style: BorderStyle.SINGLE } : { color: "auto", size: 0, style: BorderStyle.NONE }
}

const ALIGNMENT = { center: AlignmentType.CENTER, left: AlignmentType.LEFT, right: AlignmentType.RIGHT } as const

export type ParagraphLook = Readonly<{
  after?: number
  align?: PdfTextAlignment
  area: DocxArea
  before?: number
  /** Lines between and under the paragraph, as ruled paper has. */
  rules?: Edge
  /** A line above it, this far over its first line. */
  topRule?: Readonly<{ edge: Edge; space: number }>
  /** Lines at least this tall, as words bigger than the block's own stand taller; otherwise exactly. */
  grow?: boolean
  /** How far the lines after the first are set in past the first. */
  hanging?: number
  leading: number
  /** Tab stops, from the area's left. */
  tabs?: ReadonlyArray<Readonly<{ at: number; right?: boolean }>>
}>

/**
 * A paragraph laid out as the PDF lays out its lines: its line height, the
 * space above and below in points, and set in to its area.
 */
export function para(ctx: DocxContext, children: ParagraphChild[], look: ParagraphLook, options: Partial<IParagraphOptions> = {}): Paragraph {
  const { area } = look
  const { twip } = ctx.u

  return new Paragraph({
    ...options,
    alignment: look.align ? ALIGNMENT[look.align] : undefined,
    border: look.rules
      ? { between: border(ctx, look.rules), bottom: border(ctx, look.rules) }
      : look.topRule
        ? { top: { ...border(ctx, look.topRule.edge), space: Math.min(31, Math.round(look.topRule.space)) } }
        : undefined,
    children,
    indent: { hanging: look.hanging ? twip(look.hanging) : undefined, left: twip(area.left + (look.hanging ?? 0)), right: twip(area.full - area.left - area.width) },
    spacing: {
      after: twip(Math.max(0, look.after ?? 0)),
      before: twip(Math.max(0, look.before ?? 0)),
      line: twip(look.leading),
      // Exactly the PDF's line height, as every viewer then spaces lines alike; a picture's line stands as tall as it.
      lineRule: look.grow || children.some((child) => child instanceof ImageRun) ? LineRuleType.AT_LEAST : LineRuleType.EXACT
    },
    // A hanging line's words start at a tab where the lines under it start.
    tabStops: [...(look.hanging ? [{ at: look.hanging }] : []), ...(look.tabs ?? [])].map((stop) => ({ position: twip(area.left + stop.at), type: "right" in stop && stop.right ? TabStopType.RIGHT : TabStopType.LEFT }))
  })
}

/** A tab, to the next tab stop. */
export function tab(): TextRun {
  return new TextRun({ children: [new Tab()] })
}

/** Empty space this tall; never quite nothing, so two tables either side stay apart. */
export function spacer(ctx: DocxContext, height: number, options: Partial<IParagraphOptions> = {}): Paragraph {
  return para(ctx, [new TextRun({ size: 2, text: "" })], { area: wholeArea(0), leading: Math.max(0.05, height) }, options)
}

export type CellLook = Readonly<{
  edges?: Sides
  fill?: RGB | string
  /** Space inside its edges, in points. */
  pad?: Partial<Record<"bottom" | "left" | "right" | "top", number>>
  middle?: boolean
  bottom?: boolean
  width: number
}>

/** A table cell holding these items; Word wants a cell to end in a paragraph, so one is added after a table. */
export function cell(ctx: DocxContext, children: DocxBlock[], look: CellLook): TableCell {
  const { twip } = ctx.u
  const sides = look.edges ?? {}
  const ends = children.at(-1) instanceof Paragraph ? children : [...children, spacer(ctx, 0.05)]

  return new TableCell({
    borders: { bottom: border(ctx, sides.bottom), left: border(ctx, sides.left), right: border(ctx, sides.right), top: border(ctx, sides.top) },
    children: ends,
    margins: {
      bottom: twip(look.pad?.bottom ?? 0),
      left: twip(look.pad?.left ?? 0),
      marginUnitType: WidthType.DXA,
      right: twip(look.pad?.right ?? 0),
      top: twip(look.pad?.top ?? 0)
    },
    shading: look.fill ? { color: "auto", fill: hex(look.fill), type: ShadingType.CLEAR } : undefined,
    verticalAlign: look.middle ? VerticalAlign.CENTER : look.bottom ? VerticalAlign.BOTTOM : VerticalAlign.TOP,
    width: { size: twip(look.width), type: WidthType.DXA }
  })
}

/** A row of cells, at least (or exactly) this tall, never split across pages. */
export function row(ctx: DocxContext, cells: TableCell[], least = 0, exact = false): TableRow {
  return new TableRow({
    cantSplit: true,
    children: cells,
    height: least > 0 ? { rule: exact ? HeightRule.EXACT : HeightRule.ATLEAST, value: ctx.u.twip(least) } : undefined
  })
}

/** A table of fixed column widths, set in to its area, with no edges but its cells'. */
export function table(ctx: DocxContext, rows: TableRow[], widths: readonly number[], area: DocxArea): Table {
  const { twip } = ctx.u
  const none = border(ctx, undefined)

  return new Table({
    borders: { bottom: none, insideHorizontal: none, insideVertical: none, left: none, right: none, top: none },
    columnWidths: widths.map((width: number) => twip(width)),
    indent: { size: twip(area.left), type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    margins: { bottom: 0, left: 0, marginUnitType: WidthType.DXA, right: 0, top: 0 },
    rows,
    width: { size: twip(widths.reduce((total: number, width: number) => total + width, 0)), type: WidthType.DXA }
  })
}

/**
 * A picture fitted into a box as the PDF fits it, never enlarged; a pixel is a point.
 *
 * @returns The picture and its printed size, in points.
 */
export function picture(ctx: DocxContext, image: DocxPicture, maximumWidth: number, maximumHeight: number, floating?: (size: { height: number; width: number }) => IFloating): { height: number; run: ImageRun; width: number } {
  const scale = Math.min(maximumWidth / image.width, maximumHeight / image.height, 1)
  const size = { height: image.height * scale, width: image.width * scale }

  return {
    ...size,
    run: new ImageRun({
      data: image.data,
      floating: floating?.(size),
      transformation: { height: ctx.u.pixel(size.height), width: ctx.u.pixel(size.width) },
      type: image.type
    })
  }
}
