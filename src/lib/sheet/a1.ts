import { SHEET_COLUMNS, SHEET_ROWS } from "@/types/sheet"

// A1 references: "B12", "$B$12", "Sheet2!A1", "'My tab'!A1:B2". Rows and
// columns are counted from 0 inside the engine.

/** One cell reference, with the `$` marks that keep a part fixed when copied. */
export type CellRef = { row: number; col: number; rowAbs: boolean; colAbs: boolean }

/** "A" is 0, "AZ" is 51. */
export function columnIndex(label: string): number {
  let index = 0
  for (const letter of label.toUpperCase()) index = index * 26 + letter.charCodeAt(0) - 64
  return index - 1
}

/** 0 is "A", 51 is "AZ". */
export function columnLabel(index: number): string {
  let label = ""
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) label = String.fromCharCode(65 + ((rest - 1) % 26)) + label
  return label
}

const REF = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d{0,6})$/

/** Reads "$B12"; null when it is not reference-shaped. A reference off the grid comes back with `inGrid: false`. */
export function parseCellRef(text: string): (CellRef & { inGrid: boolean }) | null {
  const match = REF.exec(text)
  if (!match) return null
  const ref = { col: columnIndex(match[2]!), row: Number(match[4]) - 1, colAbs: match[1] === "$", rowAbs: match[3] === "$" }
  return { ...ref, inGrid: isInGrid(ref.row, ref.col) }
}

export const isInGrid = (row: number, col: number) => row >= 0 && row < SHEET_ROWS && col >= 0 && col < SHEET_COLUMNS

export function formatCellRef(ref: CellRef): string {
  return `${ref.colAbs ? "$" : ""}${columnLabel(ref.col)}${ref.rowAbs ? "$" : ""}${ref.row + 1}`
}
