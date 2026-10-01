import { MAX_TABLE_ROWS, type TemplateBlock } from "@/types/template"

type TableBlock = Extract<TemplateBlock, { type: "table" }>

/** The most rows and columns a saved table holds. */
export { MAX_TABLE_ROWS }
export const MAX_TABLE_COLUMNS = 12

/** A change to a table's rows or columns, made from a cell. */
export type TableEdit = "column-after" | "column-before" | "delete-column" | "delete-row" | "row-after" | "row-before"

/**
 * Adds or removes a row or column beside a cell, leaving every other cell as
 * it was. A table at its limit gains nothing, and keeps its last column.
 *
 * @param table - The table.
 * @param edit - What to change.
 * @param row - The cell's row; -1 is the heading row.
 * @param column - The cell's column.
 * @returns The changed table.
 */
export function editTable(table: TableBlock, edit: TableEdit, row: number, column: number): TableBlock {
  const headers = [...table.headers]
  const rows = table.rows.map((cells) => [...cells])

  if (edit === "row-after" || edit === "row-before") {
    if (rows.length >= MAX_TABLE_ROWS) {
      return table
    }

    rows.splice(Math.max(0, edit === "row-after" ? row + 1 : row), 0, headers.map(() => ""))
  } else if (edit === "column-after" || edit === "column-before") {
    if (headers.length >= MAX_TABLE_COLUMNS) {
      return table
    }

    const index = edit === "column-after" ? column + 1 : column

    headers.splice(index, 0, `Column ${index + 1}`)
    rows.forEach((cells) => cells.splice(index, 0, ""))
  } else if (edit === "delete-row" && row >= 0) {
    rows.splice(row, 1)
  } else if (edit === "delete-column" && headers.length > 1) {
    headers.splice(column, 1)
    rows.forEach((cells) => cells.splice(column, 1))
  }

  return { ...table, headers, rows }
}
