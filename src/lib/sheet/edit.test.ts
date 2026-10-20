import { expect, it } from "vitest"

import { deleteTab, moveCells, moveLines, parseTsv, renameTab } from "@/lib/sheet/edit"
import { book } from "@/lib/sheet/sheet.test-support"

it("keeps every formula on its cells when rows come and go, as Excel does", () => {
  const sheet = book({ A1: 1, A2: 2, A3: 3, B1: "=SUM(A1:A3)", B2: "=$A$3*2" }, { Other: { A1: "=Sheet1!A3+Sheet1!A1" } })

  const inserted = moveLines(sheet, "t1", "row", 1, 2)!
  expect(inserted.tabs[0]!.cells).toMatchObject({ A1: { v: 1 }, A4: { v: 2 }, A5: { v: 3 }, B1: { f: "SUM(A1:A5)" }, B4: { f: "$A$5*2" } })
  expect(inserted.tabs[1]!.cells.A1).toEqual({ f: "Sheet1!A5+Sheet1!A1" })

  const deleted = moveLines(sheet, "t1", "row", 2, -1)!
  expect(deleted.tabs[0]!.cells).toMatchObject({ A2: { v: 2 }, B1: { f: "SUM(A1:A2)" }, B2: { f: "#REF!*2" } })
  expect(deleted.tabs[1]!.cells.A1).toEqual({ f: "#REF!+Sheet1!A1" })

  // A filled cell on the last row would fall off the grid, so nothing moves.
  expect(moveLines(book({ A2000: 1 }), "t1", "row", 0, 1)).toBeNull()
})

it("follows a tab's new name in formulas, and reads #REF! once it is gone", () => {
  const sheet = book({ A1: 5 }, { Totals: { A1: "=Sheet1!A1*2+'Sheet1'!A1" } })

  expect(renameTab(sheet, "t1", "Q3 plan").tabs[1]!.cells.A1).toEqual({ f: "'Q3 plan'!A1*2+'Q3 plan'!A1" })
  expect(deleteTab(sheet, "t1").tabs[0]!.cells.A1).toEqual({ f: "#REF!*2+#REF!" })
})

it("reads Excel's clipboard, quoted fields included", () => {
  expect(parseTsv('Name\tNote\r\n"Ada"\t"says ""hi""\nthen leaves"\r\n')).toEqual([
    ["Name", "Note"],
    ["Ada", 'says "hi"\nthen leaves'],
  ])
})

it("moves a cut cell's formula as written, and points what read it at its new place", () => {
  // B1 was cut, so it is already empty; C1 is where it goes.
  const sheet = book({ A1: 5, D1: "=B1+1" }, { Other: { A1: "=Sheet1!B1" } })

  const moved = moveCells(sheet, "t1", { top: 0, left: 1, bottom: 0, right: 1 }, { row: 0, col: 2 }, [[{ f: "A1*2" }]])

  expect(moved.tabs[0]!.cells).toMatchObject({ C1: { f: "A1*2" }, D1: { f: "C1+1" } })
  expect(moved.tabs[1]!.cells.A1).toEqual({ f: "Sheet1!C1" })
})
