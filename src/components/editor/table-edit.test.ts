import { expect, it } from "vitest"

import { editTable, MAX_TABLE_ROWS } from "@/components/editor/table-edit"

const table = { headers: ["A", "B"], id: "table", rows: [["1", "2"], ["3", "4"]], type: "table" as const }

it("adds and removes rows and columns beside a cell, leaving the other cells as they were", () => {
  expect(editTable(table, "column-after", 0, 0)).toMatchObject({ headers: ["A", "Column 2", "B"], rows: [["1", "", "2"], ["3", "", "4"]] })
  expect(editTable(table, "column-before", 0, 0)).toMatchObject({ headers: ["Column 1", "A", "B"], rows: [["", "1", "2"], ["", "3", "4"]] })
  expect(editTable(table, "row-before", 1, 0).rows).toEqual([["1", "2"], ["", ""], ["3", "4"]])
  // From the heading row, a new row starts the body.
  expect(editTable(table, "row-after", -1, 1).rows).toEqual([["", ""], ["1", "2"], ["3", "4"]])
  expect(editTable(table, "delete-column", 0, 0)).toMatchObject({ headers: ["B"], rows: [["2"], ["4"]] })
  expect(editTable(table, "delete-row", 0, 0).rows).toEqual([["3", "4"]])
})

it("keeps a table within what a saved one may hold", () => {
  const single = { ...table, headers: ["A"], rows: [["1"]] }
  const full = { ...table, rows: Array.from({ length: MAX_TABLE_ROWS }, () => ["", ""]) }

  expect(editTable(single, "delete-column", 0, 0)).toEqual(single)
  expect(editTable(table, "delete-row", -1, 0)).toEqual(table)
  expect(editTable(full, "row-after", 99, 0)).toBe(full)
})
