import { createQuoteContent } from "@/types/template-calculation.test-support"
import { describe, expect, it } from "vitest"

import { formatDateAnswer } from "@/lib/date-format"

import {
  fitRuns,
  createBlankTemplateContent,
  MAX_TEMPLATE_BLOCK_COUNT,
  parseTemplateContent,
  templateBlockSchema,
  templateContentV3Schema,
  upgradeV2TemplateContentToV3,
  type TemplateContentV2
} from "./template"

const FIRST_BLOCK_ID = "50000000-0000-4000-8000-000000000001"
const SECOND_BLOCK_ID = "50000000-0000-4000-8000-000000000002"
const THIRD_BLOCK_ID = "50000000-0000-4000-8000-000000000003"
const GROUP_ID = "50000000-0000-4000-8000-000000000004"

describe("template content schema", () => {
  it("dual-reads immutable version-two content without upgrading it", () => {
    const versionTwo = createVersionTwoContent()
    const parsed = parseTemplateContent(versionTwo)

    expect(parsed).toEqual(versionTwo)
    expect(parsed.schemaVersion).toBe(2)
    expect("layout" in parsed).toBe(false)
  })

  it("upgrades version two explicitly and idempotently at an editable boundary", () => {
    const upgraded = upgradeV2TemplateContentToV3(createVersionTwoContent())

    expect(upgraded).toMatchObject({
      schemaVersion: 3,
      sections: [
        {
          id: FIRST_BLOCK_ID,
          label: "Section 1",
          startBlockId: FIRST_BLOCK_ID,
          pageBreakBefore: false,
          keepTogether: false
        }
      ]
    })
    expect(upgradeV2TemplateContentToV3(upgraded)).toBe(upgraded)
  })

  it("allows an authoring draft dropdown to start without choices", () => {
    const content = createBlankTemplateContent()
    content.blocks.push({
      id: FIRST_BLOCK_ID,
      type: "dropdown_field",
      fieldKey: "department",
      label: "Department",
      required: false,
      helpText: null,
      placeholder: "Select a department",
      options: []
    })
    content.sections.push({
      id: FIRST_BLOCK_ID,
      label: "Section 1",
      startBlockId: FIRST_BLOCK_ID,
      pageBreakBefore: false,
      keepTogether: false
    })

    expect(parseTemplateContent(content).blocks[0]).toMatchObject({
      type: "dropdown_field",
      options: []
    })
  })

  // A 50-page document fits well inside the cap; long-document.test.ts proves that.
  it("accepts a document at the block cap and refuses one block more, saying so", () => {
    expect(parseTemplateContent(createContentWithParagraphs(MAX_TEMPLATE_BLOCK_COUNT)).blocks).toHaveLength(MAX_TEMPLATE_BLOCK_COUNT)
    expect(() => parseTemplateContent(createContentWithParagraphs(MAX_TEMPLATE_BLOCK_COUNT + 1))).toThrow(
      `Template content cannot contain more than ${MAX_TEMPLATE_BLOCK_COUNT} blocks.`
    )
  })

  it("accepts ordered sections, contiguous groups, pagination rules, and visibility", () => {
    const content = createConditionalContent()

    expect(templateContentV3Schema.safeParse(content).success).toBe(true)
  })

  it("rejects duplicate structure ids and groups that cross sections", () => {
    const content = createConditionalContent()
    content.sections.push({
      ...content.sections[0],
      startBlockId: THIRD_BLOCK_ID
    })
    content.fieldGroups[0] = {
      ...content.fieldGroups[0],
      endBlockId: THIRD_BLOCK_ID
    }

    const result = templateContentV3Schema.safeParse(content)

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Every section must have a unique stable id.",
        "A field group cannot cross a section boundary."
      ])
    )
  })

  it("lets a section start partway down, leaving the fields above it outside any section", () => {
    const content = createConditionalContent()
    content.sections = [
      {
        id: THIRD_BLOCK_ID,
        label: "Notes",
        startBlockId: THIRD_BLOCK_ID,
        pageBreakBefore: true,
        keepTogether: false
      }
    ]

    expect(templateContentV3Schema.safeParse(content).error?.issues).toBeUndefined()
  })

  it("refuses a condition that could never be tested: the wrong comparison for its source, a value where none belongs, or too many rules", () => {
    const id = (n: number): string => `72000000-0000-4000-8000-00000000000${n}`
    const text = (n: number, extra: object = {}) => ({ id: id(n), type: "text_field", fieldKey: `t${n}`, label: `T${n}`, required: false, helpText: null, placeholder: null, multiline: false, ...extra })
    const base = [
      text(1, { format: "number" }),
      text(2),
      { id: id(3), type: "signature_field", fieldKey: "sign", label: "Sign", required: false, helpText: null },
      { id: id(4), type: "checkbox_field", fieldKey: "ok", label: "OK", required: false, helpText: null, checkedByDefault: false },
    ]
    const parses = (visibleWhen: object): boolean => {
      const content = createBlankTemplateContent()

      content.blocks = [...base, { id: id(9), type: "paragraph", text: "Shown by a rule", alignment: "left", visibleWhen }] as never
      content.sections = []
      return templateContentV3Schema.safeParse(content).success
    }
    const rule = (n: number, operator: string, value?: string | boolean) => ({ sourceBlockId: id(n), operator, ...(value === undefined ? {} : { value }) })

    expect(parses(rule(1, "greater_than", "10.5"))).toBe(true)
    expect(parses({ match: "any", conditions: [rule(2, "answered"), rule(4, "not_equals", true)] })).toBe(true)
    // More or less than needs a number field and a number.
    expect(parses(rule(2, "greater_than", "10"))).toBe(false)
    expect(parses(rule(1, "less_than", "ten"))).toBe(false)
    // Answered takes no value; equals needs one; a tick box is ticked or not.
    expect(parses(rule(2, "answered", "x"))).toBe(false)
    expect(parses(rule(2, "equals"))).toBe(false)
    expect(parses(rule(4, "answered"))).toBe(false)
    // A signature is never compared.
    expect(parses(rule(3, "answered"))).toBe(false)
    // Combined rules are two to four.
    expect(parses({ match: "all", conditions: [rule(2, "answered")] })).toBe(false)
    expect(parses({ match: "all", conditions: Array.from({ length: 5 }, () => rule(2, "answered")) })).toBe(false)
  })

  it("works out answers only by a formula it can run: earlier numbers and amounts, a column to the left, a whole column only inside SUM", () => {
    const quote = createQuoteContent()
    const table = quote.blocks[0] as object
    const parses = (overrides: Record<number, object>): boolean => {
      try {
        createQuoteContent(overrides)
        return true
      } catch {
        return false
      }
    }
    const field = (index: number, extra: object) => ({ ...(quote.blocks[index] as object), ...extra })
    const column = (extra: object) => ({ ...table, columns: [...(table as { columns: object[] }).columns.slice(0, 3), { label: "Amount", format: "money", ...extra }] })

    expect(quote.blocks).toHaveLength(4)
    expect(parses({ 3: field(3, { formula: "ROUND(MAX({Subtotal}, {VAT}) / 3, 2)" }) })).toBe(true)
    // Only a number or amount is worked out, on one line.
    expect(parses({ 1: field(1, { format: undefined }) })).toBe(false)
    expect(parses({ 1: field(1, { multiline: true }) })).toBe(false)
    // A formula names what comes before it, and so never itself.
    expect(parses({ 2: field(2, { formula: "{Total} * 20%" }) })).toBe(false)
    expect(parses({ 2: field(2, { formula: "{VAT} + 1" }) })).toBe(false)
    expect(parses({ 2: field(2, { formula: "{Postage}" }) })).toBe(false)
    expect(parses({ 2: field(2, { formula: "{Items.Amount} * 2" }) })).toBe(false)
    expect(parses({ 2: field(2, { formula: "{Subtotal} *" }) })).toBe(false)
    // A column works from the columns to its left; words are no number.
    expect(parses({ 0: column({ formula: "{Amount} * 2" }) })).toBe(false)
    expect(parses({ 0: column({ formula: "{Item} * 2" }) })).toBe(false)
    expect(parses({ 0: column({ format: "date", formula: "{Qty}" }) })).toBe(false)
    expect(parses({ 0: column({ format: undefined, total: true, formula: undefined }) })).toBe(false)
  })

  it("rejects later, self, or incompatible visibility sources", () => {
    const content = createConditionalContent()
    const source = content.blocks[0]
    const target = content.blocks[1]

    if (
      source?.type !== "checkbox_field" ||
      target?.type !== "dropdown_field"
    ) {
      throw new Error("Expected conditional field fixtures.")
    }

    source.visibleWhen = {
      sourceBlockId: target.id,
      operator: "equals",
      value: "Approved"
    }
    target.visibleWhen = {
      sourceBlockId: target.id,
      operator: "equals",
      value: "Approved"
    }

    const result = templateContentV3Schema.safeParse(content)

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "A visibility source must appear before the conditional field.",
        "A field cannot control its own visibility."
      ])
    )
  })
})

function createContentWithParagraphs(
  blockCount: number
): ReturnType<typeof createBlankTemplateContent> {
  const content = createBlankTemplateContent()

  content.blocks = Array.from({ length: blockCount }, (_, index) => ({
    id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    type: "paragraph" as const,
    text: `Paragraph ${index + 1}`,
    alignment: "left" as const
  }))
  content.sections =
    blockCount === 0
      ? []
      : [
          {
            id: content.blocks[0]?.id ?? FIRST_BLOCK_ID,
            label: "Section 1",
            startBlockId: content.blocks[0]?.id ?? FIRST_BLOCK_ID,
            pageBreakBefore: false,
            keepTogether: false
          }
        ]

  return content
}

function createVersionTwoContent(): TemplateContentV2 {
  return {
    schemaVersion: 2,
    branding: {
      organizationName: "",
      logoAsset: null,
      logoDataUrl: null,
      logoAlignment: "left",
      logoWidthPercent: 24,
      primaryColor: "#252329",
      accentColor: "#635273"
    },
    blocks: [
      {
        id: FIRST_BLOCK_ID,
        type: "paragraph",
        text: "Legacy snapshot",
        alignment: "left"
      }
    ]
  }
}

function createConditionalContent() {
  const content = createBlankTemplateContent()
  content.blocks = [
    {
      id: FIRST_BLOCK_ID,
      type: "checkbox_field",
      fieldKey: "approved",
      label: "Approved",
      required: false,
      helpText: null,
      checkedByDefault: false
    },
    {
      id: SECOND_BLOCK_ID,
      type: "dropdown_field",
      fieldKey: "department",
      label: "Department",
      required: false,
      helpText: null,
      placeholder: null,
      options: ["Sales", "Support"],
      visibleWhen: {
        sourceBlockId: FIRST_BLOCK_ID,
        operator: "equals",
        value: true
      }
    },
    {
      id: THIRD_BLOCK_ID,
      type: "text_field",
      fieldKey: "notes",
      label: "Notes",
      required: false,
      helpText: null,
      placeholder: null,
      multiline: true
    }
  ]
  content.sections = [
    {
      id: FIRST_BLOCK_ID,
      label: "Approval details",
      startBlockId: FIRST_BLOCK_ID,
      pageBreakBefore: false,
      keepTogether: true
    }
  ]
  content.fieldGroups = [
    {
      id: GROUP_ID,
      label: "Approval fields",
      startBlockId: FIRST_BLOCK_ID,
      endBlockId: SECOND_BLOCK_ID,
      columns: 2,
      keepTogether: true
    }
  ]
  content.blockRules = [
    {
      blockId: THIRD_BLOCK_ID,
      pageBreakBefore: true,
      keepWithNext: false
    }
  ]

  return content
}

describe("date field formats", () => {
  it("writes a stored date in any order, separator and month style, and leaves anything else alone", () => {
    const write = (order: "dmy" | "mdy" | "ymd", separator: "/" | "." | "-" | " ", month: "number" | "short" | "long") =>
      formatDateAnswer("2026-09-02", { month, order, separator })

    expect([
      write("dmy", "/", "number"),
      write("mdy", "/", "number"),
      write("ymd", "-", "number"),
      write("dmy", ".", "number"),
      write("dmy", " ", "long"),
      write("mdy", " ", "short"),
      write("ymd", " ", "long"),
    ]).toEqual([
      "02/09/2026",
      "09/02/2026",
      "2026-09-02",
      "02.09.2026",
      "2 September 2026",
      "Sep 2, 2026",
      "2026 September 2",
    ])
    // A field saved before formats existed prints as it always has.
    expect(formatDateAnswer("2026-09-02", undefined)).toBe("2026-09-02")
    expect(formatDateAnswer("", { month: "number", order: "dmy", separator: "/" })).toBe("")
    expect(formatDateAnswer("next Tuesday", { month: "number", order: "dmy", separator: "/" })).toBe("next Tuesday")
  })

  it("keeps a date field's format through a save", () => {
    const content = createBlankTemplateContent()
    const saved = parseTemplateContent({
      ...content,
      blocks: [
        {
          dateFormat: { month: "number", order: "dmy", separator: "/" },
          fieldKey: "move_in",
          helpText: null,
          id: FIRST_BLOCK_ID,
          label: "Move-in date",
          required: true,
          type: "date_field",
        },
      ],
    })

    expect(saved.blocks[0]).toMatchObject({ dateFormat: { month: "number", order: "dmy", separator: "/" }, type: "date_field" })
  })
})

describe("formatted text", () => {
  const paragraph = (text: string, runs: unknown) =>
    templateBlockSchema.parse({ id: FIRST_BLOCK_ID, runs, text, type: "paragraph" })

  it("keeps a paragraph's formatting while it spells out the text, trimmed and tidied the same way", () => {
    const block = paragraph("  Pay within 30 days.  ", [
      { text: "  Pay " },
      { bold: true, text: "within" },
      { bold: true, text: " 30 days" },
      { text: ".  " },
    ])

    expect(block).toMatchObject({
      runs: [{ text: "Pay " }, { bold: true, text: "within 30 days" }, { text: "." }],
      text: "Pay within 30 days.",
    })
  })

  it("tidies formatting as it is typed, keeping the spaces a person is still typing around", () => {
    expect(fitRuns("Pay now ", [{ bold: true, text: "Pay" }, { text: " now" }, { text: " " }])).toEqual([
      { bold: true, text: "Pay" },
      { text: " now " },
    ])
    expect(fitRuns(" Pay", [{ text: " " }, { italic: true, text: "Pay" }])).toEqual([{ text: " " }, { italic: true, text: "Pay" }])
  })

  it("lets go of formatting once the text changes without it, or when none of it is formatted", () => {
    expect(paragraph("Pay later.", [{ bold: true, text: "Pay now." }])).not.toHaveProperty("runs")
    expect(paragraph("Pay now.", [{ text: "Pay " }, { text: "now." }])).not.toHaveProperty("runs")
  })

  it("links only to web and email addresses", () => {
    expect(() => paragraph("Pay", [{ link: "javascript:alert(1)", text: "Pay" }])).toThrow()
    expect(paragraph("Pay", [{ link: "mailto:billing@example.com", text: "Pay" }])).toMatchObject({
      runs: [{ link: "mailto:billing@example.com", text: "Pay" }],
    })
  })

  it("keeps each list item's formatting beside it, and lets go when the items change", () => {
    const list = (items: string[]) =>
      templateBlockSchema.parse({
        id: FIRST_BLOCK_ID,
        itemRuns: [[{ bold: true, text: "Weekly" }, { text: " visit" }], null],
        items,
        type: "bullet_list",
      })

    expect(list(["Weekly visit", "Deep clean"])).toMatchObject({
      itemRuns: [[{ bold: true, text: "Weekly" }, { text: " visit" }], null],
    })
    expect(list(["Weekly visit"])).not.toHaveProperty("itemRuns")
  })
})


describe("answer kinds", () => {
  const field = { id: FIRST_BLOCK_ID, fieldKey: "answer", label: "Answer", required: false, helpText: null }
  const parses = (block: object): boolean => templateBlockSchema.safeParse(block).success

  it("takes typed text with units, comb boxes, choose-several choices, question grids and fillable tables", () => {
    expect(parses({ ...field, type: "text_field", format: "money", prefix: "£", suffix: "per month" })).toBe(true)
    // A question long enough for a declaration read out in full.
    expect(parses({ ...field, type: "checkbox_field", label: "x".repeat(300) })).toBe(true)
    expect(parses({ ...field, type: "text_field", comb: 9 })).toBe(true)
    expect(parses({ ...field, type: "dropdown_field", options: ["Email", "Phone"], multiple: true, across: true })).toBe(true)
    expect(parses({ ...field, type: "choice_grid_field", rows: ["Staff were helpful", "The room was clean"], options: ["Yes", "No", "N/A"] })).toBe(true)
    expect(
      parses({ ...field, type: "table_field", columns: [{ label: "Date", format: "date" }, { label: "Hours", format: "number" }, { label: "Task" }], rows: 7, addRows: true })
    ).toBe(true)
  })

  it("refuses shapes that cannot be filled in or printed", () => {
    expect(parses({ ...field, type: "checkbox_field", label: "x".repeat(301) })).toBe(false)
    // Comb boxes hold one line of characters.
    expect(parses({ ...field, type: "text_field", comb: 9, multiline: true })).toBe(false)
    expect(parses({ ...field, type: "text_field", comb: 1 })).toBe(false)
    expect(parses({ ...field, type: "text_field", suffix: "x".repeat(25) })).toBe(false)
    expect(parses({ ...field, type: "text_field", format: "script" })).toBe(false)
    // A grid's rows name its answers, so each is said once; it needs two columns to choose between.
    expect(parses({ ...field, type: "choice_grid_field", rows: ["Clean", "clean "], options: ["Yes", "No"] })).toBe(false)
    expect(parses({ ...field, type: "choice_grid_field", rows: ["Clean"], options: ["Yes"] })).toBe(false)
    expect(parses({ ...field, type: "choice_grid_field", rows: Array.from({ length: 41 }, (_, i) => `Row ${i}`), options: ["Yes", "No"] })).toBe(false)
    expect(parses({ ...field, type: "table_field", columns: Array.from({ length: 9 }, (_, i) => ({ label: `C${i}` })), rows: 3 })).toBe(false)
    expect(parses({ ...field, type: "table_field", columns: [{ label: "Item" }], rows: 0 })).toBe(false)
    expect(parses({ ...field, type: "table_field", columns: [{ label: "Item" }], rows: 51 })).toBe(false)
  })
})
