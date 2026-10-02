import { z } from "zod"

import { MAX_TABLE_FIELD_ROWS } from "@/types/template-answer-kinds"
import {
  TABLE_COLUMN_FORMATS,
  TEXT_FORMATS,
  type TemplateBlock
} from "@/types/template"

/**
 * One stored answer: a tick, text (a date, a choice or a drawing too), the
 * choices ticked, a grid's choice for each row it names, or a table's rows.
 */
export const templateAnswerValueSchema = z.union([
  z.string(),
  z.boolean(),
  z.array(z.string()),
  z.record(z.string(), z.string()),
  z.array(z.array(z.string()))
])

/** One stored answer, in the shape its field kind holds. */
export type TemplateAnswerValue = z.infer<typeof templateAnswerValueSchema>

type FieldBlock = Extract<TemplateBlock, { fieldKey: string }>

/** A field whose answer is written, not uploaded or drawn. */
export type TypedAnswerBlock = Exclude<
  FieldBlock,
  { type: "file_field" | "signature_field" | "initials_field" }
>

/** Builds the error a caller throws for an answer that does not fit. */
export type AnswerFailure = (message: string) => Error

const MAX_TEXT_ANSWER_LENGTH = 20_000
const MAX_TABLE_CELL_LENGTH = 500

const NUMBER = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/
const MONEY = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/

const FORMAT_CHECKS: Record<
  (typeof TEXT_FORMATS)[number] | (typeof TABLE_COLUMN_FORMATS)[number],
  { test: (value: string) => boolean; noun: string }
> = {
  number: { test: (value) => NUMBER.test(value), noun: "a number" },
  money: { test: (value) => MONEY.test(value), noun: "an amount of money" },
  email: {
    test: (value) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    noun: "an email address"
  },
  phone: {
    test: (value) => {
      const digits = value.replace(/\D/g, "").length
      return /^[\d\s+().-]+$/.test(value) && digits >= 6 && digits <= 20
    },
    noun: "a phone number"
  },
  time: { test: (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value), noun: "a time as HH:MM" },
  month: { test: (value) => /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value), noun: "a month as YYYY-MM" },
  date: { test: isCalendarDate, noun: "a valid date" }
}


/**
 * Checks and tidies one written answer by its field's kind: text is trimmed,
 * ticked choices follow the options' order, a grid keeps only answered rows,
 * and a table drops its blank rows.
 *
 * @param block - The field the answer belongs to.
 * @param value - The untrusted answer.
 * @param fail - Builds the caller's error for a refused answer.
 * @returns The answer as it is stored.
 * @throws The error `fail` builds when the answer does not fit the field.
 */
export function normalizeTemplateAnswer(
  block: TypedAnswerBlock,
  value: unknown,
  fail: AnswerFailure
): TemplateAnswerValue {
  if (block.type === "checkbox_field") {
    if (typeof value !== "boolean") {
      throw fail(`${block.label} must be checked or unchecked.`)
    }

    return value
  }

  if (block.type === "dropdown_field" && block.multiple) {
    const ticked = readStrings(value, fail, `${block.label} must be a list of choices.`)

    if (new Set(ticked).size !== ticked.length || ticked.some((choice) => !block.options.includes(choice))) {
      throw fail(`${block.label} must tick each available option at most once.`)
    }

    return block.options.filter((option) => ticked.includes(option))
  }

  if (block.type === "choice_grid_field") {
    return normalizeGridAnswer(block, value, fail)
  }

  if (block.type === "table_field") {
    return normalizeTableAnswer(block, value, fail)
  }

  if (typeof value !== "string") {
    throw fail(`${block.label} must be text.`)
  }

  const text = value.trim()

  if (text.length > MAX_TEXT_ANSWER_LENGTH) {
    throw fail(`${block.label} is too long.`)
  }

  if (text.length === 0) {
    return text
  }

  if (block.type === "date_field") {
    assertFormat("date", text, block.label, fail)
  }

  if (block.type === "dropdown_field" && !block.options.includes(text)) {
    throw fail(`${block.label} must use one of the available options.`)
  }

  if (block.type === "text_field") {
    if (block.format) {
      assertFormat(block.format, text, block.label, fail)
    }

    if (block.comb && text.length > block.comb) {
      throw fail(`${block.label} fits at most ${block.comb} characters.`)
    }
  }

  return text
}

/**
 * Whether a required field's answer counts as given: a tick, at least one
 * choice, every grid row, at least one table row, or any text.
 *
 * @param block - The required field, other than a file.
 * @param value - The stored answer, possibly absent.
 * @returns `true` when the answer completes the field.
 */
export function isTemplateAnswerComplete(
  block: Exclude<FieldBlock, { type: "file_field" }>,
  value: unknown
): boolean {
  if (block.type === "checkbox_field") {
    return value === true
  }

  if (block.type === "choice_grid_field") {
    return isRecord(value) && block.rows.every((row) => Object.hasOwn(value, row) && typeof value[row] === "string" && value[row] !== "")
  }

  if (block.type === "table_field") {
    return Array.isArray(value) && value.some((row) => Array.isArray(row) && row.some((cell) => typeof cell === "string" && cell.trim() !== ""))
  }

  if (Array.isArray(value)) {
    return value.length > 0
  }

  return typeof value === "string" && value.trim().length > 0
}

function normalizeGridAnswer(
  block: Extract<FieldBlock, { type: "choice_grid_field" }>,
  value: unknown,
  fail: AnswerFailure
): Record<string, string> {
  if (!isRecord(value)) {
    throw fail(`${block.label} must name a choice for each row.`)
  }

  for (const [row, choice] of Object.entries(value)) {
    if (!block.rows.includes(row) || typeof choice !== "string" || (choice.trim() !== "" && !block.options.includes(choice.trim()))) {
      throw fail(`${block.label} must use its own rows and choices.`)
    }
  }

  // Object.fromEntries defines each key as its own, so a row named
  // "__proto__" stays an answer and never becomes a prototype.
  return Object.fromEntries(
    block.rows.flatMap((row): [string, string][] => {
      const choice = Object.hasOwn(value, row) ? (value[row] as string).trim() : ""
      return choice ? [[row, choice]] : []
    })
  )
}

function normalizeTableAnswer(
  block: Extract<FieldBlock, { type: "table_field" }>,
  value: unknown,
  fail: AnswerFailure
): string[][] {
  const maxRows = block.addRows ? MAX_TABLE_FIELD_ROWS : block.rows

  // Counted before any row is read, so a huge table costs nothing.
  if (!Array.isArray(value) || value.length > maxRows) {
    throw fail(`${block.label} holds at most ${maxRows} rows.`)
  }

  return value
    .map((row: unknown): string[] => {
      const cells = readStrings(row, fail, `${block.label} has a row that is not a list of cells.`)

      if (cells.length !== block.columns.length) {
        throw fail(`${block.label} needs one cell for each column.`)
      }

      return cells.map((cell: string, index: number): string => {
        const column = block.columns[index]!

        if (cell.length > MAX_TABLE_CELL_LENGTH) {
          throw fail(`${block.label}: ${column.label} is too long.`)
        }

        if (cell && column.format) {
          assertFormat(column.format, cell, `${block.label}: ${column.label}`, fail)
        }

        return cell
      })
    })
    .filter((cells: string[]): boolean => cells.some(Boolean))
}

function readStrings(value: unknown, fail: AnswerFailure, message: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw fail(message)
  }

  return (value as string[]).map((item: string): string => item.trim())
}

function assertFormat(
  format: keyof typeof FORMAT_CHECKS,
  value: string,
  label: string,
  fail: AnswerFailure
): void {
  const check = FORMAT_CHECKS[format]

  if (!check.test(value)) {
    throw fail(`${label} must be ${check.noun}.`)
  }
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export { isStructuredAnswerBlock } from "@/types/template-answer-kinds"
