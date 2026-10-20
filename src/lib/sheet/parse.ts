import { formatCellRef, isInGrid, parseCellRef, type CellRef } from "@/lib/sheet/a1"
import { isSheetErrorCode, type SheetErrorCode } from "@/lib/sheet/values"
import { MAX_SHEET_FORMULA_LENGTH } from "@/types/sheet"

// Formula text ("SUM(A1:A3)*-2^2", without its "=") → tokens → a tree, with
// Excel's operator precedence. No eval, no Function: the tree is all there is.

export type BinaryOp = "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">="

export type FormulaNode =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "err"; v: SheetErrorCode }
  | { k: "missing" }
  | { k: "name"; v: string }
  | { k: "ref"; sheet: string | null; row: number; col: number }
  | { k: "range"; sheet: string | null; r1: number; c1: number; r2: number; c2: number }
  | { k: "neg" | "pos" | "pct"; arg: FormulaNode }
  | { k: "bin"; op: BinaryOp; left: FormulaNode; right: FormulaNode }
  | { k: "call"; name: string; args: FormulaNode[] }

type Span = { s: number; e: number }
type Token = Span &
  (
    | { t: "num"; v: number }
    | { t: "str"; v: string }
    | { t: "err"; v: SheetErrorCode }
    | { t: "bool"; v: boolean }
    | { t: "name" | "fn" | "op"; v: string }
    | { t: "ref"; sheet: string | null; ref: CellRef; refStart: number }
  )

class FormulaSyntaxError extends Error {}

// Nesting deeper than this is no formula a person writes (Excel stops at 64
// nested functions); refusing it keeps parsing and evaluating off the stack's edge.
const MAX_DEPTH = 100

const ERROR_LITERALS = ["#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#N/A", "#NUM!"]
const OPERATORS = ["<>", "<=", ">=", "+", "-", "*", "/", "^", "&", "%", "=", "<", ">", ":", ",", "(", ")"]
// Letters in any script, so Café!A1 reads as Excel reads it.
const IDENTIFIER = /[\p{L}\p{N}_.$]+/uy
const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
const CALL = /\s*\(/y

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let at = 0

  const sticky = (pattern: RegExp) => {
    pattern.lastIndex = at
    const match = pattern.exec(source)
    if (!match) throw new FormulaSyntaxError(`Unexpected "${source[at] ?? "end"}" at ${at + 1}.`)
    at += match[0].length
    return match[0]
  }

  // Reads to the closing quote; a doubled quote stands for one.
  const quoted = (quote: string, what: string) => {
    let text = ""
    for (at += 1; ; at += 1) {
      if (at >= source.length) throw new FormulaSyntaxError(`${what} is missing its closing quote.`)
      if (source[at] !== quote) text += source[at]
      else if (source[at + 1] === quote) {
        text += quote
        at += 1
      } else break
    }
    at += 1
    return text
  }

  // After "Sheet!" comes one cell; a column or row on its own ("Sheet!A") is #REF!.
  const sheetRef = (s: number, sheet: string) => {
    const refStart = at
    const ref = parseCellRef(sticky(IDENTIFIER))
    tokens.push(ref?.inGrid ? { t: "ref", sheet, ref, refStart, s, e: at } : { t: "err", v: "#REF!", s, e: at })
  }

  while (at < source.length) {
    const char = source[at]!
    const s = at

    if (/\s/.test(char)) {
      at += 1
    } else if (char === '"') {
      tokens.push({ t: "str", v: quoted('"', "Text"), s, e: at })
    } else if (char === "#") {
      const code = ERROR_LITERALS.find((literal) => source.slice(at, at + literal.length).toUpperCase() === literal)
      if (!code || !isSheetErrorCode(code)) throw new FormulaSyntaxError(`Unknown error value at ${at + 1}.`)
      at += code.length
      tokens.push({ t: "err", v: code, s, e: at })
    } else if (/[0-9.]/.test(char)) {
      const value = Number(sticky(NUMBER))
      if (!Number.isFinite(value)) throw new FormulaSyntaxError(`The number at ${s + 1} is too large.`)
      tokens.push({ t: "num", v: value, s, e: at })
    } else if (char === "'") {
      const sheet = quoted("'", "A tab name")
      if (source[at] !== "!") throw new FormulaSyntaxError("A quoted tab name must be followed by !.")
      at += 1
      sheetRef(s, sheet)
    } else if (/[\p{L}_$]/u.test(char)) {
      const word = sticky(IDENTIFIER)
      if (source[at] === "!") {
        at += 1
        sheetRef(s, word)
        continue
      }
      const ref = parseCellRef(word)
      const upper = word.toUpperCase()
      CALL.lastIndex = at
      if (CALL.test(source)) tokens.push({ t: "fn", v: upper, s, e: at })
      else if (ref) tokens.push(ref.inGrid ? { t: "ref", sheet: null, ref, refStart: s, s, e: at } : { t: "err", v: "#REF!", s, e: at })
      else if (upper === "TRUE" || upper === "FALSE") tokens.push({ t: "bool", v: upper === "TRUE", s, e: at })
      else tokens.push({ t: "name", v: word, s, e: at })
    } else {
      const operator = OPERATORS.find((candidate) => source.startsWith(candidate, at))
      if (!operator) throw new FormulaSyntaxError(`Unexpected "${char}" at ${at + 1}.`)
      at += operator.length
      tokens.push({ t: "op", v: operator, s, e: at })
    }
  }

  return tokens
}

// Excel's precedence, loosest first. Negation binds tighter than ^, so -2^2 is 4.
const INFIX: Record<string, number> = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5, "%": 6, ":": 8 }
const UNARY = 7

function parseTokens(source: string, tokens: Token[]): FormulaNode {
  let at = 0
  const peek = () => tokens[at]
  const isOp = (value: string) => {
    const token = peek()
    return token?.t === "op" && token.v === value
  }
  const expect = (value: string) => {
    if (!isOp(value)) throw new FormulaSyntaxError(`Expected "${value}".`)
    at += 1
  }

  const expression = (minimum: number, depth: number): FormulaNode => {
    if (depth > MAX_DEPTH) throw new FormulaSyntaxError("The formula is nested too deeply.")
    let left = prefix(depth)

    for (;;) {
      const token = peek()
      if (token?.t !== "op" || !(token.v in INFIX) || INFIX[token.v]! <= minimum) return left
      at += 1
      if (token.v === "%") left = { k: "pct", arg: left }
      else if (token.v === ":") left = range(left, expression(INFIX[":"]!, depth + 1))
      else left = { k: "bin", op: token.v as BinaryOp, left, right: expression(INFIX[token.v]!, depth + 1) }
    }
  }

  const prefix = (depth: number): FormulaNode => {
    const token = tokens[at++]
    switch (token?.t) {
      case "num":
      case "str":
      case "err":
      case "bool":
        return { k: token.t, v: token.v } as FormulaNode
      case "name":
        return { k: "name", v: token.v }
      case "ref":
        return { k: "ref", sheet: token.sheet, row: token.ref.row, col: token.ref.col }
      case "fn": {
        expect("(")
        const args: FormulaNode[] = []
        if (isOp(")")) at += 1
        else
          for (;;) {
            args.push(isOp(",") || isOp(")") ? { k: "missing" } : expression(0, depth + 1))
            if (isOp(")")) break
            expect(",")
          }
        if (args.length > 0) expect(")")
        return { k: "call", name: token.v, args }
      }
      case "op":
        if (token.v === "(") {
          const inner = expression(0, depth + 1)
          expect(")")
          return inner
        }
        if (token.v === "-" || token.v === "+") return { k: token.v === "-" ? "neg" : "pos", arg: expression(UNARY, depth + 1) }
    }
    throw new FormulaSyntaxError(token ? `Unexpected "${source.slice(token.s, token.e)}".` : "The formula ends too soon.")
  }

  const node = expression(0, 0)
  if (at < tokens.length) throw new FormulaSyntaxError("Unexpected text after the formula.")
  return node
}

// Only cell:cell on one tab is a range; whole columns or rows ("A:A", "1:1") are refused.
function range(left: FormulaNode, right: FormulaNode): FormulaNode {
  if (left.k !== "ref" || right.k !== "ref") return { k: "err", v: "#REF!" }
  if (right.sheet !== null && right.sheet.toLowerCase() !== left.sheet?.toLowerCase()) return { k: "err", v: "#REF!" }
  return { k: "range", sheet: left.sheet, r1: left.row, c1: left.col, r2: right.row, c2: right.col }
}

/**
 * Reads a formula (without its "=") into a tree.
 *
 * @param text - The formula as stored.
 * @returns The tree, or why the formula cannot be read.
 */
export function parseFormula(text: string): { node: FormulaNode } | { error: string } {
  if (text.length > MAX_SHEET_FORMULA_LENGTH) return { error: `A formula holds at most ${MAX_SHEET_FORMULA_LENGTH} characters.` }
  if (text.trim() === "") return { error: "The formula is empty." }
  try {
    return { node: parseTokens(text, tokenize(text)) }
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return { error: error.message }
    throw error
  }
}

const shiftRef = (ref: CellRef, rows: number, columns: number): CellRef | null => {
  const moved = { ...ref, row: ref.rowAbs ? ref.row : ref.row + rows, col: ref.colAbs ? ref.col : ref.col + columns }
  return isInGrid(moved.row, moved.col) ? moved : null
}

/**
 * The formula as it reads once copied `rows` down and `columns` across (fill
 * down, paste): relative parts move, `$` parts stay, and a reference pushed
 * off the grid becomes #REF!. Everything that is not a reference, string
 * literals included, is kept exactly as written.
 *
 * @param formula - The formula, without its "=".
 * @param rows - Rows moved; negative is up.
 * @param columns - Columns moved; negative is left.
 * @returns The moved formula; one that cannot be read is returned unchanged.
 */
export function shiftFormula(formula: string, rows: number, columns: number): string {
  return mapReferences(formula, ({ first, last, sheet }) => {
    const start = shiftRef(first, rows, columns)
    const end = last && shiftRef(last, rows, columns)
    return start && (!last || end) ? { first: start, last: end, sheet } : null
  })
}

/** One reference in a formula: a cell, or a range cell:cell, and the tab it names (null for its own). */
export type FormulaReference = { sheet: string | null; first: CellRef; last: CellRef | null }

type RefToken = Token & { t: "ref" }

// A ref token, and the one that closes its range when a ":" follows.
function* references(tokens: Token[]): Generator<{ token: RefToken; end: RefToken | null }> {
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at]!
    if (token.t !== "ref") continue
    const colon = tokens[at + 1]
    const end = colon?.t === "op" && colon.v === ":" && tokens[at + 2]?.t === "ref" ? (tokens[at + 2] as RefToken) : null
    yield { token, end }
    if (end) at += 2
  }
}

function tokensOf(formula: string): Token[] | null {
  try {
    return tokenize(formula)
  } catch {
    return null
  }
}

/**
 * Every reference a formula makes, where it is written, for outlining the
 * cells it reads. A formula that cannot be read has none.
 *
 * @param formula - The formula, without its "=".
 * @returns Each reference with its start and end in the text.
 */
export function formulaReferences(formula: string): Array<FormulaReference & { start: number; end: number }> {
  return [...references(tokensOf(formula) ?? [])].map(({ token, end }) => ({
    end: (end ?? token).e,
    first: token.ref,
    last: end?.ref ?? null,
    sheet: token.sheet,
    start: token.s,
  }))
}

/** A tab name as a formula writes it: quoted unless it reads as a plain word. */
export function formulaSheetName(name: string): string {
  return /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name) && !parseCellRef(name) && !/^(TRUE|FALSE)$/i.test(name) ? name : `'${name.replaceAll("'", "''")}'`
}

/**
 * Rewrites each reference in a formula, keeping everything else exactly as
 * written: the moves behind fill, paste, inserting rows and renaming tabs.
 *
 * @param formula - The formula, without its "=".
 * @param move - The reference's new cells and tab, or null for #REF!.
 * @returns The rewritten formula; one that cannot be read is returned unchanged.
 */
export function mapReferences(formula: string, move: (reference: FormulaReference) => FormulaReference | null): string {
  const tokens = tokensOf(formula)
  if (!tokens) return formula

  let out = ""
  let copied = 0
  for (const { token, end } of references(tokens)) {
    const next = move({ sheet: token.sheet, first: token.ref, last: end?.ref ?? null })
    // A tab named anew is written anew; otherwise its prefix stays as typed.
    const prefix = (ref: RefToken) =>
      ref.refStart === ref.s ? "" : next?.sheet === token.sheet ? formula.slice(ref.s, ref.refStart) : `${formulaSheetName(next!.sheet!)}!`

    out += formula.slice(copied, token.s)
    if (!next || (end && !next.last)) out += "#REF!"
    else {
      out += prefix(token) + formatCellRef(next.first)
      if (end) out += formula.slice(token.e, end.s) + prefix(end) + formatCellRef(next.last!)
    }
    copied = (end ?? token).e
  }
  return out + formula.slice(copied)
}
