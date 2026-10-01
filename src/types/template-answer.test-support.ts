import { parseTemplateContent, type TemplateContent } from "@/types/template"

const TOOLS_ID = "95000000-0000-4000-8000-000000000001"

/**
 * One form holding every structured answer kind: ticked tools that reveal a
 * note, a checklist grid, a fixed timesheet table and a log that grows.
 */
export function createStructuredAnswerContent(): TemplateContent {
  return parseTemplateContent({
    schemaVersion: 3,
    branding: {},
    layout: {},
    sections: [],
    fieldGroups: [],
    blockRules: [],
    blocks: [
      { id: TOOLS_ID, type: "dropdown_field", fieldKey: "tools", label: "Tools", required: true, placeholder: null, options: ["Ladder", "Drill", "Saw"], multiple: true },
      {
        id: "95000000-0000-4000-8000-000000000002",
        type: "text_field",
        fieldKey: "drill_note",
        label: "Drill note",
        required: true,
        visibleWhen: { sourceBlockId: TOOLS_ID, operator: "equals", value: "Drill" }
      },
      { id: "95000000-0000-4000-8000-000000000003", type: "choice_grid_field", fieldKey: "checks", label: "Checks", required: true, rows: ["Exits clear", "Lights work"], options: ["Yes", "No", "N/A"] },
      {
        id: "95000000-0000-4000-8000-000000000004",
        type: "table_field",
        fieldKey: "hours",
        label: "Hours",
        required: true,
        columns: [{ label: "Day", format: "date" }, { label: "Hours", format: "number" }, { label: "Note" }],
        rows: 2
      },
      { id: "95000000-0000-4000-8000-000000000005", type: "table_field", fieldKey: "log", label: "Log", columns: [{ label: "Item" }], rows: 1, addRows: true },
      { id: "95000000-0000-4000-8000-000000000006", type: "text_field", fieldKey: "amount", label: "Amount", format: "money", prefix: "£" },
      { id: "95000000-0000-4000-8000-000000000007", type: "text_field", fieldKey: "ref", label: "Reference", comb: 4 }
    ]
  })
}

/** A complete, valid answer set for {@link createStructuredAnswerContent}. */
export const STRUCTURED_ANSWERS = {
  tools: ["Ladder"],
  checks: { "Exits clear": "Yes", "Lights work": "N/A" },
  hours: [["2026-10-01", "7.5", "Site visit"]]
} as const
