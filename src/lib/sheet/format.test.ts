import { describe, expect, it } from "vitest"

import { formatCellValue } from "@/lib/sheet/format"

describe("formatCellValue", () => {
  it.each([
    [1234.5, undefined, "1234.5"],
    [1 / 3, undefined, "0.333333333333333"],
    [1e20, undefined, "1E+20"],
    [1234.5, { type: "number" }, "1,234.50"],
    [1234.5, { type: "number", decimals: 0 }, "1,235"],
    [1234.5, { type: "money", currency: "USD" }, "$1,234.50"],
    [1234.5, { type: "money" }, "₦1,234.50"],
    [0.256, { type: "percent" }, "26%"],
    [0.256, { type: "percent", decimals: 1 }, "25.6%"],
    [45351, { type: "date" }, "Feb 29, 2024"],
    [60, { type: "date" }, "Feb 29, 1900"],
    [-1, { type: "date" }, "-1"],
    [12, { type: "text" }, "12"],
    ["Paid", { type: "money" }, "Paid"],
    [true, undefined, "TRUE"],
    [null, { type: "number" }, ""],
    [{ error: "#N/A" as const }, { type: "number" }, "#N/A"],
  ] as const)("%j as %j → %s", (value, fmt, expected) => {
    expect(formatCellValue(value, fmt, { locale: "en-US", currency: "NGN" })).toBe(expected)
  })

  it("follows the locale it is given", () => {
    expect(formatCellValue(1234.5, { type: "number" }, { locale: "de-DE", currency: "EUR" })).toBe("1.234,50")
    expect(formatCellValue(1234.5, undefined, { locale: "de-DE", currency: "EUR" })).toBe("1234,5")
    expect(formatCellValue(45351, { type: "date" }, { locale: "en-GB", currency: "GBP" })).toBe("29 Feb 2024")
  })
})
