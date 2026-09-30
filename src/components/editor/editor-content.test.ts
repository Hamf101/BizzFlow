import { describe, expect, it } from "vitest"

import {
  convertTextBlock,
  deleteAcross,
  insertLines,
  insertPageAfter,
  insertSectionAfter,
  liftListItem,
  mergeIntoPrevious,
  normalizeContentForSave,
  readMarkdownShortcut,
  removePageBreak,
  splitTextBlock,
  turnLineIntoSection,
  turnSectionIntoLine,
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

describe("sections typed on the page", () => {
  const S = "70000000-0000-4000-8000-000000000011"
  const N = "70000000-0000-4000-8000-000000000012"
  const line = (id: string, text: string): TemplateBlock => ({ alignment: "left", id, text, type: "paragraph" })
  const heading = (id: string, text: string): TemplateBlock => ({ alignment: "left", id, level: 2, text, type: "heading" })

  it("turns a heading into the title of a section holding what follows, and back again", () => {
    const made = turnLineIntoSection(page([line(A, "Intro"), heading(B, "Terms"), line(C, "Pay monthly.")]), B, S)
    const undone = turnSectionIntoLine(made.content, S, { level: 2, type: "heading" }, N)

    expect(texts(made.content)).toEqual(["Intro", "Pay monthly."])
    expect(made.content.sections).toEqual([
      { id: S, keepTogether: false, label: "Terms", pageBreakBefore: false, startBlockId: C },
    ])
    expect(made.focus).toEqual({ blockId: `section:${S}`, offset: 5 })
    expect(templateContentV3Schema.safeParse(made.content).success).toBe(true)
    expect(undone.content.blocks.map((block) => [block.type, texts(page([block]))[0]])).toEqual([
      ["paragraph", "Intro"],
      ["heading", "Terms"],
      ["paragraph", "Pay monthly."],
    ])
    expect(undone.content.sections).toEqual([])
    expect(undone.focus).toEqual({ blockId: N, offset: 5 })
  })

  it("moves a page break from the line to the section, and keeps an empty last line to hold it", () => {
    const made = turnLineIntoSection(insertPageAfter(page([line(A, "Intro")]), A, B), B, S)
    const undone = turnSectionIntoLine(made.content, S, { type: "paragraph" }, N)

    expect(made.content.blocks.map((block) => block.id)).toEqual([A, B])
    expect(made.content.sections).toEqual([
      { id: S, keepTogether: false, label: "Section title", pageBreakBefore: true, startBlockId: B },
    ])
    expect(made.content.blockRules).toEqual([])
    expect(undone.content.blockRules).toEqual([{ blockId: N, keepWithNext: false, pageBreakBefore: true }])
  })

  it("starts a section after the caret's block, at the next block or on a new empty line", () => {
    const content = page([line(A, "Intro"), line(C, "Pay monthly.")])
    const split = insertSectionAfter(content, A, S, N)
    const atEnd = insertSectionAfter(content, C, S, N)

    expect(split.content.sections).toEqual([
      { id: S, keepTogether: false, label: "Section title", pageBreakBefore: false, startBlockId: C },
    ])
    expect(split.focus).toEqual({ blockId: `section:${S}`, offset: 0 })
    expect(templateContentV3Schema.safeParse(split.content).success).toBe(true)
    expect(templateContentV3Schema.safeParse(atEnd.content).success).toBe(true)
    expect(atEnd.content.blocks.map((block) => block.id)).toEqual([A, C, N])
    expect(atEnd.content.sections.map((section) => section.startBlockId)).toEqual([N])
  })

  it("inserts a section before an existing first section without moving its boundary", () => {
    const content = { ...page([line(A, "Terms body")]), sections: [{ id: S, label: "Terms", startBlockId: A, pageBreakBefore: false, keepTogether: false }] }
    const added = insertSectionAfter(content, null, B, N).content
    expect(added.sections.map((section) => [section.id, section.startBlockId])).toEqual([[B, N], [S, A]])
    expect(templateContentV3Schema.safeParse(added).success).toBe(true)
  })

  it("keeps a line longer than the section title limit unchanged", () => {
    const content = page([line(A, "a".repeat(161)), line(B, "Body")])
    expect(turnLineIntoSection(content, A, S).content).toBe(content)
  })

  it("leaves a line that already opens a section as it is", () => {
    const content = {
      ...page([line(A, "Intro"), heading(B, "Terms")]),
      sections: [{ id: S, keepTogether: false, label: "Legal", pageBreakBefore: false, startBlockId: B }],
    }

    expect(turnLineIntoSection(content, B, N).content).toBe(content)
  })
})

describe("words selected across blocks", () => {
  const D = "70000000-0000-4000-8000-000000000004"
  const E = "70000000-0000-4000-8000-000000000005"
  const content = page([
    { alignment: "left", id: A, level: 2, runs: [{ bold: true, text: "Payment" }, { text: " terms" }], text: "Payment terms", type: "heading" },
    { alignment: "left", id: B, text: "Rent is due monthly.", type: "paragraph" },
    { fieldKey: "tenant", helpText: null, id: C, label: "Tenant", multiline: false, placeholder: null, required: false, type: "text_field" },
    { id: D, items: ["Keys", "Alarm code"], type: "bullet_list" },
    { alignment: "left", id: E, text: "Signed below.", type: "paragraph" },
  ])

  it("takes out what lies between two points, joining the words either side and keeping their formatting", () => {
    const cut = deleteAcross(content, { blockId: A, offset: 4 }, { blockId: D, item: 1, offset: 6 })

    // Everything between goes, the field too; the list keeps nothing before the point.
    expect(cut.ok && texts(cut.content)).toEqual(["Paymcode", "Signed below."])
    expect(cut.ok && cut.content.blocks[0]).toMatchObject({ runs: [{ bold: true, text: "Paym" }, { text: "code" }], type: "heading" })
    expect(cut.ok && cut.focus).toEqual({ blockId: A, offset: 4 })
    // Picked backwards, it is the same cut.
    expect(deleteAcross(content, { blockId: D, item: 1, offset: 6 }, { blockId: A, offset: 4 })).toEqual(cut)
    expect(cut.ok && templateContentV3Schema.safeParse(cut.content).success).toBe(true)
  })

  it("keeps a list's items after the point, and inside one line cuts only the words", () => {
    const listed = deleteAcross(content, { blockId: B, offset: 4 }, { blockId: D, item: 0, offset: 2 })

    expect(listed.ok && texts(listed.content)).toEqual(["Payment terms", "Rentys", "bullet_list", "Signed below."])
    expect(listed.ok && listed.content.blocks[2]).toMatchObject({ items: ["Alarm code"] })

    const words = deleteAcross(content, { blockId: B, offset: 0 }, { blockId: B, offset: 8 })

    expect(words.ok && texts(words.content)[1]).toBe("due monthly.")
  })

  it("refuses to take out a field another field's rule depends on", () => {
    const ruled = page([
      ...content.blocks,
      { fieldKey: "pets", helpText: null, id: "70000000-0000-4000-8000-000000000006", label: "Pets", multiline: false, placeholder: null, required: false, type: "text_field", visibleWhen: { operator: "equals", sourceBlockId: C, value: "yes" } },
    ])

    expect(deleteAcross(ruled, { blockId: B, offset: 2 }, { blockId: D, item: 0, offset: 1 }).ok).toBe(false)
  })

  it("pastes several lines as a line each, the words after the caret after the last", () => {
    const pasted = insertLines(content, { blockId: B, offset: 8 }, ["paid", "", "in full "], () => C + "9")

    expect(texts(pasted.content).slice(0, 4)).toEqual(["Payment terms", "Rent is paid", "in full due monthly.", "text_field"])
    expect(pasted.focus).toEqual({ blockId: pasted.content.blocks[2]!.id, offset: 8 })

    const listed = insertLines(content, { blockId: D, item: 0, offset: 4 }, ["", "Gate fob"], () => C + "9")

    expect(listed.content.blocks[3]).toMatchObject({ items: ["Keys", "Gate fob", "Alarm code"] })
  })
})
