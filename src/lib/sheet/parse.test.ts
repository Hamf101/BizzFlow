import { describe, expect, it } from "vitest"

import { columnIndex, columnLabel } from "@/lib/sheet/a1"
import { parseFormula, shiftFormula } from "@/lib/sheet/parse"

describe("shiftFormula", () => {
  it.each([
    ["A1+B2", 1, 0, "A2+B3"],
    ["$A$1+A$1+$A1", 2, 2, "$A$1+C$1+$A3"],
    ["SUM(A1:A3)", 1, 1, "SUM(B2:B4)"],
    ['"A1"&A1', 1, 0, '"A1"&A2'],
    ['"say ""A1"""&A1', 1, 0, '"say ""A1"""&A2'],
    ["a1 + sum(b1)", 1, 0, "A2 + sum(B2)"],
    ["FOO(A1)", 1, 0, "FOO(A2)"],
    ["'My tab'!A1*2", 1, 0, "'My tab'!A2*2"],
    ["Sheet2!B1:B2", 0, 1, "Sheet2!C1:C2"],
    ["A2-A1", -1, 0, "A1-#REF!"],
    ["SUM(A1:B2)", 0, -1, "SUM(#REF!)"],
    ["Sheet2!A1+1", -1, 0, "#REF!+1"],
    ["AY1", 0, 1, "AZ1"],
    ["AZ1", 0, 1, "#REF!"],
    ["A2000", 1, 0, "#REF!"],
    ["$A$2000", 1, 0, "$A$2000"],
    ["1+", 1, 0, "1+"],
  ])("%s moved by (%i, %i) → %s", (formula, rows, columns, expected) => {
    expect(shiftFormula(formula, rows, columns)).toBe(expected)
  })
})

describe("parseFormula", () => {
  it("reads Excel precedence into its tree", () => {
    expect(parseFormula("-2^2")).toEqual({
      node: { k: "bin", op: "^", left: { k: "neg", arg: { k: "num", v: 2 } }, right: { k: "num", v: 2 } },
    })
  })

  it.each([
    ["an empty formula", ""],
    ["a formula over 1000 characters", "1".repeat(1001)],
    ["brackets nested 200 deep", "(".repeat(200) + "1" + ")".repeat(200)],
    ["a formula that stops mid-sum", "1+"],
    ["an unclosed call", "SUM(1"],
    ["an unknown character", "@A1"],
  ])("refuses %s", (_, formula) => {
    expect(parseFormula(formula)).toHaveProperty("error")
  })
})

describe("columns", () => {
  it.each([
    [0, "A"],
    [25, "Z"],
    [26, "AA"],
    [51, "AZ"],
  ])("column %i is %s", (index, label) => {
    expect(columnLabel(index)).toBe(label)
    expect(columnIndex(label)).toBe(index)
  })
})
