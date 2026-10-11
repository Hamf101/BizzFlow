import Big, { type Big as BigNumber } from "big.js"

import type { TemplateBlock, TemplateContent } from "@/types/template"
import { parseFormula, resolveFormulaReference, type FormulaNode } from "@/types/template-formula"
import { visibilityPass } from "@/types/template-visibility"

// Worked out in decimals, as money is: 0.1 times 3 is 0.3. Halves round up.
const Decimal = Big()

Decimal.DP = 20
Decimal.RM = Decimal.roundHalfUp

/** A number this long is no answer a person gave; one is given up on. */
const MAX_DIGITS = 30
/** Each step keeps this many places, so a long formula stays quick. */
const STEP_PLACES = 20

class Unworkable extends Error {}

type Value = BigNumber | null
type Row = string[]

/**
 * Works out every answer a formula gives, from the answers it names: a
 * table's worked-out columns row by row, then its fields, top to bottom.
 * What a browser sent for a worked-out answer is replaced. A hidden answer
 * is let go on the way down, before anything below can read it, so the
 * result is also the visible answer state. Money is rounded
 * to the penny, half up, on each line and on each field, as an invoice is.
 * An answer stays blank until something it names is answered, and when it
 * cannot be worked out: a division by nothing, or a number too long to be real.
 *
 * @param content - The document's content.
 * @param values - Its answers.
 * @returns The visible answers with every worked-out one in place.
 */
export function calculateTemplateAnswers(content: TemplateContent, values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...values }

  if (content.schemaVersion !== 3) {
    return next
  }

  // Reads `next` as it fills: a rule tests only answers above it, already settled.
  const shows = visibilityPass(content, next)

  for (const [index, block] of content.blocks.entries()) {
    if ("fieldKey" in block && !shows(block)) {
      delete next[block.fieldKey]
      continue
    }

    if (block.type === "text_field" && block.formula !== undefined) {
      next[block.fieldKey] = work(content.blocks, index, undefined, block.formula, block.format === "money", next, null)
    }

    if (block.type === "table_field" && block.columns.some((column) => column.formula !== undefined) && Array.isArray(next[block.fieldKey])) {
      next[block.fieldKey] = readRows(next[block.fieldKey], block.columns.length).map((row: Row): Row => {
        for (const [at, column] of block.columns.entries()) {
          if (column.formula !== undefined) {
            row[at] = work(content.blocks, index, at, column.formula, column.format === "money", next, row)
          }
        }

        return row
      })
    }
  }

  return next
}

function work(
  blocks: readonly TemplateBlock[],
  index: number,
  column: number | undefined,
  formula: string,
  money: boolean,
  values: Readonly<Record<string, unknown>>,
  row: Row | null
): string {
  const read = parseFormula(formula)
  let answered = false

  const evaluate = (node: FormulaNode): Value | Value[] => {
    switch (node.kind) {
      case "number":
        return new Decimal(node.value)
      case "ref": {
        const reference = resolveFormulaReference(blocks, index, column, node.name)

        if ("problem" in reference) throw new Unworkable(reference.problem)

        const found =
          reference.kind === "cell"
            ? readNumber(row?.[reference.column])
            : reference.kind === "field"
              ? readNumber(values[reference.fieldKey])
              : readRows(values[reference.fieldKey], reference.column + 1).map((cells) => readNumber(cells[reference.column]))

        answered ||= Array.isArray(found) ? found.some((value) => value !== null) : found !== null

        return found
      }
      case "negate":
        return step(one(evaluate(node.arg)).neg())
      case "binary": {
        const left = one(evaluate(node.left))
        const right = one(evaluate(node.right))

        if (node.op === "/" && right.eq(0)) throw new Unworkable("Divided by nothing.")

        return step(node.op === "+" ? left.plus(right) : node.op === "-" ? left.minus(right) : node.op === "*" ? left.times(right) : left.div(right))
      }
      case "call": {
        const args = node.args.map(evaluate)

        if (node.name === "ABS") return step(one(args[0]!).abs())
        if (node.name === "ROUND") {
          const places = args[1] === undefined ? 0 : Number(one(args[1]))

          if (!Number.isInteger(places) || places < 0 || places > 10) throw new Unworkable("ROUND keeps 0 to 10 places.")

          return one(args[0]!).round(places)
        }

        const given = args.flat().filter((value): value is BigNumber => value !== null)

        if (node.name === "SUM") return step(given.reduce((sum, value) => sum.plus(value), new Decimal(0)))
        if (given.length === 0) return null

        return given.reduce((best, value) => ((node.name === "MIN" ? value.lt(best) : value.gt(best)) ? value : best))
      }
    }
  }

  try {
    if ("error" in read) return ""

    const result = one(evaluate(read.node))

    if (!answered) return ""

    // Rounded first, so a sliver below nothing shows as nothing, never "-0.00".
    const shown = result.round(money ? 2 : 6)

    return formatNumber(shown.eq(0) ? new Decimal(0) : shown, money)
  } catch (error) {
    if (error instanceof Unworkable) return ""
    throw error
  }
}

// A blank answer counts as nothing, as in a spreadsheet.
function one(value: Value | Value[]): BigNumber {
  if (Array.isArray(value)) throw new Unworkable("A whole column is totalled with SUM.")

  return value ?? new Decimal(0)
}

function step(value: BigNumber): BigNumber {
  const rounded = value.round(STEP_PLACES)

  if (rounded.e >= MAX_DIGITS) throw new Unworkable("Too large to be real.")

  return rounded
}

function readNumber(answer: unknown): Value {
  const text = typeof answer === "string" ? answer.replace(/,/g, "").trim() : ""

  if (!text) return null
  if (!/^-?\d+(?:\.\d+)?$/.test(text) || text.replace(/\D/g, "").length > MAX_DIGITS) throw new Unworkable("Not a number.")

  return new Decimal(text)
}

function readRows(answer: unknown, width: number): Row[] {
  return Array.isArray(answer)
    ? answer.map((row: unknown): Row =>
        Array.from({ length: width }, (_, at) => (Array.isArray(row) && typeof row[at] === "string" ? (row[at] as string) : ""))
      )
    : []
}

function formatNumber(value: BigNumber, money: boolean): string {
  return money ? value.toFixed(2) : value.toFixed(6).replace(/\.?0+$/, "")
}
