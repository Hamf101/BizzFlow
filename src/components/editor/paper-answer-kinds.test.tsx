import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { PaperField } from "@/components/editor/paper-field"
import { CheckboxChoices } from "@/components/ui/radio-choices"
import type { ChoiceGridFieldBlock, DropdownFieldBlock, TableFieldBlock } from "@/types/template"

import { PaperGrid, PaperTable } from "./paper-answer-kinds"

const field = { helpText: null, id: "71000000-0000-4000-8000-000000000001", required: false } as const
const grid: ChoiceGridFieldBlock = { ...field, fieldKey: "checks", label: "Checks", options: ["OK", "Defect"], rows: ["Tyres", "Lights"], type: "choice_grid_field" }
const table: TableFieldBlock = { ...field, columns: [{ label: "Date", format: "date" }, { label: "Task" }], fieldKey: "log", label: "Log", rows: 3, type: "table_field" }

// What a form posts under a name, read back as the server reads it.
function posted(markup: string, name: string): unknown {
  const input = markup.match(/<input[^>]*>/g)?.find((tag) => tag.includes(`name="${name}"`) && tag.includes('type="hidden"'))
  const value = input?.match(/value="([^"]*)"/)?.[1]

  return value === undefined ? undefined : JSON.parse(value.replaceAll("&quot;", '"'))
}

describe("answers that are more than one word", () => {
  it("post the whole answer as JSON under the document's name, or the public form's", () => {
    const noop = (): void => undefined
    const document = renderToStaticMarkup(createElement(PaperGrid, { block: grid, mode: "fill", onChange: noop, value: { Lights: "Defect", Tyres: 3 } }))
    const publicForm = renderToStaticMarkup(createElement(PaperGrid, { block: grid, mode: "fill", name: "field_checks", onChange: noop, value: { Tyres: "OK" } }))

    // A choice that is not text is no answer at all.
    expect(posted(document, "answer.json.checks")).toEqual({ Lights: "Defect" })
    expect(posted(publicForm, "field_checks")).toEqual({ Tyres: "OK" })

    const ticks = renderToStaticMarkup(
      createElement(CheckboxChoices, { label: "Days", name: "field_days", onChange: noop, options: ["Mon", "Tue"], value: ["Tue"] })
    )
    const paperTicks = renderToStaticMarkup(
      createElement(PaperField, {
        answers: { days: ["Tue", 7, "Mon"] },
        block: { ...field, fieldKey: "days", label: "Days", multiple: true, options: ["Mon", "Tue"], placeholder: null, type: "dropdown_field" } satisfies DropdownFieldBlock,
        mode: "fill",
        onAnswerChange: noop,
      })
    )

    expect(posted(ticks, "field_days")).toEqual(["Tue"])
    expect(posted(paperTicks, "answer.json.days")).toEqual(["Tue", "Mon"])
  })

  it("posts a table's rows as they were typed, padded to its length", () => {
    const noop = (): void => undefined
    const answered = [["", "Unloading"], ["2026-10-01"]]
    const fill = renderToStaticMarkup(createElement(PaperTable, { block: table, mode: "fill", onChange: noop, value: answered }))

    expect(posted(fill, "answer.json.log")).toEqual([["", "Unloading"], ["2026-10-01", ""]])
  })
})
