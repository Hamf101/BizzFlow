import * as z from "zod"

// A spreadsheet ("Sheet"): tabs of cells, each a typed-in value or a formula.
// Computed values are never stored; the server works them out again. Dates are
// Excel serial numbers in the 1900 date system, so they round-trip with Excel.

/** Columns A–AZ. */
export const SHEET_COLUMNS = 52
export const SHEET_ROWS = 2000
const MAX_TABS = 10
const MAX_CELLS = 50_000
/** Characters in a formula, without its leading "=". */
export const MAX_SHEET_FORMULA_LENGTH = 1000
const MAX_TEXT_LENGTH = 5000

// A–Z or AA–AZ, then a row 1–2000 with no leading zero.
const COLUMN = "(?:[A-Z]|A[A-Z])"
const cellAddress = new RegExp(`^${COLUMN}(?:[1-9]\\d{0,2}|1\\d{3}|2000)$`)
const columnLabel = new RegExp(`^${COLUMN}$`)

const formatSchema = z.strictObject({
  type: z.enum(["general", "number", "money", "percent", "date", "text"]),
  decimals: z.int().min(0).max(10).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  bold: z.boolean().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
})

const cellSchema = z.strictObject({
  v: z.union([z.string().max(MAX_TEXT_LENGTH), z.number(), z.boolean(), z.null()]).optional(),
  f: z.string().min(1).max(MAX_SHEET_FORMULA_LENGTH).optional(),
  fmt: formatSchema.optional(),
})

const tabSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  // Excel's sheet-name rules.
  name: z
    .string()
    .min(1)
    .max(31)
    .regex(/^[^[\]:*?/\\]+$/)
    .refine((name) => !name.startsWith("'") && !name.endsWith("'"), "A tab name cannot start or end with an apostrophe."),
  cells: z.record(z.string().regex(cellAddress), cellSchema),
  cols: z.record(z.string().regex(columnLabel), z.int().min(1).max(2000)).optional(),
  frozenRows: z.int().min(0).max(SHEET_ROWS).optional(),
})

const sheetContentSchema = z
  .strictObject({ version: z.literal(1), tabs: z.array(tabSchema).min(1).max(MAX_TABS) })
  .superRefine((content, context) => {
    const ids = new Set(content.tabs.map((tab) => tab.id))
    const names = new Set(content.tabs.map((tab) => tab.name.toLowerCase()))
    const cells = content.tabs.reduce((total, tab) => total + Object.keys(tab.cells).length, 0)

    if (ids.size < content.tabs.length) context.addIssue({ code: "custom", message: "Two tabs share an id." })
    if (names.size < content.tabs.length) context.addIssue({ code: "custom", message: "Two tabs share a name." })
    if (cells > MAX_CELLS) context.addIssue({ code: "custom", message: `A sheet holds at most ${MAX_CELLS} cells.` })
  })

export type SheetContent = z.infer<typeof sheetContentSchema>
export type SheetCell = z.infer<typeof cellSchema>
export type SheetFormat = z.infer<typeof formatSchema>

/**
 * Checks a sheet against every cap: the trust boundary for a sheet a browser sent.
 *
 * @param value - Untrusted sheet content.
 * @returns The sheet, typed.
 * @throws z.ZodError when the sheet breaks a rule or a cap.
 */
export function parseSheetContent(value: unknown): SheetContent {
  return sheetContentSchema.parse(value)
}
