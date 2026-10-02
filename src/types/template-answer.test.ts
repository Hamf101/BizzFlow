import { describe, expect, it } from "vitest"

import { textFieldBlockSchema, type TEXT_FORMATS } from "@/types/template"
import { normalizeTemplateAnswer } from "@/types/template-answer"

const fail = (message: string): Error => new Error(message)

const FORMATS: Record<(typeof TEXT_FORMATS)[number], { good: string[]; bad: string[] }> = {
  number: { good: ["0", "-12", "1,234,567.891"], bad: ["1,23", "1.", "--1", "1e5", "12a"] },
  money: { good: ["12.5", "-1,000.00"], bad: ["1.005", "£12"] },
  email: { good: ["ada@example.co.uk"], bad: ["ada@example", "a da@example.com", "@example.com"] },
  phone: { good: ["+44 (0)20 7946-0958", "123.456"], bad: ["12345", "1".repeat(21), "0800 CALL NOW"] },
  time: { good: ["00:00", "23:59"], bad: ["24:00", "9:30", "12:60"] },
  month: { good: ["2026-10"], bad: ["2026-13", "2026-1", "2026-10-01"] }
}

describe("typed text answers", () => {
  it.each(Object.entries(FORMATS))("checks %s answers", (format, { good, bad }) => {
    const block = textFieldBlockSchema.parse({ id: "96000000-0000-4000-8000-000000000001", type: "text_field", fieldKey: "typed", label: "Typed", format })

    for (const value of good) {
      expect(normalizeTemplateAnswer(block, ` ${value} `, fail)).toBe(value)
    }

    for (const value of bad) {
      expect(() => normalizeTemplateAnswer(block, value, fail), value).toThrow()
    }

    // Blank stays blank: a typed answer that is not required may be left empty.
    expect(normalizeTemplateAnswer(block, "  ", fail)).toBe("")
  })
})
