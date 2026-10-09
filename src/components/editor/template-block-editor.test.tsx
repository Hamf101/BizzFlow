// @vitest-environment jsdom

import { act, type ReactElement, useEffect, useState } from "react"
import { expect, it } from "vitest"

import { TemplateBlockEditor } from "@/components/editor/template-block-editor"
import { createBlankTemplateContent, type TemplateBlock, type TemplateContentV3 } from "@/types/template"
import { updateTemplateBlock } from "@/types/template-structure"
import { mount } from "@/test/render"

const UNIT_ID = "30000000-0000-4000-8000-000000000001"
const PETS_ID = "30000000-0000-4000-8000-000000000002"

let blocks: readonly TemplateBlock[] = []

function Harness({ editing = 0 }: { editing?: number }): ReactElement {
  const [content, setContent] = useState<TemplateContentV3>(() => ({
    ...createBlankTemplateContent(),
    blocks: [
      { fieldKey: "unit_type", helpText: null, id: UNIT_ID, label: "Unit type", options: ["Studio", "1 bed"], placeholder: null, required: false, type: "dropdown_field" },
      { fieldKey: "pet_details", helpText: null, id: PETS_ID, label: "Pet details", multiline: false, placeholder: null, required: false, type: "text_field", visibleWhen: { operator: "equals", sourceBlockId: UNIT_ID, value: "Studio" } },
    ],
  }))
  useEffect(() => {
    blocks = content.blocks
  })

  return (
    <TemplateBlockEditor
      block={content.blocks[editing] as TemplateBlock}
      blocks={content.blocks}
      canMoveDown
      canMoveUp={false}
      onChange={(block: TemplateBlock): void => setContent((current) => updateTemplateBlock(current, block))}
      onDelete={() => undefined}
      onMoveDown={() => undefined}
      onMoveUp={() => undefined}
    />
  )
}

it("applies dropdown options as they are typed, and keeps one a rule needs until it is renamed", async () => {
  await act(async () => mount().render(<Harness />))

  typeInto(option(2), "1 bedroom")
  expect(saved("dropdown_field").options).toEqual(["Studio", "1 bedroom"])

  // A new, still empty option stays on screen while its neighbours change.
  await act(async () => button("Add option").click())
  typeInto(option(2), "One bedroom")
  expect(saved("dropdown_field").options).toEqual(["Studio", "One bedroom"])
  expect(document.querySelectorAll('input[aria-label^="Option "]')).toHaveLength(3)

  // Pet details shows only for a studio, so clearing that option cannot remove it.
  typeInto(option(1), "")
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Affected fields: Pet details.")
  expect(saved("dropdown_field").options).toEqual(["Studio", "One bedroom"])

  // Naming it again renames it, and the rule follows.
  typeInto(option(1), "Studio flat")
  expect(saved("dropdown_field").options).toEqual(["Studio flat", "One bedroom"])
  expect(saved("text_field").visibleWhen?.value).toBe("Studio flat")
  expect(document.querySelector('[role="alert"]')).toBeNull()
})

it("lets a count of character boxes from 10 to 19 be typed through its first digit", async () => {
  await act(async () => mount().render(<Harness editing={1} />))
  const boxes = document.getElementById(`${PETS_ID}-comb`) as HTMLInputElement

  typeInto(boxes, "1")
  expect(boxes.value).toBe("1")
  typeInto(boxes, "12")
  expect(saved("text_field").comb).toBe(12)
})

function saved<Type extends TemplateBlock["type"]>(type: Type): Extract<TemplateBlock, { type: Type }> {
  return blocks.find((block) => block.type === type) as Extract<TemplateBlock, { type: Type }>
}

function option(position: number): HTMLInputElement {
  const input = document.querySelector(`input[aria-label="Option ${position}"]`)

  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Expected option ${position} to be editable.`)
  }

  return input
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name)

  if (!found) {
    throw new Error(`Expected a "${name}" button.`)
  }

  return found
}

function typeInto(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
