import { createBlankTemplateContent, parseTemplateContent, type TemplateContent } from "@/types/template"

const id = (n: number): string => `73000000-0000-4000-8000-00000000000${n}`

/**
 * A quote worked out by formulas: a cost table whose Amount is Qty times Unit
 * price, totalled; then the subtotal, VAT at 20% and the total.
 *
 * @param overrides - Blocks to put in place of the quote's, by position.
 * @returns Parsed version-three content.
 */
export function createQuoteContent(overrides: Record<number, object> = {}): TemplateContent {
  const field = (n: number, label: string, extra: object) => ({ id: id(n), type: "text_field", fieldKey: label.toLowerCase(), label, required: false, helpText: null, placeholder: null, multiline: false, ...extra })
  const blocks: object[] = [
    {
      id: id(1),
      type: "table_field",
      fieldKey: "items",
      label: "Items",
      required: false,
      helpText: null,
      rows: 3,
      columns: [
        { label: "Item" },
        { label: "Qty", format: "number" },
        { label: "Unit price", format: "money" },
        { label: "Amount", format: "money", formula: "{Qty} * {Unit price}", total: true },
      ],
    },
    field(2, "Subtotal", { format: "money", formula: "SUM({Items.Amount})" }),
    field(3, "VAT", { format: "money", formula: "{Subtotal} * 20%" }),
    field(4, "Total", { format: "money", formula: "{Subtotal} + {VAT}" }),
  ]

  return parseTemplateContent({
    ...createBlankTemplateContent(),
    sections: [],
    blocks: blocks.map((block, index) => overrides[index] ?? block),
  })
}
