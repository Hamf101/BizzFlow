import * as z from "zod"

import {
  answerBoxHeight,
  BOX_HEIGHT_POINTS,
  fitRuns,
  isPinnedBlock,
  MAX_LIST_ITEMS,
  MAX_ROW_COLUMNS,
  MAX_TABLE_ROWS,
  MAX_TEMPLATE_BLOCK_COUNT,
  ruleHasEffect,
} from "@/types/template-limits"

export {
  answerBoxHeight,
  BOX_HEIGHT_POINTS,
  fitRuns,
  isPinnedBlock,
  MAX_LIST_ITEMS,
  MAX_ROW_COLUMNS,
  MAX_TABLE_ROWS,
  MAX_TEMPLATE_BLOCK_COUNT,
  ruleHasEffect,
}

import {
  DATE_MONTH_STYLES,
  DATE_ORDERS,
  DATE_SEPARATORS,
  type DateFormat
} from "@/lib/date-format"
import type { DocumentLifecycleState } from "@/types/document"
import { MAX_SIGNING_RECIPIENTS } from "@/types/box-signers"
import { IMAGE_DATA_URL_PATTERN, MAX_IMAGE_DATA_URL_LENGTH } from "@/types/template-limits"
import { formulaProblem, MAX_FORMULA_LENGTH } from "@/types/template-formula"
import { MARGIN_SIZES } from "@/types/template-margins"
import { visibilityConditions } from "@/types/template-visibility"

/** Maximum serialized size accepted for one complete guided document layout. */
export const MAX_TEMPLATE_CONTENT_JSON_LENGTH = 8_000_000

const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/

const blockIdSchema = z.string().uuid()
const shortTextSchema = z.string().trim().max(240)
const richTextSchema = z.string().trim().max(20_000)
const fieldKeySchema = z.string().trim().regex(FIELD_KEY_PATTERN)
const imageDataUrlSchema = z
  .string()
  .max(MAX_IMAGE_DATA_URL_LENGTH)
  .regex(IMAGE_DATA_URL_PATTERN)

/**
 * A picture kept in the workspace's private file store instead of inside the
 * document: its id, and the original's format and size in pixels. Pages show
 * a lighter copy and PDFs print a print-sized one; the original stays as
 * uploaded, for download.
 */
export const templateImageAssetSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(["png", "jpeg"]),
    width: z.number().int().min(1).max(30_000),
    height: z.number().int().min(1).max(30_000),
    // Where the viewer can see it now: signed for each page, never stored.
    url: z.string().url().optional()
  })
  .strict()

/**
 * How a rule tests an earlier answer. "Equals" on several choices means the
 * choice is among those ticked; more and less than read a number field.
 */
export const VISIBILITY_OPERATORS = ["equals", "not_equals", "answered", "not_answered", "greater_than", "less_than"] as const
export type VisibilityOperator = (typeof VISIBILITY_OPERATORS)[number]

/** One test of an earlier answer; answered and not answered take no value. */
export const templateVisibilityConditionSchema = z
  .object({
    sourceBlockId: blockIdSchema,
    operator: z.enum(VISIBILITY_OPERATORS),
    value: z.union([z.boolean(), z.string().trim().max(240)]).optional()
  })
  .strict()

export type TemplateVisibilityCondition = z.infer<typeof templateVisibilityConditionSchema>

/** Most tests one block's rule combines, as form builders allow a handful. */
export const MAX_VISIBILITY_CONDITIONS = 4

/**
 * When a version-three block shows: one test, or two to four combined, all
 * holding or any of them, as form builders store their rules.
 */
export const templateFieldVisibilitySchema = z.union([
  templateVisibilityConditionSchema,
  z
    .object({
      match: z.enum(["all", "any"]),
      conditions: z.array(templateVisibilityConditionSchema).min(2).max(MAX_VISIBILITY_CONDITIONS)
    })
    .strict()
])

export type TemplateVisibility = z.infer<typeof templateFieldVisibilitySchema>

/** A rule's one test, when it has only one. */
export function singleVisibilityCondition(rule: TemplateVisibility | undefined): TemplateVisibilityCondition | undefined {
  return rule !== undefined && "operator" in rule ? rule : undefined
}

/** A rule from its tests: none is no rule, one stands alone. */
export function visibilityRule(
  match: "all" | "any",
  conditions: readonly TemplateVisibilityCondition[]
): TemplateVisibility | undefined {
  return conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : { match, conditions: [...conditions] }
}

// Lives with the evaluator, so a page that only runs rules never loads these schemas.
export { visibilityConditions }

const visibleWhenShape = { visibleWhen: templateFieldVisibilitySchema.optional() } as const

/** Long enough for a declaration read out in full beside its tick box. */
export const MAX_FIELD_LABEL_LENGTH = 300

const fieldBlockShape = {
  id: blockIdSchema,
  fieldKey: fieldKeySchema,
  label: z.string().trim().min(1).max(MAX_FIELD_LABEL_LENGTH),
  required: z.boolean().default(false),
  helpText: z.string().trim().max(500).nullable().default(null),
  ...visibleWhenShape
} as const

const boxHeightSchema = z.number().min(BOX_HEIGHT_POINTS.min).max(BOX_HEIGHT_POINTS.max).optional()

// A link opens a web page or writes an email, never runs anything.
const LINK_PATTERN = /^(?:https?:\/\/|mailto:)\S+$/i

/**
 * A stretch of text and how it looks: the marks the toolbar puts on it. A mark
 * that is off is left out, so plain text carries none.
 */
export const textRunSchema = z
  .object({
    text: z.string().min(1).max(20_000),
    // A family from the font catalog, by its Fontsource name, such as "open-sans".
    font: z.string().max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    bold: z.literal(true).optional(),
    italic: z.literal(true).optional(),
    underline: z.literal(true).optional(),
    strike: z.literal(true).optional(),
    color: z.string().regex(HEX_COLOR_PATTERN).optional(),
    highlight: z.string().regex(HEX_COLOR_PATTERN).optional(),
    // Points, as a printed page measures type.
    size: z.number().min(6).max(96).optional(),
    link: z.string().max(2_000).regex(LINK_PATTERN).optional()
  })
  .strict()

export type TextRun = z.infer<typeof textRunSchema>

const textRunsSchema = z.array(textRunSchema).max(2_000)

function withRuns<Block extends { runs?: TextRun[]; text: string }>(block: Block): Block {
  const { runs, ...rest } = block
  const fitted = fitRuns(block.text, runs)

  return (fitted ? { ...rest, runs: fitted } : rest) as Block
}

function withItemRuns<Block extends { itemRuns?: Array<TextRun[] | null>; items: string[]; levels?: number[] }>(block: Block): Block {
  const { itemRuns, levels, ...rest } = block
  const fitted = itemRuns?.length === block.items.length
    ? itemRuns.map((runs, index: number) => fitRuns(block.items[index] ?? "", runs) ?? null)
    : []
  const nested = fitLevels(block.items.length, levels)

  return { ...rest, ...(fitted.some(Boolean) ? { itemRuns: fitted } : {}), ...(nested ? { levels: nested } : {}) } as Block
}

/** How deep a list item can sit: 0 at the top, then (a), then (i). */
export const MAX_LIST_LEVEL = 2

/**
 * A list's levels, one an item, each at most one deeper than the item above
 * it and the first at the top; none when every item is at the top.
 *
 * @param count - How many items the list has.
 * @param levels - The levels as given, if any.
 * @returns The levels that hold, or undefined for a flat list.
 */
export function fitLevels(count: number, levels: readonly number[] | undefined): number[] | undefined {
  if (!levels?.some((level) => level > 0)) {
    return undefined
  }

  const fitted: number[] = []

  for (let index = 0; index < count; index += 1) {
    fitted.push(Math.max(0, Math.min(levels[index] ?? 0, index === 0 ? 0 : fitted[index - 1]! + 1, MAX_LIST_LEVEL)))
  }

  return fitted.some((level) => level > 0) ? fitted : undefined
}

// The block shapes as plain objects, for building other shapes from; the
// schemas below also keep each block's formatting in step with its text.
export const headingBlockObjectSchema = z
  .object({
    id: blockIdSchema,
    type: z.literal("heading"),
    text: z.string().trim().min(1).max(500),
    runs: textRunsSchema.optional(),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
    alignment: z.enum(["left", "center", "right"]).default("left"),
    ...visibleWhenShape
  })
  .strict()

export const paragraphBlockObjectSchema = z
  .object({
    id: blockIdSchema,
    type: z.literal("paragraph"),
    text: richTextSchema,
    runs: textRunsSchema.optional(),
    alignment: z.enum(["left", "center", "right"]).default("left"),
    ...visibleWhenShape
  })
  .strict()

const listItemsShape = {
  id: blockIdSchema,
  items: z.array(z.string().trim().min(1).max(2_000)).min(1).max(MAX_LIST_ITEMS),
  // Each item's formatting, beside it; null for a plain item.
  itemRuns: z.array(textRunsSchema.nullable()).max(MAX_LIST_ITEMS).optional(),
  // How far each item is set in: 0 at the top, 1 under it, 2 below that.
  levels: z.array(z.number().int().min(0).max(MAX_LIST_LEVEL)).max(MAX_LIST_ITEMS).optional(),
  ...visibleWhenShape
} as const

export const bulletListBlockObjectSchema = z
  .object({ ...listItemsShape, type: z.literal("bullet_list") })
  .strict()

export const numberedListBlockObjectSchema = z
  .object({ ...listItemsShape, type: z.literal("numbered_list") })
  .strict()

/** Heading block in the ordered document flow. */
export const headingBlockSchema = headingBlockObjectSchema.transform(withRuns)

/** Paragraph block in the ordered document flow. */
export const paragraphBlockSchema = paragraphBlockObjectSchema.transform(withRuns)

/** Bulleted list block in the ordered document flow. */
export const bulletListBlockSchema = bulletListBlockObjectSchema.transform(withItemRuns)

/** Numbered list block in the ordered document flow. */
export const numberedListBlockSchema = numberedListBlockObjectSchema.transform(withItemRuns)

/** Image block: a stored picture, or one embedded before pictures were stored. */
export const imageBlockSchema = z
  .object({
    id: blockIdSchema,
    type: z.literal("image"),
    asset: templateImageAssetSchema.optional(),
    dataUrl: imageDataUrlSchema.optional(),
    altText: z.string().trim().min(1).max(500),
    caption: z.string().trim().max(500).nullable().default(null),
    alignment: z.enum(["left", "center", "right"]).default("center"),
    // Placed on a page in front of the text rather than in it: the page, and
    // the box the picture fills there, in percentages of the page.
    placement: z
      .object({
        page: z.number().int().min(1).max(100),
        x: z.number().min(0).max(99),
        y: z.number().min(0).max(99),
        width: z.number().min(1).max(100),
        height: z.number().min(1).max(100),
      })
      .strict()
      .refine((box) => box.x + box.width <= 100.001 && box.y + box.height <= 100.001, "Image must fit inside its page.")
      .optional(),
    widthPercent: z.number().int().min(10).max(100).default(100),
    ...visibleWhenShape
  })
  .strict()

/** Simple printable table block. */
export const tableBlockSchema = z
  .object({
    id: blockIdSchema,
    type: z.literal("table"),
    headers: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
    rows: z.array(z.array(z.string().trim().max(2_000)).min(1).max(12)).max(MAX_TABLE_ROWS),
    ...visibleWhenShape
  })
  .strict()

/** Horizontal divider block. */
export const dividerBlockSchema = z
  .object({
    id: blockIdSchema,
    type: z.literal("divider")
  })
  .strict()

const formulaSchema = z.string().trim().min(1).max(MAX_FORMULA_LENGTH)
const isNumeric = ({ format }: { format?: string }): boolean => format === "number" || format === "money"

/** What a typed answer holds; absent, any text. Each checks what is written and suits a phone's keyboard. */
export const TEXT_FORMATS = ["number", "money", "email", "phone", "time", "month"] as const

/** Single-line or multiline text input block, as a plain object to build other shapes from. */
export const textFieldBlockObjectSchema = z
  .object({
    ...fieldBlockShape,
    boxHeight: boxHeightSchema,
    type: z.literal("text_field"),
    placeholder: shortTextSchema.nullable().default(null),
    multiline: z.boolean().default(false),
    format: z.enum(TEXT_FORMATS).optional(),
    // Printed before and after the answer, outside it: "£", "kg", "per month".
    prefix: z.string().trim().min(1).max(12).optional(),
    suffix: z.string().trim().min(1).max(24).optional(),
    // One box a character, as a reference or account number is printed.
    comb: z.number().int().min(2).max(40).optional(),
    // A number or amount worked out from earlier answers, as a spreadsheet's
    // cell is: "{Qty} * {Unit price}". It is never typed in.
    formula: formulaSchema.optional()
  })
  .strict()

/** Single-line or multiline text input block. */
export const textFieldBlockSchema = textFieldBlockObjectSchema
  .refine((block) => !(block.comb && block.multiline), { message: "Comb boxes hold one line.", path: ["comb"] })
  .refine((block) => !block.formula || (isNumeric(block) && !block.multiline && !block.comb), {
    message: "Only a number or amount on one line is worked out by a formula.",
    path: ["formula"]
  })

/** How a date is written, built from three choices the author makes. */
export const dateFormatSchema = z
  .object({
    order: z.enum(DATE_ORDERS),
    separator: z.enum(DATE_SEPARATORS),
    month: z.enum(DATE_MONTH_STYLES)
  })
  .strict() satisfies z.ZodType<DateFormat>

/** Date input block. */
export const dateFieldBlockSchema = z
  .object({
    ...fieldBlockShape,
    boxHeight: boxHeightSchema,
    type: z.literal("date_field"),
    dateFormat: dateFormatSchema.optional()
  })
  .strict()

/** Boolean acknowledgement input block. */
export const checkboxFieldBlockSchema = z
  .object({
    ...fieldBlockShape,
    type: z.literal("checkbox_field"),
    checkedByDefault: z.boolean().default(false)
  })
  .strict()

/** Select input block with a bounded set of choices. */
export const dropdownFieldBlockSchema = z
  .object({
    ...fieldBlockShape,
    boxHeight: boxHeightSchema,
    type: z.literal("dropdown_field"),
    placeholder: shortTextSchema.nullable().default(null),
    options: z.array(z.string().trim().min(1).max(240)).max(100),
    // Every option on show, one tick apiece; absent, a dropdown. The answer is the same.
    display: z.literal("radios").optional(),
    // Radio buttons set side by side along a line, wrapping; absent, one a line.
    across: z.literal(true).optional(),
    // Any number of the choices, each ticked; the answer is the list ticked.
    multiple: z.literal(true).optional()
  })
  .strict()

// Words that name an answer are told apart as a person reads them.
const distinctWords = (words: readonly string[]): boolean =>
  new Set(words.map((word: string): string => word.trim().toLowerCase())).size === words.length

/**
 * Statements against shared choices, one choice a row: a rating scale, or
 * Yes, No and N/A down a checklist. The answer names each row's choice.
 */
export const choiceGridFieldBlockSchema = z
  .object({
    ...fieldBlockShape,
    type: z.literal("choice_grid_field"),
    rows: z.array(z.string().trim().min(1).max(240)).min(1).max(40).refine(distinctWords, "Each row is said once."),
    options: z.array(z.string().trim().min(1).max(60)).min(2).max(10).refine(distinctWords, "Each choice is said once.")
  })
  .strict()

/** What a table column holds; absent, any text. */
export const TABLE_COLUMN_FORMATS = ["number", "money", "date", "time"] as const

/**
 * A table filled in row by row: a log, a timesheet, an inventory. It shows
 * its rows blank, and a person on a screen may add more where allowed.
 */
export const tableFieldBlockSchema = z
  .object({
    ...fieldBlockShape,
    type: z.literal("table_field"),
    columns: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(60),
            format: z.enum(TABLE_COLUMN_FORMATS).optional(),
            // Worked out on each row from the columns to its left.
            formula: formulaSchema.optional(),
            // Added up on a Total row under the table.
            total: z.literal(true).optional()
          })
          .strict()
          .refine((column) => (!column.formula && !column.total) || isNumeric(column), "Only a number or amount column is worked out or totalled.")
      )
      .min(1)
      .max(8)
      .refine((columns) => distinctWords(columns.map((column) => column.label)), "Each column is named once."),
    rows: z.number().int().min(1).max(50),
    addRows: z.literal(true).optional()
  })
  .strict()

export { MAX_TABLE_FIELD_ROWS } from "@/types/template-answer-kinds"

// Who signs a drawn box: the sender, before sending, or the signer at that
// place in the order they were added. Missing means Signer 1, never the sender.
const boxSignerSchema = z
  .union([z.literal("sender"), z.number().int().min(1).max(MAX_SIGNING_RECIPIENTS)])
  .optional()

/** Drawn initials input block. */
export const initialsFieldBlockSchema = z
  .object({
    ...fieldBlockShape,
    boxHeight: boxHeightSchema,
    signer: boxSignerSchema,
    type: z.literal("initials_field")
  })
  .strict()

/** Drawn signature input block for the MVP acknowledgement workflow. */
export const signatureFieldBlockSchema = z
  .object({
    ...fieldBlockShape,
    boxHeight: boxHeightSchema,
    signer: boxSignerSchema,
    type: z.literal("signature_field")
  })
  .strict()

/** Single-file upload block reserved for internal submission workflows. */
export const fileFieldBlockSchema = z
  .object({
    ...fieldBlockShape,
    type: z.literal("file_field")
  })
  .strict()

/** Canonical union of every supported guided document block. */
export const templateBlockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  paragraphBlockSchema,
  bulletListBlockSchema,
  numberedListBlockSchema,
  imageBlockSchema,
  tableBlockSchema,
  dividerBlockSchema,
  textFieldBlockSchema,
  dateFieldBlockSchema,
  checkboxFieldBlockSchema,
  dropdownFieldBlockSchema,
  choiceGridFieldBlockSchema,
  tableFieldBlockSchema,
  initialsFieldBlockSchema,
  signatureFieldBlockSchema,
  fileFieldBlockSchema
])

/** Organization-controlled visual choices stored with each document snapshot. */
export const templateBrandingSchema = z
  .object({
    organizationName: z.string().trim().max(160).default(""),
    logoAsset: templateImageAssetSchema.nullable().default(null),
    logoDataUrl: imageDataUrlSchema.nullable().default(null),
    logoAlignment: z.enum(["left", "center", "right"]).default("left"),
    logoWidthPercent: z.number().int().min(10).max(60).default(24),
    primaryColor: z.string().regex(HEX_COLOR_PATTERN).default("#252329"),
    accentColor: z.string().regex(HEX_COLOR_PATTERN).default("#635273")
  })
  .strict()

const templateBlocksSchema = z
  .array(templateBlockSchema)
  .max(MAX_TEMPLATE_BLOCK_COUNT, {
    error: `Template content cannot contain more than ${MAX_TEMPLATE_BLOCK_COUNT} blocks.`
  })
  .default([])

const templateBrandingDefault = {
  organizationName: "",
  logoAsset: null,
  logoDataUrl: null,
  logoAlignment: "left",
  logoWidthPercent: 24,
  primaryColor: "#252329",
  accentColor: "#635273"
} as const

// Words for the left, centre and right of a page's top or bottom margin.
const marginTextSchema = z
  .object({
    left: z.string().trim().max(120).optional(),
    center: z.string().trim().max(120).optional(),
    right: z.string().trim().max(120).optional()
  })
  .strict()

export { MARGIN_SIZES, type MarginSize } from "@/types/template-margins"

/** Page and repeated-element controls captured in version-three snapshots. */
export const templateLayoutSchema = z
  .object({
    pageSize: z.enum(["A3", "A4", "A5", "Letter", "Legal"]).default("A4"),
    orientation: z.enum(["portrait", "landscape"]).default("portrait"),
    // Each side's margin in points, when set side by side rather than by preset.
    margins: z
      .object({
        top: z.number().min(0).max(144),
        right: z.number().min(0).max(144),
        bottom: z.number().min(0).max(144),
        left: z.number().min(0).max(144),
      })
      .strict()
      .optional(),
    // Line height as a multiple of the text size, and the space between paragraphs in points.
    lineSpacing: z.number().min(1).max(3).optional(),
    paragraphSpacing: z.number().min(0).max(48).optional(),
    marginPreset: z
      .enum(["standard", "compact", "generous"])
      .default("standard"),
    density: z
      .enum(["balanced", "compact", "comfortable"])
      .default("balanced"),
    /**
     * How answers are drawn: a box under the label; a line beside the label,
     * ruled lines for a long answer and a caption under a signature; or a
     * bordered cell with a small label in its corner, touching the cells
     * beside and below it, as on a printed government form. Absent, a box.
     */
    fieldStyle: z.enum(["box", "line", "cell"]).optional(),
    /**
     * How a section's title prints: as a heading (absent), in a filled bar
     * of the primary colour, or as the top of a bordered box that holds the
     * section, carried over pages.
     */
    sectionStyle: z.enum(["plain", "band", "box"]).optional(),
    // Titled sections numbered in order: A, B, C or 1, 2, 3, or as clauses,
    // 1, 2, 3 with each section's numbered lists going on 3.1, 3.2. Absent, none.
    sectionNumbers: z.enum(["letters", "numbers", "clauses"]).optional(),
    /**
     * Words in the top and bottom margins, left, centre and right, such as a
     * form's number and revision. {page}, {pages} and {title} are filled in
     * on each page. The header's show on the pages the header policy says,
     * the footer's on the pages the footer policy says.
     */
    headerText: marginTextSchema.optional(),
    footerText: marginTextSchema.optional(),
    printedTitle: z
      .discriminatedUnion("mode", [
        z.object({ mode: z.literal("linked") }).strict(),
        z
          .object({
            mode: z.literal("custom"),
            text: z.string().trim().min(1).max(500)
          })
          .strict(),
        z.object({ mode: z.literal("none") }).strict()
      ])
      .default({ mode: "linked" }),
    headerPolicy: z
      .enum(["first_page", "all_pages", "none"])
      .default("first_page"),
    footerPolicy: z
      .enum(["first_page", "all_pages", "none"])
      .default("all_pages"),
    pageNumbering: z.enum(["none", "page_x_of_y"]).default("page_x_of_y"),
    /**
     * Physical points per design point. Content is laid out on the page it was
     * designed on and printed at this scale, so moving to bigger or smaller
     * paper keeps every line and page break where it was. Absent means 1.
     */
    contentScale: z.number().min(0.25).max(4).optional()
  })
  .strict()

/** One section boundary in the canonical root block order. */
export const templateSectionSchema = z
  .object({
    id: blockIdSchema,
    label: z.string().trim().min(1).max(160),
    startBlockId: blockIdSchema,
    pageBreakBefore: z.boolean(),
    keepTogether: z.boolean()
  })
  .strict()

/**
 * One contiguous range of blocks set side by side: a row of up to four
 * columns, sized in twelfths of the page's width (equal when `widths` is
 * absent). A range with more blocks than columns wraps onto further rows.
 */
export const templateFieldGroupSchema = z
  .object({
    id: blockIdSchema,
    label: z.string().trim().min(1).max(160).nullable().default(null),
    startBlockId: blockIdSchema,
    endBlockId: blockIdSchema,
    columns: z.number().int().min(1).max(MAX_ROW_COLUMNS),
    widths: z.array(z.number().int().min(2).max(10)).min(2).max(MAX_ROW_COLUMNS).optional(),
    keepTogether: z.boolean()
  })
  .strict()

/**
 * Where a block on a line of its own sits across the page: its left edge and
 * width, in percentages of the space between the margins.
 */
export const blockFrameSchema = z
  .object({
    left: z.number().min(0).max(95),
    width: z.number().min(5).max(100),
  })
  .strict()
  .refine((frame) => frame.left + frame.width <= 100.001, "A block must fit between the margins.")

/** Where a block sits across the page. */
export type BlockFrame = z.infer<typeof blockFrameSchema>

/**
 * How one canonical block is laid out: whether it starts a page or stays with
 * the next, the space above it in points, and where it sits across the page.
 */
export const templateBlockRuleSchema = z
  .object({
    blockId: blockIdSchema,
    pageBreakBefore: z.boolean(),
    keepWithNext: z.boolean(),
    spaceAbove: z.number().min(0).max(600).optional(),
    frame: blockFrameSchema.optional()
  })
  .strict()
  .refine(ruleHasEffect, "A block rule must change how its block is laid out.")

/** Read-compatible version-two template content retained for immutable snapshots. */
export const templateContentV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    branding: templateBrandingSchema.default(templateBrandingDefault),
    blocks: templateBlocksSchema
  })
  .strict()
  .superRefine((content, context): void => {
    validateCanonicalBlocks(content, context)

    for (const [blockIndex, block] of content.blocks.entries()) {
      if ("visibleWhen" in block && block.visibleWhen !== undefined) {
        context.addIssue({
          code: "custom",
          message:
            "Conditional field visibility requires template schema version three.",
          path: ["blocks", blockIndex, "visibleWhen"]
        })
      }
    }
  })

/** Editable version-three template content with layout and structure metadata. */
export const templateContentV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    branding: templateBrandingSchema.default(templateBrandingDefault),
    blocks: templateBlocksSchema,
    layout: templateLayoutSchema.default({
      pageSize: "A4",
      orientation: "portrait",
      marginPreset: "standard",
      density: "balanced",
      printedTitle: { mode: "linked" },
      headerPolicy: "first_page",
      footerPolicy: "all_pages",
      pageNumbering: "page_x_of_y"
    }),
    sections: z.array(templateSectionSchema).max(MAX_TEMPLATE_BLOCK_COUNT),
    fieldGroups: z.array(templateFieldGroupSchema).max(MAX_TEMPLATE_BLOCK_COUNT),
    blockRules: z.array(templateBlockRuleSchema).max(MAX_TEMPLATE_BLOCK_COUNT)
  })
  .strict()
  .superRefine((content, context): void => {
    validateCanonicalBlocks(content, context)
    validateVersionThreeStructure(content, context)
  })

/** Canonical dual-read schema for editable content and immutable snapshots. */
export const templateContentSchema = z.union([
  templateContentV2Schema,
  templateContentV3Schema
])

export type HeadingBlock = z.infer<typeof headingBlockSchema>
export type ParagraphBlock = z.infer<typeof paragraphBlockSchema>
export type DropdownFieldBlock = z.infer<typeof dropdownFieldBlockSchema>
export type ChoiceGridFieldBlock = z.infer<typeof choiceGridFieldBlockSchema>
export type TableFieldBlock = z.infer<typeof tableFieldBlockSchema>
export type TextFieldBlock = z.infer<typeof textFieldBlockSchema>
export type TemplateBlock = z.infer<typeof templateBlockSchema>
export type TemplateBranding = z.infer<typeof templateBrandingSchema>
export type TemplateImageAsset = z.infer<typeof templateImageAssetSchema>
export type TemplateLayout = z.infer<typeof templateLayoutSchema>
export type TemplateSection = z.infer<typeof templateSectionSchema>
export type TemplateFieldGroup = z.infer<typeof templateFieldGroupSchema>
export type TemplateContentV2 = z.infer<typeof templateContentV2Schema>
export type TemplateContentV3 = z.infer<typeof templateContentV3Schema>
export type TemplateContent = z.infer<typeof templateContentSchema>

function validateCanonicalBlocks(
  content: { blocks: readonly TemplateBlock[] },
  context: z.RefinementCtx
): void {
  if (JSON.stringify(content).length > MAX_TEMPLATE_CONTENT_JSON_LENGTH) {
    context.addIssue({
      code: "custom",
      message: "Template content is too large."
    })
  }

  const blockIds = new Set<string>()
  const fieldKeys = new Set<string>()

  for (const [blockIndex, block] of content.blocks.entries()) {
    const blockPath = ["blocks", blockIndex]

    if (block.type === "image" && Boolean(block.asset) === Boolean(block.dataUrl)) {
      context.addIssue({
        code: "custom",
        message: "An image block needs exactly one picture.",
        path: blockPath
      })
    }

    if (blockIds.has(block.id)) {
      context.addIssue({
        code: "custom",
        message: "Every document block must have a unique id.",
        path: [...blockPath, "id"]
      })
    }
    blockIds.add(block.id)

    if ("fieldKey" in block) {
      const normalizedFieldKey = block.fieldKey.toLowerCase()

      if (fieldKeys.has(normalizedFieldKey)) {
        context.addIssue({
          code: "custom",
          message: "Every fillable field must have a unique field key.",
          path: [...blockPath, "fieldKey"]
        })
      }
      fieldKeys.add(normalizedFieldKey)
    }
  }
}

function validateVersionThreeStructure(
  content: TemplateContentV3,
  context: z.RefinementCtx
): void {
  const blockIndexById = new Map(
    content.blocks.map(
      (block: TemplateBlock, index: number): readonly [string, number] => [
        block.id,
        index
      ]
    )
  )
  const sectionStartIndices = validateSections(
    content,
    blockIndexById,
    context
  )

  validateFieldGroups(content, blockIndexById, sectionStartIndices, context)
  validateBlockRules(content, blockIndexById, context)
  validateFieldVisibility(content, blockIndexById, context)
  validateFormulas(content, context)
}

function validateFormulas(content: TemplateContentV3, context: z.RefinementCtx): void {
  for (const [index, block] of content.blocks.entries()) {
    const formulas: Array<[string | undefined, (string | number)[], number | undefined]> =
      block.type === "text_field"
        ? [[block.formula, ["formula"], undefined]]
        : block.type === "table_field"
          ? block.columns.map((column, at) => [column.formula, ["columns", at, "formula"], at])
          : []

    for (const [formula, path, column] of formulas) {
      const problem = formula === undefined ? null : formulaProblem(content.blocks, index, formula, column)

      if (problem !== null) {
        context.addIssue({ code: "custom", message: problem, path: ["blocks", index, ...path] })
      }
    }
  }
}

function validateSections(
  content: TemplateContentV3,
  blockIndexById: ReadonlyMap<string, number>,
  context: z.RefinementCtx
): number[] {
  if (content.blocks.length === 0) {
    if (content.sections.length > 0) {
      context.addIssue({
        code: "custom",
        message: "An empty document cannot contain section boundaries.",
        path: ["sections"]
      })
    }

    return []
  }

  // Sections are optional structure metadata, and the first may start partway
  // down: what comes before it belongs to no section and prints no title.
  if (content.sections.length === 0) {
    return []
  }

  const sectionStartIndices: number[] = []
  const sectionIds = new Set<string>()
  let priorIndex = -1

  for (const [sectionIndex, section] of content.sections.entries()) {
    const blockIndex = blockIndexById.get(section.startBlockId)

    if (sectionIds.has(section.id)) {
      context.addIssue({
        code: "custom",
        message: "Every section must have a unique stable id.",
        path: ["sections", sectionIndex, "id"]
      })
    }
    sectionIds.add(section.id)

    if (blockIndex === undefined) {
      context.addIssue({
        code: "custom",
        message: "Every section must reference an existing document block.",
        path: ["sections", sectionIndex, "startBlockId"]
      })
      continue
    }

    if (blockIndex <= priorIndex) {
      context.addIssue({
        code: "custom",
        message: "Section boundaries must follow canonical block order.",
        path: ["sections", sectionIndex, "startBlockId"]
      })
    }

    sectionStartIndices.push(blockIndex)
    priorIndex = blockIndex
  }

  return sectionStartIndices
}

function validateFieldGroups(
  content: TemplateContentV3,
  blockIndexById: ReadonlyMap<string, number>,
  sectionStartIndices: readonly number[],
  context: z.RefinementCtx
): void {
  const groupIds = new Set<string>()
  let priorEndIndex = -1

  for (const [groupIndex, group] of content.fieldGroups.entries()) {
    const startIndex = blockIndexById.get(group.startBlockId)
    const endIndex = blockIndexById.get(group.endBlockId)

    if (groupIds.has(group.id)) {
      context.addIssue({
        code: "custom",
        message: "Every field group must have a unique stable id.",
        path: ["fieldGroups", groupIndex, "id"]
      })
    }
    groupIds.add(group.id)

    if (startIndex === undefined || endIndex === undefined) {
      context.addIssue({
        code: "custom",
        message: "Every field group range must reference existing blocks.",
        path: ["fieldGroups", groupIndex]
      })
      continue
    }

    if (startIndex > endIndex) {
      context.addIssue({
        code: "custom",
        message: "A field group must follow canonical block order.",
        path: ["fieldGroups", groupIndex]
      })
      continue
    }

    if (startIndex <= priorEndIndex) {
      context.addIssue({
        code: "custom",
        message: "Field groups must be ordered and cannot overlap.",
        path: ["fieldGroups", groupIndex]
      })
    }
    priorEndIndex = Math.max(priorEndIndex, endIndex)

    const startSectionIndex = findSectionIndex(
      sectionStartIndices,
      startIndex
    )
    const endSectionIndex = findSectionIndex(sectionStartIndices, endIndex)

    // Before the first section is -1, so a group may sit there, but no group
    // crosses into a section.
    if (startSectionIndex !== endSectionIndex) {
      context.addIssue({
        code: "custom",
        message: "A field group cannot cross a section boundary.",
        path: ["fieldGroups", groupIndex]
      })
    }

    const groupedBlocks = content.blocks.slice(startIndex, endIndex + 1)

    if (groupedBlocks.some(isPinnedBlock)) {
      context.addIssue({
        code: "custom",
        message: "A block pinned to its page cannot share a row.",
        path: ["fieldGroups", groupIndex]
      })
    }

    if (
      group.widths !== undefined &&
      (group.widths.length !== group.columns ||
        group.widths.reduce((total: number, width: number): number => total + width, 0) !== 12)
    ) {
      context.addIssue({
        code: "custom",
        message: "A row's column widths must fill its twelve twelfths, one width per column.",
        path: ["fieldGroups", groupIndex, "widths"]
      })
    }
  }
}

function validateBlockRules(
  content: TemplateContentV3,
  blockIndexById: ReadonlyMap<string, number>,
  context: z.RefinementCtx
): void {
  const referencedBlockIds = new Set<string>()

  for (const [ruleIndex, rule] of content.blockRules.entries()) {
    if (!blockIndexById.has(rule.blockId)) {
      context.addIssue({
        code: "custom",
        message: "Every block rule must reference an existing block.",
        path: ["blockRules", ruleIndex, "blockId"]
      })
    }

    if (referencedBlockIds.has(rule.blockId)) {
      context.addIssue({
        code: "custom",
        message: "A block can have only one pagination rule.",
        path: ["blockRules", ruleIndex, "blockId"]
      })
    }
    referencedBlockIds.add(rule.blockId)
  }
}

// Answers a rule may test; a drawing, an upload, a grid or a table has no single value to compare.
const VISIBILITY_SOURCE_TYPES: ReadonlySet<string> = new Set(["checkbox_field", "dropdown_field", "text_field", "date_field"])
const VISIBILITY_NUMBER = /^-?\d+(?:\.\d+)?$/

/**
 * Why one test could never be run against its source, or null when it can:
 * the source must be an answer with a value, the comparison must suit it, and
 * the value must be one it can hold.
 */
export function visibilityConditionProblem(source: TemplateBlock | undefined, condition: TemplateVisibilityCondition): string | null {
  const { operator, value } = condition
  const needsValue = operator !== "answered" && operator !== "not_answered"

  if (source === undefined || !VISIBILITY_SOURCE_TYPES.has(source.type)) {
    return "A rule can test only an earlier tick box, choice, typed answer or date."
  }

  if (needsValue !== (value !== undefined)) {
    return needsValue ? "This test needs a value to compare with." : "Answered and not answered compare with no value."
  }

  if (source.type === "checkbox_field") {
    return (operator === "equals" || operator === "not_equals") && typeof value === "boolean"
      ? null
      : "A checkbox visibility condition must compare a boolean."
  }

  if (operator === "greater_than" || operator === "less_than") {
    return source.type === "text_field" && (source.format === "number" || source.format === "money") && typeof value === "string" && VISIBILITY_NUMBER.test(value)
      ? null
      : "More or less than compares a number or money answer with a number."
  }

  if (!needsValue) {
    return null
  }

  if (typeof value !== "string" || value.length === 0) {
    return "Compare with words; a blank answer is tested as not answered."
  }

  return source.type === "dropdown_field" && !source.options.includes(value)
    ? "A dropdown visibility condition must compare a declared option."
    : null
}

function validateFieldVisibility(
  content: TemplateContentV3,
  blockIndexById: ReadonlyMap<string, number>,
  context: z.RefinementCtx
): void {
  const conditionSources = new Map<string, string[]>()

  for (const [targetIndex, targetBlock] of content.blocks.entries()) {
    if (!("visibleWhen" in targetBlock) || targetBlock.visibleWhen === undefined) {
      continue
    }

    const rule = targetBlock.visibleWhen
    const conditions = visibilityConditions(rule)

    conditionSources.set(targetBlock.id, conditions.map((condition) => condition.sourceBlockId))

    for (const [conditionIndex, condition] of conditions.entries()) {
      const conditionPath = ["blocks", targetIndex, "visibleWhen", ...("conditions" in rule ? ["conditions", conditionIndex] : [])]
      const sourceIndex = blockIndexById.get(condition.sourceBlockId)
      const sourceBlock = sourceIndex === undefined ? undefined : content.blocks[sourceIndex]

      if (condition.sourceBlockId === targetBlock.id) {
        context.addIssue({ code: "custom", message: "A field cannot control its own visibility.", path: [...conditionPath, "sourceBlockId"] })
        continue
      }

      if (sourceIndex === undefined || sourceBlock === undefined) {
        context.addIssue({ code: "custom", message: "A visibility condition must reference an existing field.", path: [...conditionPath, "sourceBlockId"] })
        continue
      }

      if (sourceIndex >= targetIndex) {
        context.addIssue({ code: "custom", message: "A visibility source must appear before the conditional field.", path: [...conditionPath, "sourceBlockId"] })
      }

      const problem = visibilityConditionProblem(sourceBlock, condition)

      if (problem !== null) {
        context.addIssue({ code: "custom", message: problem, path: conditionPath })
      }
    }
  }

  // Sources come first, so a cycle also breaks order; this names it plainly.
  for (const [targetBlockId] of conditionSources) {
    const seen = new Set<string>()
    const stack = [...(conditionSources.get(targetBlockId) ?? [])]

    while (stack.length > 0) {
      const cursor = stack.pop() as string

      if (cursor === targetBlockId) {
        const targetIndex = blockIndexById.get(targetBlockId)

        context.addIssue({
          code: "custom",
          message: "Field visibility conditions cannot form cycles.",
          path: targetIndex === undefined ? ["blocks"] : ["blocks", targetIndex, "visibleWhen"]
        })
        break
      }

      if (!seen.has(cursor)) {
        seen.add(cursor)
        stack.push(...(conditionSources.get(cursor) ?? []))
      }
    }
  }
}

function findSectionIndex(
  sectionStartIndices: readonly number[],
  blockIndex: number
): number {
  let result = -1

  for (const [sectionIndex, startIndex] of sectionStartIndices.entries()) {
    if (startIndex > blockIndex) {
      break
    }
    result = sectionIndex
  }

  return result
}

/** Every template lifecycle status. */
export const DOCUMENT_TEMPLATE_STATUSES = ["draft", "published", "archived"] as const
export type DocumentTemplateStatus = (typeof DOCUMENT_TEMPLATE_STATUSES)[number]
export type DocumentSourceKind = "upload" | "generated"
export type GeneratedDocumentWorkflowStatus =
  "draft" | "awaiting_signatures" | "completed"
export type DocumentSigningRecipientStatus = "pending" | "viewed" | "signed"

/** Database row for an organization-owned reusable document template. */
export type DocumentTemplateRow = Record<string, unknown> & {
  id: string
  org_id: string
  title: string
  description: string | null
  category: string | null
  status: DocumentTemplateStatus
  revision: number
  content: TemplateContent
  created_by: string | null
  updated_by: string | null
  published_by: string | null
  archived_by: string | null
  created_at: string
  updated_at: string
  published_at: string | null
  archived_at: string | null
  /** The working copy's revision it was last published at; null until published. */
  published_revision: number | null
  /** When it went to Trash; only document_templates has it, the published view never holds one. */
  trashed_at?: string | null
}

/** One immutable published version of a template. */
export type DocumentTemplateVersionRow = {
  content: TemplateContent
  description: string | null
  org_id: string
  published_at: string
  published_by: string | null
  revision: number
  template_id: string
  title: string
}

/** A published version as the editor's history lists it. */
export type DocumentTemplateVersion = {
  publishedAt: string
  revision: number
}

/** Application-facing reusable document template. */
export type DocumentTemplate = {
  id: string
  organizationId: string
  title: string
  description: string | null
  /** Optional grouping label; null is a legitimate state, not a backfill gap. */
  category: string | null
  status: DocumentTemplateStatus
  revision: number
  content: TemplateContent
  createdBy: string | null
  updatedBy: string | null
  publishedBy: string | null
  archivedBy: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  archivedAt: string | null
  /**
   * The revision last published. Members who use the template get that
   * version; a working copy past it has changes not yet published.
   */
  publishedRevision: number | null
  /** When it was moved to Trash, where it is archived until restored or deleted; null otherwise. */
  trashedAt: string | null
}

/** Database columns the templates list reads. */
export type DocumentTemplateSummaryRow = Pick<
  DocumentTemplateRow,
  "category" | "created_at" | "id" | "org_id" | "revision" | "status" | "title" | "trashed_at" | "updated_at"
>

/** A template as the templates list shows it, without its content. */
export type DocumentTemplateSummary = Pick<
  DocumentTemplate,
  "category" | "createdAt" | "id" | "organizationId" | "revision" | "status" | "title" | "trashedAt" | "updatedAt"
>

/** A template in the library, with the content its card draws its first page from. */
export type DocumentTemplateCard = DocumentTemplateSummary & {
  /** Whether the viewer may edit this template, by their role or because it was shared with them. */
  canEdit: boolean
  /** Large images are left behind; null when the content could not be read. */
  content: TemplateContent | null
}

/** Orders the templates list offers. */
export const TEMPLATE_SORT_KEYS = ["updated", "created", "title"] as const

/** One way to order the templates list. */
export type TemplateSortKey = (typeof TEMPLATE_SORT_KEYS)[number]

/** Longest templates-list search, in characters. */
export const TEMPLATE_SEARCH_MAX_LENGTH = 100

/** Longest category the `document_templates_category_check` constraint accepts. */
export const TEMPLATE_CATEGORY_MAX_LENGTH = 40

/** Database row containing field answers for one generated document. */
export type DocumentAnswerRow = Record<string, unknown> & {
  document_id: string
  org_id: string
  values: Record<string, unknown>
  workflow_status: GeneratedDocumentWorkflowStatus
  created_at: string
  updated_at: string
}

/** Database row for one internal or external document recipient. */
export type DocumentSigningRecipientRow = Record<string, unknown> & {
  id: string
  org_id: string
  document_id: string
  user_id: string | null
  name: string
  email: string
  requires_signature: boolean
  status: DocumentSigningRecipientStatus
  token_hash: string
  token_expires_at: string
  invited_at: string
  viewed_at: string | null
  signed_at: string | null
  signature_data: Record<string, unknown> | null
  initials_data: Record<string, unknown> | null
}

/** Database row tracking the last time a member opened a tenant document. */
export type DocumentRecentAccessRow = Record<string, unknown> & {
  org_id: string
  user_id: string
  document_id: string
  last_opened_at: string
}

/** Generated document metadata with its immutable guided-content snapshot. */
export type GeneratedDocument = {
  id: string
  organizationId: string
  folderId: string | null
  title: string
  description: string | null
  sourceKind: "generated"
  templateId: string | null
  templateRevision: number | null
  templateSnapshot: TemplateContent
  lifecycleState: DocumentLifecycleState
  createdBy: string | null
  updatedBy: string | null
  archivedAt: string | null
  trashedAt: string | null
  purgeAfter: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Parses version-two snapshots or version-three editable template content.
 *
 * Parsing is deliberately read-only with respect to schema versions: a version-two
 * snapshot remains version two until an editable boundary explicitly upgrades it.
 *
 * @param value - Untrusted content received from an editor, AI proposal, or database.
 * @returns Cloned canonical content with its persisted schema version preserved.
 * @throws z.ZodError when the content or any block is invalid.
 */
export function parseTemplateContent(value: unknown): TemplateContent {
  return templateContentSchema.parse(value)
}

/**
 * Upgrades legacy editable content to the version-three structure contract.
 *
 * The operation is idempotent and must be called only when content enters an
 * editable-template boundary. Immutable generated-document and submission
 * snapshots should continue to use `parseTemplateContent`.
 *
 * @param content - Already parsed version-two or version-three content.
 * @returns Version-three content with current layout and structure defaults.
 * @throws z.ZodError when the upgraded structure is invalid.
 */
export function upgradeV2TemplateContentToV3(
  content: TemplateContent
): TemplateContentV3 {
  if (content.schemaVersion === 3) {
    return content
  }

  return templateContentV3Schema.parse({
    schemaVersion: 3,
    branding: content.branding,
    blocks: content.blocks,
    sections:
      content.blocks.length === 0
        ? []
        : [
            {
              id: content.blocks[0]?.id,
              label: "Section 1",
              startBlockId: content.blocks[0]?.id,
              pageBreakBefore: false,
              keepTogether: false
            }
          ],
    fieldGroups: [],
    blockRules: []
  })
}

/**
 * Creates the empty page a new template or document starts from: nothing is
 * printed on it, not even the title, a header, a footer or page numbers, until
 * someone adds them.
 *
 * @returns Fresh version-three content with an empty A4 portrait page.
 */
export function createEmptyDocumentContent(): TemplateContentV3 {
  const content = createBlankTemplateContent()

  return {
    ...content,
    layout: {
      ...content.layout,
      printedTitle: { mode: "none" },
      headerPolicy: "none",
      footerPolicy: "none",
      pageNumbering: "none"
    }
  }
}

/**
 * Creates an empty, schema-valid free-form guided document.
 *
 * @returns Fresh version-three content with current A4 portrait defaults.
 */
export function createBlankTemplateContent(): TemplateContentV3 {
  const content = templateContentV3Schema.parse({
    schemaVersion: 3,
    blocks: [],
    sections: [],
    fieldGroups: [],
    blockRules: []
  })

  // New paper starts with an inch all round, as a word processor's does;
  // content saved before keeps the preset it was made with.
  return { ...content, layout: { ...content.layout, margins: { ...MARGIN_SIZES.normal } } }
}

