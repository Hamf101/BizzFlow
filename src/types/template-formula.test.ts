import { describe, expect, it } from "vitest"

import { formulaReferences, parseFormula } from "@/types/template-formula"

describe("template formulas", () => {
  it("reads a spreadsheet formula: references, + - * / and %, brackets, and functions in any case", () => {
    expect(parseFormula("{Qty} * {Unit price}")).toEqual({
      node: { kind: "binary", op: "*", left: { kind: "ref", name: "Qty" }, right: { kind: "ref", name: "Unit price" } },
    })
    // Multiplying binds tighter than adding; 20% is a fifth.
    expect(parseFormula(" {Subtotal} + {Subtotal}*20% ")).toEqual({
      node: {
        kind: "binary",
        op: "+",
        left: { kind: "ref", name: "Subtotal" },
        right: {
          kind: "binary",
          op: "*",
          left: { kind: "ref", name: "Subtotal" },
          right: { kind: "binary", op: "/", left: { kind: "number", value: "20" }, right: { kind: "number", value: "100" } },
        },
      },
    })
    expect(parseFormula("-(1 - 2) / 4")).toEqual({
      node: {
        kind: "binary",
        op: "/",
        left: { kind: "negate", arg: { kind: "binary", op: "-", left: { kind: "number", value: "1" }, right: { kind: "number", value: "2" } } },
        right: { kind: "number", value: "4" },
      },
    })

    const total = parseFormula("round(SUM({Items.Amount}, {Delivery}), 2)")

    expect(total).toEqual({
      node: {
        kind: "call",
        name: "ROUND",
        args: [
          { kind: "call", name: "SUM", args: [{ kind: "ref", name: "Items.Amount" }, { kind: "ref", name: "Delivery" }] },
          { kind: "number", value: "2" },
        ],
      },
    })
    expect("node" in total ? formulaReferences(total.node) : []).toEqual(["Items.Amount", "Delivery"])
  })

  it("refuses anything outside the grammar with a reason, never by throwing", () => {
    const refused = [
      "",
      "{Qty} *",
      "{Qty} {Price}",
      "SUM(",
      "SUM({Qty}",
      "FETCH({Qty})",
      "alert(1)",
      "{}",
      "{Qty",
      "1..2",
      "1,000",
      "{Qty} ^ 2",
      "constructor",
      "ROUND()",
      "ABS(1, 2)",
      "x".repeat(501),
      `${"(".repeat(5000)}1${")".repeat(5000)}`,
    ]

    for (const formula of refused) {
      const result = parseFormula(formula)

      expect(result, formula.slice(0, 40)).toHaveProperty("error")
      expect("error" in result && result.error.length > 0).toBe(true)
    }
  })
})
