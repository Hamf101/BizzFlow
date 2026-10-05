import type { TemplateBlock } from "@/types/template"

// A spreadsheet formula a calculated answer is worked out by: "{Qty} * {Unit
// price}", "SUM({Items.Amount}) * 20%". Only this grammar is read, so a
// formula can name answers and do sums, and nothing else. Kept free of
// dependencies, as the schemas check every formula with it in the browser too.

/** Most characters a formula holds. */
export const MAX_FORMULA_LENGTH = 500

/** What a formula can call. */
export const FORMULA_FUNCTIONS = ["SUM", "ROUND", "MIN", "MAX", "ABS"] as const
export type FormulaFunction = (typeof FORMULA_FUNCTIONS)[number]

/** One read formula: numbers, references to answers, sums and calls. */
export type FormulaNode =
  | { kind: "number"; value: string }
  | { kind: "ref"; name: string }
  | { kind: "negate"; arg: FormulaNode }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: FormulaNode; right: FormulaNode }
  | { kind: "call"; name: FormulaFunction; args: FormulaNode[] }

const ARGUMENTS: Record<FormulaFunction, readonly [number, number]> = {
  ABS: [1, 1],
  MAX: [1, 20],
  MIN: [1, 20],
  ROUND: [1, 2],
  SUM: [1, 20],
}
// Brackets this deep are no formula a person writes; refusing them keeps the
// reading from running out of stack.
const MAX_DEPTH = 32

class FormulaError extends Error {}

/**
 * Reads a formula into its parts.
 *
 * @param text - The formula as written.
 * @returns The read formula, or why it cannot be read.
 */
export function parseFormula(text: string): { node: FormulaNode } | { error: string } {
  if (text.length > MAX_FORMULA_LENGTH) {
    return { error: `A formula is at most ${MAX_FORMULA_LENGTH} characters.` }
  }

  let at = 0
  let depth = 0
  const skip = (): void => {
    while (/\s/.test(text[at] ?? "")) at += 1
  }
  const fail = (reason: string): never => {
    throw new FormulaError(reason)
  }
  const take = (character: string): boolean => {
    skip()

    if (text[at] !== character) return false
    at += 1

    return true
  }
  const nested = <T,>(read: () => T): T => {
    depth += 1
    if (depth > MAX_DEPTH) fail("The formula has too many brackets inside each other.")
    const result = read()
    depth -= 1

    return result
  }

  function sum(): FormulaNode {
    let node = product()

    for (skip(); text[at] === "+" || text[at] === "-"; skip()) {
      const op = text[at] as "+" | "-"

      at += 1
      node = { kind: "binary", op, left: node, right: product() }
    }

    return node
  }

  function product(): FormulaNode {
    let node = unary()

    for (skip(); text[at] === "*" || text[at] === "/"; skip()) {
      const op = text[at] as "*" | "/"

      at += 1
      node = { kind: "binary", op, left: node, right: unary() }
    }

    return node
  }

  function unary(): FormulaNode {
    if (take("-")) return nested(() => ({ kind: "negate", arg: unary() }))
    if (take("+")) return nested(unary)

    const node = primary()

    return take("%") ? { kind: "binary", op: "/", left: node, right: { kind: "number", value: "100" } } : node
  }

  function primary(): FormulaNode {
    skip()

    if (take("(")) {
      const node = nested(sum)

      if (!take(")")) fail("A bracket is opened and not closed.")

      return node
    }

    if (take("{")) {
      const end = text.indexOf("}", at)
      const name = end === -1 ? "" : text.slice(at, end).trim()

      if (!name || name.includes("{")) fail("Name an answer between { and }, as {Qty}.")
      at = end + 1

      return { kind: "ref", name }
    }

    const number = /^\d+(?:\.\d+)?/.exec(text.slice(at))

    if (number) {
      at += number[0].length

      return { kind: "number", value: number[0] }
    }

    const word = /^[A-Za-z]+/.exec(text.slice(at))

    if (word) {
      const name = word[0].toUpperCase() as FormulaFunction

      if (!FORMULA_FUNCTIONS.includes(name)) {
        fail(`${word[0]} is not something a formula can do. It can use ${FORMULA_FUNCTIONS.join(", ")}.`)
      }

      at += word[0].length
      if (!take("(")) fail(`${name} needs brackets after it, as ${name}({Amount}).`)

      const args: FormulaNode[] = []

      if (!take(")")) {
        do args.push(nested(sum))
        while (take(","))
        if (!take(")")) fail(`${name}( is not closed.`)
      }

      const [least, most] = ARGUMENTS[name]

      if (args.length < least || args.length > most) {
        fail(least === most ? `${name} takes ${least} value.` : `${name} takes ${least} to ${most} values.`)
      }

      return { kind: "call", name, args }
    }

    return fail(at >= text.length ? "The formula ends too soon." : `"${text[at]}" cannot be read here.`)
  }

  try {
    if (!text.trim()) fail("Write a formula, such as {Qty} * {Unit price}.")

    const node = sum()

    skip()
    if (at < text.length) fail(`"${text.slice(at, at + 12)}" cannot be read here.`)

    return { node }
  } catch (error) {
    if (error instanceof FormulaError) return { error: error.message }
    throw error
  }
}

/**
 * The answers a formula names, in the order it names them.
 *
 * @param node - A read formula.
 * @returns Each name between braces.
 */
export function formulaReferences(node: FormulaNode): string[] {
  switch (node.kind) {
    case "ref":
      return [node.name]
    case "negate":
      return formulaReferences(node.arg)
    case "binary":
      return [...formulaReferences(node.left), ...formulaReferences(node.right)]
    case "call":
      return node.args.flatMap(formulaReferences)
    default:
      return []
  }
}

/** What a name in a formula stands for. */
export type FormulaReference =
  /** An earlier number or amount: one value. */
  | { kind: "field"; fieldKey: string }
  /** A table's column, every row of it: a list, for SUM, MIN or MAX. */
  | { kind: "column"; fieldKey: string; column: number }
  /** In a table's column, an earlier column of the same row: one value. */
  | { kind: "cell"; column: number }

type Block = TemplateBlock
type Numeric = { format?: string }

const numeric = ({ format }: Numeric): boolean => format === "number" || format === "money"
const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Finds what a name in a formula stands for. A formula names only what comes
 * before it, so no answer can depend on itself.
 *
 * @param blocks - The document's blocks in order.
 * @param index - Where the formula's block is.
 * @param column - For a table's column, which one; absent for a field.
 * @param name - The name between braces.
 * @returns What it stands for, or why it stands for nothing.
 */
export function resolveFormulaReference(
  blocks: readonly Block[],
  index: number,
  column: number | undefined,
  name: string
): FormulaReference | { problem: string } {
  const owner = blocks[index]

  if (column !== undefined && owner?.type === "table_field") {
    const found = owner.columns.findIndex((candidate, at) => at < column && same(candidate.label, name))

    if (found !== -1) {
      return numeric(owner.columns[found]!) ? { kind: "cell", column: found } : { problem: `{${name}} is not a number or amount column.` }
    }
  }

  const earlier = blocks.slice(0, index)
  const fields = earlier.filter((block) => block.type === "text_field" && same(block.label, name))

  if (fields.length > 1) {
    return { problem: `Two answers are called {${name}}; rename one.` }
  }

  const field = fields[0]

  if (field?.type === "text_field") {
    return numeric(field) ? { kind: "field", fieldKey: field.fieldKey } : { problem: `{${name}} is not a number or amount.` }
  }

  // "Items.Amount": a table's column, split at the last dot whose two sides name one.
  for (let dot = name.lastIndexOf("."); dot > 0; dot = name.lastIndexOf(".", dot - 1)) {
    const table = earlier.find((block) => block.type === "table_field" && same(block.label, name.slice(0, dot)))
    const found = table?.type === "table_field" ? table.columns.findIndex((candidate) => same(candidate.label, name.slice(dot + 1))) : -1

    if (table?.type === "table_field" && found !== -1) {
      return numeric(table.columns[found]!) ? { kind: "column", fieldKey: table.fieldKey, column: found } : { problem: `{${name}} is not a number or amount column.` }
    }
  }

  return {
    problem:
      column === undefined
        ? `Nothing above is called {${name}}. Name a number or amount, or a table's column as {Table.Column}.`
        : `No column to the left, or number above, is called {${name}}.`,
  }
}

/**
 * Why a formula cannot work out its answer, or null when it can.
 *
 * @param blocks - The document's blocks in order.
 * @param index - Where the formula's block is.
 * @param formula - The formula as written.
 * @param column - For a table's column, which one; absent for a field.
 * @returns The first problem, or null.
 */
export function formulaProblem(blocks: readonly Block[], index: number, formula: string, column?: number): string | null {
  const read = parseFormula(formula)

  if ("error" in read) {
    return read.error
  }

  const check = (node: FormulaNode, list: boolean): string | null => {
    switch (node.kind) {
      case "ref": {
        const reference = resolveFormulaReference(blocks, index, column, node.name)

        if ("problem" in reference) return reference.problem

        return reference.kind === "column" && !list ? `{${node.name}} is a whole column; total it with SUM({${node.name}}).` : null
      }
      case "negate":
        return check(node.arg, false)
      case "binary":
        return check(node.left, false) ?? check(node.right, false)
      case "call": {
        const lists = node.name === "SUM" || node.name === "MIN" || node.name === "MAX"

        return node.args.reduce<string | null>((problem, arg) => problem ?? check(arg, lists), null)
      }
      default:
        return null
    }
  }

  return check(read.node, false)
}

/**
 * Whether anything in a document is worked out by a formula, so pages load
 * the arithmetic only for documents that need it.
 *
 * @param blocks - The document's blocks.
 * @returns `true` when a field or table column has a formula.
 */
export function hasFormulas(blocks: readonly Block[]): boolean {
  return blocks.some(
    (block) => (block.type === "text_field" && block.formula !== undefined) || (block.type === "table_field" && block.columns.some((column) => column.formula !== undefined))
  )
}

/**
 * Puts a new name where a formula named the old one, matched as references
 * are, whatever the case. "Items" also renames "{Items.Amount}" when `table`.
 *
 * @param formula - The formula as written.
 * @param from - The old name.
 * @param to - The new name.
 * @param table - Whether a table was renamed, so its columns' names follow.
 * @returns The formula naming the new name.
 */
export function renameInFormula(formula: string, from: string, to: string, table = false): string {
  return formula.replace(/\{([^{}]*)\}/g, (whole: string, name: string): string => {
    if (same(name, from)) return `{${to}}`

    const dot = name.trim().toLowerCase().startsWith(`${from.trim().toLowerCase()}.`) ? from.trim().length : -1

    return table && dot !== -1 ? `{${to}${name.trim().slice(dot)}}` : whole
  })
}

/**
 * The answers a formula works out: its fields', and its tables' whose
 * columns it fills.
 *
 * @param blocks - The document's blocks.
 * @returns Their field keys.
 */
export function calculatedFieldKeys(blocks: readonly Block[]): string[] {
  return blocks.flatMap((block) => (hasFormulas([block]) && "fieldKey" in block ? [block.fieldKey] : []))
}

/**
 * A table column's total, as its Total row prints it: exact, in millionths,
 * an amount to the penny. Cells that hold no number are passed over.
 *
 * @param cells - The column's cells.
 * @param money - Whether the column holds amounts.
 * @returns The total, or blank when no cell holds a number.
 */
export function columnTotal(cells: readonly string[], money: boolean): string {
  let sum = BigInt(0)
  let any = false

  for (const cell of cells) {
    const found = /^(-?)(\d{1,30})(?:\.(\d+))?$/.exec(cell.replace(/,/g, "").trim())

    if (found) {
      const millionths = BigInt(`${found[2]}${(found[3] ?? "").slice(0, 6).padEnd(6, "0")}`)

      sum += found[1] ? -millionths : millionths
      any = true
    }
  }

  if (!any) return ""

  const sign = sum < BigInt(0) ? "-" : ""
  const size = sum < BigInt(0) ? -sum : sum

  if (money) {
    const pennies = (size + BigInt(5_000)) / BigInt(10_000)

    return `${pennies === BigInt(0) ? "" : sign}${pennies / BigInt(100)}.${String(pennies % BigInt(100)).padStart(2, "0")}`
  }

  const fraction = String(size % BigInt(1_000_000)).padStart(6, "0").replace(/0+$/, "")

  return `${size === BigInt(0) ? "" : sign}${size / BigInt(1_000_000)}${fraction ? `.${fraction}` : ""}`
}

/**
 * A table's Total row: each totalled column added up, and "Total" in the
 * first column that is not, or null when no column is totalled.
 *
 * @param block - The table.
 * @param rows - Its rows of cells.
 * @returns The row's cells, or null.
 */
export function tableTotalRow(block: Extract<Block, { type: "table_field" }>, rows: readonly string[][]): string[] | null {
  if (!block.columns.some((column) => column.total)) {
    return null
  }

  const label = block.columns.findIndex((column) => !column.total)

  return block.columns.map((column, at): string =>
    column.total ? columnTotal(rows.map((row) => row[at] ?? ""), column.format === "money") : at === label ? "Total" : ""
  )
}
