import { describe, expect, it } from "vitest"

import {
  convertTextBlock,
  insertPageAfter,
  liftListItem,
  mergeIntoPrevious,
  normalizeContentForSave,
  readMarkdownShortcut,
  removePageBreak,
  splitTextBlock,
} from "@/components/editor/editor-content"
import {
  createEmptyDocumentContent,
  templateContentV3Schema,
  type TemplateBlock,
  type TemplateContentV3,
} from "@/types/template"

const A = "70000000-0000-4000-8000-000000000001"
const B = "70000000-0000-4000-8000-000000000002"
const C = "70000000-0000-4000-8000-000000000003"

function page(blocks: TemplateBlock[]): TemplateContentV3 {
  return { ...createEmptyDocumentContent(), blocks }
}

const texts = (content: TemplateContentV3): string[] =>
  content.blocks.map((block) => ("text" in block ? block.text : block.type))

describe("typing on the page", () => {
  it("splits at the caret on Enter, and opens a line above a heading when the caret is at its start", () => {
    const paragraph = page([{ id: A, type: "paragraph", text: "Rent is due monthly", alignment: "left" }])
    const split = splitTextBlock(paragraph, A, 11, B)

    expect(texts(split.content)).toEqual(["Rent is due", " monthly"])
    expect(split.focus).toEqual({ blockId: B, offset: 0 })

    const heading = page([{ id: A, type: "heading", text: "Terms", level: 2, alignment: "left" }])
    const above = splitTextBlock(heading, A, 0, B)

    expect(above.content.blocks.map((block) => block.type)).toEqual(["paragraph", "heading"])
    expect(texts(above.content)).toEqual(["", "Terms"])
    expect(above.focus).toEqual({ blockId: A, offset: 0 })
  })

  it("joins a line into the one above on Backspace, and removes an empty line after a field", () => {
    const joined = mergeIntoPrevious(
      page([
        { id: A, type: "heading", text: "Deposit", level: 2, alignment: "left" },
        { id: B, type: "paragraph", text: " terms", alignment: "left" },
      ]),
      B
    )

    expect(texts(joined.content)).toEqual(["Deposit terms"])
    expect(joined.focus).toEqual({ blockId: A, offset: 7 })

    const afterField = mergeIntoPrevious(
      page([
        { id: A, type: "date_field", fieldKey: "start", label: "Start", required: false, helpText: null },
        { id: B, type: "paragraph", text: "", alignment: "left" },
      ]),
      B
    )

    expect(afterField.content.blocks.map((block) => block.id)).toEqual([A])
    expect(afterField.select).toBe(A)
  })

  it("turns typed markdown into headings and lists", () => {
    expect(readMarkdownShortcut("## ")).toEqual({ type: "heading", level: 2 })
    expect(readMarkdownShortcut("- ")).toEqual({ type: "bullet_list" })
    expect(readMarkdownShortcut("1. ")).toEqual({ type: "numbered_list" })
    expect(readMarkdownShortcut("#hashtag")).toBeNull()
  })

  it("adds a page after a block, and taking the break away keeps what was typed", () => {
    const content = page([{ id: A, type: "paragraph", text: "Page one", alignment: "left" }])
    const added = insertPageAfter(content, A, B)

    expect(texts(added)).toEqual(["Page one", ""])
    expect(added.blockRules).toEqual([{ blockId: B, pageBreakBefore: true, keepWithNext: false }])

    const typed = { ...added, blocks: added.blocks.map((block) => block.id === B ? { ...block, text: "Page two" } : block) }
    const joined = removePageBreak(typed, B)

    expect(texts(joined)).toEqual(["Page one", "Page two"])
    expect(joined.blockRules).toEqual([])
  })

  it("saves what was typed as valid content, whatever state the lines were left in", () => {
    const content = page([
      { id: A, type: "heading", text: "", level: 1, alignment: "left" },
      { id: B, type: "bullet_list", items: ["Keys", "", "  "] },
      { id: C, type: "numbered_list", items: [""] },
    ])
    const saved = normalizeContentForSave(content)

    expect(saved.blocks).toEqual([
      { id: A, type: "paragraph", text: "", alignment: "left" },
      { id: B, type: "bullet_list", items: ["Keys"] },
      { id: C, type: "paragraph", text: "", alignment: "left" },
    ])
    expect(templateContentV3Schema.safeParse(saved).success).toBe(true)
  })
})

describe("formatting as lines split and join", () => {
  it("keeps each word's formatting when Enter splits a line, and when Backspace joins it back", () => {
    const content = page([
      { alignment: "left", id: A, runs: [{ text: "Rent is " }, { bold: true, text: "due monthly" }], text: "Rent is due monthly", type: "paragraph" },
    ])
    const split = splitTextBlock(content, A, 11, B)

    expect(split.content.blocks).toMatchObject([
      { runs: [{ text: "Rent is " }, { bold: true, text: "due" }], text: "Rent is due" },
      { runs: [{ bold: true, text: " monthly" }], text: " monthly" },
    ])
    expect(mergeIntoPrevious(split.content, B).content.blocks).toEqual(content.blocks)
  })

  it("keeps formatting when a line becomes a list and back, and saves it beside the items that stay", () => {
    const line = page([
      { alignment: "left", id: A, runs: [{ italic: true, text: "Keys" }, { text: " returned" }], text: "Keys returned", type: "paragraph" },
    ])
    const list = convertTextBlock(line, A, { type: "bullet_list" }).content

    expect(list.blocks).toEqual([
      { id: A, itemRuns: [[{ italic: true, text: "Keys" }, { text: " returned" }]], items: ["Keys returned"], type: "bullet_list" },
    ])
    expect(convertTextBlock(list, A, { type: "paragraph" }).content.blocks).toEqual(line.blocks)
    expect(
      normalizeContentForSave(
        page([{ id: B, itemRuns: [null, [{ bold: true, text: "Deep clean " }]], items: ["", "Deep clean "], type: "bullet_list" }])
      ).blocks
    ).toEqual([{ id: B, itemRuns: [[{ bold: true, text: "Deep clean" }]], items: ["Deep clean"], type: "bullet_list" }])
  })
})

describe("lifting a list item out", () => {
  const list = page([
    {
      id: A,
      itemRuns: [null, [{ bold: true, text: "Deep" }, { text: " clean" }], null],
      items: ["Weekly visit", "Deep clean", "Windows"],
      type: "bullet_list",
    },
  ])

  it("turns just that item into a line where it stands, keeping the list around it", () => {
    const lifted = liftListItem(list, A, 1, { level: 2, type: "heading" }, [B, C])

    expect(lifted.content.blocks).toEqual([
      { id: A, items: ["Weekly visit"], type: "bullet_list" },
      { alignment: "left", id: B, level: 2, runs: [{ bold: true, text: "Deep" }, { text: " clean" }], text: "Deep clean", type: "heading" },
      { id: C, items: ["Windows"], type: "bullet_list" },
    ])
    expect(lifted.focus).toEqual({ blockId: B, offset: 0 })
  })

  it("puts a first item above the list, and turns a list of one into the line itself", () => {
    expect(texts(liftListItem(list, A, 0, { type: "paragraph" }, [B, C]).content)).toEqual(["Weekly visit", "bullet_list"])

    const single = page([{ id: A, items: ["Windows"], type: "numbered_list" }])

    expect(liftListItem(single, A, 0, { type: "paragraph" }, [B, C]).content.blocks).toEqual([
      { alignment: "left", id: A, text: "Windows", type: "paragraph" },
    ])
  })
})
