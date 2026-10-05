import { describe, expect, it } from "vitest"

import { calculateTemplateAnswers } from "@/types/template-calculation"
import { createQuoteContent } from "@/types/template-calculation.test-support"

describe("template calculations", () => {
  it("works out a quote in decimals as an invoice does: each line to the penny, half up, then the tax on the subtotal", () => {
    const answers = calculateTemplateAnswers(createQuoteContent(), {
      // Whatever a browser sends for a worked-out answer is replaced.
      items: [["Desk", "2.5", "10.01", "999"], ["Chair", "3", "0.10", ""], ["Note only", "", "", ""]],
      subtotal: "1",
      total: "1,000,000",
    })

    // 2.5 x 10.01 is 25.025, so 25.03 half up; 3 x 0.10 is 0.30, not 0.30000000000000004.
    expect(answers.items).toEqual([["Desk", "2.5", "10.01", "25.03"], ["Chair", "3", "0.10", "0.30"], ["Note only", "", "", ""]])
    // 20% of 25.33 is 5.066.
    expect(answers).toMatchObject({ subtotal: "25.33", vat: "5.07", total: "30.40" })
  })

  it("leaves a worked-out answer blank until something it names is answered, and when it would divide by nothing", () => {
    expect(calculateTemplateAnswers(createQuoteContent(), {})).toEqual({ subtotal: "", vat: "", total: "" })
    // Thousands commas are read; a blank answer counts as nothing.
    expect(calculateTemplateAnswers(createQuoteContent(), { items: [["Desk", "1,000", "2", ""]] })).toMatchObject({ subtotal: "2000.00", total: "2400.00" })

    const quote = createQuoteContent({ 3: { ...createQuoteContent().blocks[3], format: "number", formula: "{Subtotal} / ({VAT} - {VAT})" } })

    expect(calculateTemplateAnswers(quote, { items: [["Desk", "1", "5", ""]] })).toMatchObject({ vat: "1.00", total: "" })
  })

  it("gives up on numbers too long to be real, at once, rather than working them out", () => {
    const quote = createQuoteContent({ 3: { ...createQuoteContent().blocks[3], formula: Array.from({ length: 35 }, () => "{Subtotal}").join(" * ") } })
    const huge = "9".repeat(20_000)
    const started = performance.now()
    const answers = calculateTemplateAnswers(quote, { items: [["Desk", huge, huge, ""]] })

    expect(answers).toMatchObject({ subtotal: "", total: "" })
    expect(performance.now() - started).toBeLessThan(500)
  })
})
