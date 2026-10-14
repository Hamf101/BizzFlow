import { evaluateCell } from "@/lib/sheet/evaluate"
import type { CellValue } from "@/lib/sheet/values"
import type { SheetCell, SheetContent } from "@/types/sheet"

export const NOW = new Date("2024-02-29T10:30:00Z")

type Shorthand = SheetCell | string | number | boolean | null

/** "=…" is a formula; anything else is a typed-in value. */
export function cells(entries: Record<string, Shorthand>): Record<string, SheetCell> {
  return Object.fromEntries(
    Object.entries(entries).map(([address, cell]) => [
      address,
      typeof cell === "string" && cell.startsWith("=") ? { f: cell.slice(1) } : cell !== null && typeof cell === "object" ? cell : { v: cell },
    ])
  )
}

export function book(first: Record<string, Shorthand>, others: Record<string, Record<string, Shorthand>> = {}): SheetContent {
  return {
    version: 1,
    tabs: [
      { id: "t1", name: "Sheet1", cells: cells(first) },
      ...Object.entries(others).map(([name, entries], at) => ({ id: `t${at + 2}`, name, cells: cells(entries) })),
    ],
  }
}

/** Works out one formula placed in AZ2000 beside the given cells. */
export function calc(formula: string, entries: Record<string, Shorthand> = {}, others: Record<string, Record<string, Shorthand>> = {}): CellValue {
  return evaluateCell(book({ ...entries, AZ2000: `=${formula}` }, others), "t1", "AZ2000", { now: NOW })
}

export const err = (code: string) => ({ error: code })
