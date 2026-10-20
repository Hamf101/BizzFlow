import { describe, expect, it } from "vitest"

import { createBlankTemplateContent, parseTemplateContent, type TemplateContent } from "@/types/template"
import { calculateTemplateAnswers } from "@/types/template-calculation"
import { createQuoteContent } from "@/types/template-calculation.test-support"
import { applyVisibleTemplateFieldValue } from "@/types/template-visibility"

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

  it("leaves a hidden worked-out answer out of the page and out of every later formula", () => {
    const content = createFeeContent()

    expect(calculateTemplateAnswers(content, { base: "100", fee: "1", total: "1" })).toEqual({ base: "100", total: "100.00" })
    expect(calculateTemplateAnswers(content, { base: "100", charged: true })).toEqual({ base: "100", charged: true, fee: "10.00", total: "110.00" })
  })

  it("shows and keeps an answer whose rule tests a worked-out one, as it is typed", () => {
    const id = (n: number): string => `74100000-0000-4000-8000-00000000000${n}`
    const field = (n: number, label: string, extra: object = {}) => ({ id: id(n), type: "text_field", fieldKey: label.toLowerCase(), label, required: false, helpText: null, placeholder: null, multiline: false, ...extra })
    const content = parseTemplateContent({
      ...createBlankTemplateContent(),
      sections: [],
      blocks: [
        field(1, "Base", { format: "number" }),
        field(2, "Doubled", { format: "number", formula: "{Base} * 2" }),
        field(3, "Details", { visibleWhen: { sourceBlockId: id(2), operator: "greater_than", value: "100" } }),
      ],
    })
    // The page holds what it last worked out: Base 40 gave 80, before Base became 60.
    const raised = applyVisibleTemplateFieldValue(content, { base: "40", doubled: "80" }, "base", "60", calculateTemplateAnswers)

    expect(raised).toEqual({ base: "60", doubled: "120" })
    expect(applyVisibleTemplateFieldValue(content, raised, "details", "Gate code 4512", calculateTemplateAnswers)).toEqual({ base: "60", doubled: "120", details: "Gate code 4512" })
    // Lowering Base hides Details and lets its answer go.
    expect(applyVisibleTemplateFieldValue(content, { ...raised, details: "x" }, "base", "10", calculateTemplateAnswers)).toEqual({ base: "10", doubled: "20" })
  })

  it("never shows a worked-out amount as minus nothing", () => {
    const quote = createQuoteContent({ 3: { ...createQuoteContent().blocks[3], formula: "{Subtotal} - {VAT} * 5 - 0.001" } })

    expect(calculateTemplateAnswers(quote, { items: [["Desk", "1", "5", ""]] })).toMatchObject({ subtotal: "5.00", vat: "1.00", total: "0.00" })
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

// A fee charged only when ticked, and a total that adds it.
function createFeeContent(): TemplateContent {
  const id = (n: number): string => `74000000-0000-4000-8000-00000000000${n}`
  const field = (n: number, label: string, extra: object) => ({ id: id(n), type: "text_field", fieldKey: label.toLowerCase(), label, required: false, helpText: null, placeholder: null, multiline: false, ...extra })

  return parseTemplateContent({
    ...createBlankTemplateContent(),
    sections: [],
    blocks: [
      field(1, "Base", { format: "money" }),
      { id: id(2), type: "checkbox_field", fieldKey: "charged", label: "Charged", required: false, helpText: null, checkedByDefault: false },
      field(3, "Fee", { format: "money", formula: "{Base} * 10%", visibleWhen: { sourceBlockId: id(2), operator: "equals", value: true } }),
      field(4, "Total", { format: "money", formula: "{Base} + {Fee}" }),
    ],
  })
}
