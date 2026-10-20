import { describe, expect, it } from "vitest"

import { parseSheetContent } from "@/types/sheet"

const tab = (overrides: Record<string, unknown> = {}) => ({ id: "t1", name: "Sheet1", cells: {}, ...overrides })
const sheet = (...tabs: unknown[]) => ({ version: 1, tabs: tabs.length > 0 ? tabs : [tab()] })
const fill = (count: number, prefix = "") =>
  Object.fromEntries(Array.from({ length: count }, (_, at) => [`${prefix}${String.fromCharCode(65 + (at % 26))}${Math.floor(at / 26) + 1}`, { v: at }]))

describe("parseSheetContent", () => {
  it("accepts a sheet at every cap and returns it typed", () => {
    const text = "x".repeat(5000)
    const formula = "1".padEnd(1000, "+1").slice(0, 1000).replace(/\+$/, "")
    const content = sheet(
      tab({
        name: "Q1 – sales (draft)",
        cells: {
          A1: { v: text },
          AZ2000: { f: formula, fmt: { type: "money", decimals: 2, currency: "NGN" } },
          B2: { v: 45351, fmt: { type: "date" } },
          C3: { v: true },
          D4: { v: null },
        },
        cols: { A: 120, AZ: 64 },
        frozenRows: 1,
      }),
      ...Array.from({ length: 9 }, (_, at) => tab({ id: `t${at + 2}`, name: `Sheet${at + 2}` }))
    )

    const parsed = parseSheetContent(content)

    expect(parsed.tabs).toHaveLength(10)
    expect(parsed.tabs[0]!.cells.AZ2000).toEqual({ f: formula, fmt: { type: "money", decimals: 2, currency: "NGN" } })
  })

  it("accepts exactly 50,000 cells across tabs", () => {
    const content = sheet(tab({ cells: fill(25_000) }), tab({ id: "t2", name: "Two", cells: fill(25_000) }))

    expect(parseSheetContent(content).tabs).toHaveLength(2)
  })

  it.each([
    ["version 2", { ...sheet(), version: 2 }],
    ["no tabs", { version: 1, tabs: [] }],
    ["11 tabs", sheet(...Array.from({ length: 11 }, (_, at) => tab({ id: `t${at}`, name: `S${at}` })))],
    ["an empty tab name", sheet(tab({ name: "" }))],
    ["a 32-character tab name", sheet(tab({ name: "x".repeat(32) }))],
    ["a slash in a tab name", sheet(tab({ name: "Q1/Q2" }))],
    ["a colon in a tab name", sheet(tab({ name: "a:b" }))],
    ["a tab name opening with an apostrophe", sheet(tab({ name: "'quoted" }))],
    ["the same tab name twice, any case", sheet(tab(), tab({ id: "t2", name: "SHEET1" }))],
    ["the same tab id twice", sheet(tab(), tab({ name: "Other" }))],
    ["column BA", sheet(tab({ cells: { BA1: { v: 1 } } }))],
    ["row 2001", sheet(tab({ cells: { A2001: { v: 1 } } }))],
    ["row 0", sheet(tab({ cells: { A0: { v: 1 } } }))],
    ["a lowercase address", sheet(tab({ cells: { a1: { v: 1 } } }))],
    ["a leading-zero row", sheet(tab({ cells: { A01: { v: 1 } } }))],
    ["a 1001-character formula", sheet(tab({ cells: { A1: { f: "1".repeat(1001) } } }))],
    ["5001 characters of text", sheet(tab({ cells: { A1: { v: "x".repeat(5001) } } }))],
    ["a NaN", sheet(tab({ cells: { A1: { v: Number.NaN } } }))],
    ["an unknown cell key", sheet(tab({ cells: { A1: { v: 1, computed: 2 } } }))],
    ["an unknown format", sheet(tab({ cells: { A1: { v: 1, fmt: { type: "scientific" } } } }))],
    ["a lowercase currency code", sheet(tab({ cells: { A1: { v: 1, fmt: { type: "money", currency: "usd" } } } }))],
    ["a column width for BA", sheet(tab({ cols: { BA: 80 } }))],
    ["2001 frozen rows", sheet(tab({ frozenRows: 2001 }))],
    ["50,001 cells", sheet(tab({ cells: fill(25_000) }), tab({ id: "t2", name: "Two", cells: fill(25_001) }))],
  ])("refuses %s", (_, content) => {
    expect(() => parseSheetContent(content)).toThrow()
  })
})
