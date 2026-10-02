import { describe, expect, it } from "vitest"
import * as Y from "yjs"

import { normalizeContentForSave } from "@/components/editor/editor-content"
import { templateContentV3Schema, type TemplateBlock, type TemplateContentV3, type TextRun } from "@/types/template"
import {
  deleteTemplateBlock,
  insertTemplateBlock,
  listTemplateBlockSlots,
  moveTemplateBlockTo,
  removeTemplateSection,
  setBlockKeepWithNext,
  startTemplateSection,
  updateTemplateBlock,
} from "@/types/template-structure"

import { isWellFormedWorkingCopy } from "./working-copy-checks"
import {
  createWorkingCopyDoc,
  newWorkingCopyDoc,
  readWorkingCopyDoc,
  type WorkingCopy,
  writeWorkingCopyDoc,
} from "./working-copy-doc"

const id = (n: number): string => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const HEADING = id(1)
const LETTER = id(2)
const LIST = id(3)
const TABLE = id(4)
const APPROVED = id(5)
const DETAILS = id(6)
const PICTURE = id(7)
const CLOSING = id(8)
const SECTION = id(20)
const GROUP = id(30)

function sample(): WorkingCopy {
  const content = templateContentV3Schema.parse({
    schemaVersion: 3,
    blocks: [
      { id: HEADING, type: "heading", level: 1, text: "Service agreement", runs: [{ text: "Service ", color: "#635273" }, { text: "agreement" }] },
      { id: LETTER, type: "paragraph", text: "Dear client, thank you.", runs: [{ text: "Dear client", bold: true }, { text: ", thank you." }] },
      { id: LIST, type: "bullet_list", items: ["First", "Second"], itemRuns: [null, [{ text: "Second", italic: true, link: "https://example.com" }]] },
      { id: TABLE, type: "table", headers: ["Item", "Price"], rows: [["Setup", "100"]] },
      { id: APPROVED, type: "checkbox_field", fieldKey: "approved", label: "Approved" },
      {
        id: DETAILS,
        type: "text_field",
        fieldKey: "details",
        label: "Details",
        visibleWhen: { sourceBlockId: APPROVED, operator: "equals", value: true },
      },
      { id: PICTURE, type: "image", altText: "Seal", asset: { id: id(40), type: "png", width: 20, height: 20 } },
      { id: CLOSING, type: "paragraph", text: "Kind regards" },
    ],
    sections: [{ id: SECTION, label: "Approval", startBlockId: APPROVED, pageBreakBefore: true, keepTogether: false }],
    fieldGroups: [{ id: GROUP, label: null, startBlockId: APPROVED, endBlockId: DETAILS, columns: 2, keepTogether: true }],
    blockRules: [{ blockId: TABLE, pageBreakBefore: false, keepWithNext: true }],
  })

  return { answers: { approved: true }, category: "Contracts", content, description: "For new clients", title: "Agreement" }
}

/** Two or more copies of one document, each keeping the changes it makes to send on later. */
function replicas(count: number, start = sample()): Array<{ doc: Y.Doc; outbox: Uint8Array[] }> {
  const state = Y.encodeStateAsUpdate(createWorkingCopyDoc(start))

  return Array.from({ length: count }, () => {
    const doc = newWorkingCopyDoc()
    Y.applyUpdate(doc, state)
    const outbox: Uint8Array[] = []
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== "remote") outbox.push(update)
    })
    return { doc, outbox }
  })
}

function edit(doc: Y.Doc, change: (copy: WorkingCopy) => WorkingCopy): void {
  const current = readWorkingCopyDoc(doc)
  writeWorkingCopyDoc(doc, change(current), { from: current })
}

function content(change: (content: TemplateContentV3) => TemplateContentV3) {
  return (copy: WorkingCopy): WorkingCopy => ({ ...copy, content: change(copy.content) })
}

function moveTo(current: TemplateContentV3, blockId: string, index: number): TemplateContentV3 {
  const slot = listTemplateBlockSlots(current, blockId, false).find((candidate) => candidate.index === index)
  const moved = slot ? moveTemplateBlockTo(current, blockId, slot, id(99)) : null
  if (!moved?.success) throw new Error("Cannot move there")
  return moved.content
}

function block(copy: WorkingCopy, blockId: string): TemplateBlock {
  const found = copy.content.blocks.find((candidate) => candidate.id === blockId)
  if (!found) throw new Error(`No block ${blockId}`)
  return found
}

function retype(blockId: string, text: string, runs?: TextRun[]) {
  return content((current) => {
    const line = current.blocks.find((candidate) => candidate.id === blockId)
    if (line?.type !== "paragraph" && line?.type !== "heading") throw new Error("Not a line")
    const rest = { ...line }
    delete rest.runs
    return updateTemplateBlock(current, (runs ? { ...rest, runs, text } : { ...rest, text }) as TemplateBlock)
  })
}

function notes(blockId: string): TemplateBlock {
  return { fieldKey: "notes", helpText: null, id: blockId, label: "Notes", multiline: false, placeholder: null, required: false, type: "text_field" }
}

// What saving would accept, which is what every copy must agree on and never break.
function expectSavable(copy: WorkingCopy): void {
  const result = templateContentV3Schema.safeParse(normalizeContentForSave(copy.content))
  expect(result.error?.issues ?? []).toEqual([])
}

describe("working copy document", () => {
  it("keeps every kind of block, its formatting, and the page's structure", () => {
    const value = sample()
    const doc = createWorkingCopyDoc(value)
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))

    expect(readWorkingCopyDoc(doc)).toEqual(value)
    expect(readWorkingCopyDoc(remote)).toEqual(value)
  })

  it("never keeps a picture's short-lived address", () => {
    const value = sample()
    const withAddress = content((current) => ({
      ...updateTemplateBlock(current, { ...(block(value, PICTURE) as Extract<TemplateBlock, { type: "image" }>), asset: { id: id(40), type: "png", width: 20, height: 20, url: "https://files.example/signed?x=1" } }),
      branding: { ...current.branding, logoAsset: { height: 10, id: id(41), type: "png", url: "https://files.example/signed?logo=1", width: 10 } },
    }))(value)
    const doc = createWorkingCopyDoc(withAddress)
    const kept = readWorkingCopyDoc(doc)

    expect(new TextDecoder().decode(Y.encodeStateAsUpdate(doc))).not.toContain("signed")
    expect(block(kept, PICTURE)).toEqual(block(value, PICTURE))
    expect(kept.content.branding.logoAsset).toEqual({ height: 10, id: id(41), type: "png", width: 10 })
  })

  it("turns each edit into changes another copy replays to the same page", () => {
    const [mine, theirs] = replicas(2)
    const steps: Array<(copy: WorkingCopy) => WorkingCopy> = [
      retype(LETTER, "Dear client, thank you for your order.", [{ text: "Dear client", bold: true }, { text: ", thank you for your order." }]),
      // Bold moves to the end of the line; the words stay.
      retype(LETTER, "Dear client, thank you for your order.", [{ text: "Dear client, thank you for your " }, { text: "order", bold: true, color: "#a24949" }, { text: "." }]),
      content((current) => insertTemplateBlock(current, LETTER, { alignment: "left", id: id(9), text: "P.S.", type: "paragraph" })),
      content((current) => moveTo(current, CLOSING, 0)),
      content((current) => updateTemplateBlock(current, { ...(block({ content: current, title: "" }, LIST) as Extract<TemplateBlock, { type: "bullet_list" }>), items: ["First", "Second", "Third"], itemRuns: [null, [{ text: "Second", italic: true, link: "https://example.com" }], [{ text: "Third", underline: true }]] })),
      content((current) => startTemplateSection(current, LETTER, id(21), "Letter")),
      content((current) => removeTemplateSection(current, SECTION)),
      content((current) => deleteTemplateBlock(current, TABLE)),
      (copy) => ({ ...copy, answers: { approved: false, details: "Rush" }, category: "Sales", description: "", title: "Agreement (2026)" }),
    ]

    for (const step of steps) {
      const intended = step(readWorkingCopyDoc(mine.doc))
      edit(mine.doc, () => intended)
      for (const update of mine.outbox.splice(0)) Y.applyUpdate(theirs.doc, update, "remote")

      expect(readWorkingCopyDoc(mine.doc)).toEqual(intended)
      expect(readWorkingCopyDoc(theirs.doc)).toEqual(intended)
      expectSavable(intended)
    }

    const finished = readWorkingCopyDoc(theirs.doc)
    expect(block(finished, LETTER)).toMatchObject({ runs: [{ text: "Dear client, thank you for your " }, { bold: true, color: "#a24949", text: "order" }, { text: "." }] })
    expect(finished.content.blocks[0]?.id).toBe(CLOSING)
    expect(finished.content.sections.map((section) => section.label)).toEqual(["Letter"])
    expect(finished).toMatchObject({ answers: { approved: false, details: "Rush" }, category: "Sales", description: "", title: "Agreement (2026)" })
  })

  it("merges edits made at the same time, in whatever order and however often they arrive", () => {
    const [mine, theirs, late] = replicas(3)

    edit(mine.doc, retype(CLOSING, "Kind regards,"))
    edit(theirs.doc, retype(CLOSING, "With kind regards"))
    edit(mine.doc, (copy) => ({ ...copy, title: "Agreement for Hawn" }))
    edit(theirs.doc, (copy) => ({ ...copy, title: "Signed agreement" }))
    edit(theirs.doc, content((current) => updateTemplateBlock(current, { ...(block({ content: current, title: "" }, DETAILS) as Extract<TemplateBlock, { type: "text_field" }>), label: "Order details" })))
    // Both move the same line, to different places.
    edit(mine.doc, content((current) => moveTo(current, CLOSING, 0)))
    edit(theirs.doc, content((current) => moveTo(current, CLOSING, 2)))

    const sent = [...mine.outbox, ...theirs.outbox]
    for (const update of mine.outbox) Y.applyUpdate(theirs.doc, update, "remote")
    for (const update of theirs.outbox) Y.applyUpdate(mine.doc, update, "remote")
    // Out of order, twice over, and after a delay.
    for (const update of [...sent].reverse()) Y.applyUpdate(late.doc, update, "remote")
    for (const update of sent) Y.applyUpdate(late.doc, update, "remote")

    const merged = readWorkingCopyDoc(mine.doc)
    expect(readWorkingCopyDoc(theirs.doc)).toEqual(merged)
    expect(readWorkingCopyDoc(late.doc)).toEqual(merged)
    // Both people's words survive in the line they both typed in.
    expect(block(merged, CLOSING)).toMatchObject({ text: expect.stringMatching(/^(With k|K)ind regards,?$/) })
    expect((block(merged, CLOSING) as { text: string }).text).toContain("With")
    expect((block(merged, CLOSING) as { text: string }).text).toContain(",")
    expect(block(merged, DETAILS)).toMatchObject({ label: "Order details" })
    expect(merged.content.blocks.filter((candidate) => candidate.id === CLOSING)).toHaveLength(1)
    expectSavable(merged)
  })

  it("keeps a savable page when one person removes what another is building on", () => {
    const [mine, theirs] = replicas(2)

    edit(mine.doc, content((current) => deleteTemplateBlock(current, APPROVED)))
    edit(mine.doc, content((current) => insertTemplateBlock(current, LETTER, notes(id(10)))))
    edit(mine.doc, content((current) => deleteTemplateBlock(current, PICTURE)))
    // Meanwhile: a page rule on it, a section opening at the picture, and a field of the same name.
    edit(theirs.doc, content((current) => setBlockKeepWithNext(current, APPROVED, true)))
    edit(theirs.doc, content((current) => startTemplateSection(current, PICTURE, id(22), "Pictures")))
    edit(theirs.doc, content((current) => insertTemplateBlock(current, TABLE, notes(id(11)))))

    for (const update of mine.outbox) Y.applyUpdate(theirs.doc, update, "remote")
    for (const update of theirs.outbox) Y.applyUpdate(mine.doc, update, "remote")

    const merged = readWorkingCopyDoc(mine.doc)
    expect(readWorkingCopyDoc(theirs.doc)).toEqual(merged)
    expect(merged.content.blocks.map((candidate) => candidate.id)).not.toContain(APPROVED)
    expect(JSON.stringify(merged.content)).not.toContain(APPROVED)
    expect(JSON.stringify(merged.content)).not.toContain(PICTURE)
    expect(merged.content.sections.map((section) => section.label)).toEqual(["Approval"])
    // Each new field sits where its author put it, and the second of the two to ask for "notes" gives way.
    const order = merged.content.blocks.map((candidate) => candidate.id)
    expect(order.slice(order.indexOf(LETTER), order.indexOf(LETTER) + 2)).toEqual([LETTER, id(10)])
    expect(order.slice(order.indexOf(TABLE), order.indexOf(TABLE) + 2)).toEqual([TABLE, id(11)])
    expect(merged.content.blocks.flatMap((candidate) => ("fieldKey" in candidate ? [candidate.fieldKey] : []))).toEqual(["notes", "notes_2", "details"])
    expectSavable(merged)
  })

  it("accepts what someone is still typing, and nothing saving would refuse", () => {
    const value = sample()
    const typing = content((current) =>
      startTemplateSection(
        updateTemplateBlock(current, { ...(block(value, DETAILS) as Extract<TemplateBlock, { type: "text_field" }>), label: " " }),
        CLOSING,
        id(23),
        ""
      )
    )(value)
    const unsafeLink = retype(LETTER, "Dear client", [{ link: "javascript:alert(1)", text: "Dear client" }])(value)
    const tooLong = retype(CLOSING, "x".repeat(20_001))(value)
    const unknownBlock = { ...value, content: { ...value.content, blocks: [...value.content.blocks, { id: id(12), type: "script" } as unknown as TemplateBlock] } }

    expect(isWellFormedWorkingCopy(value)).toBe(true)
    expect(isWellFormedWorkingCopy({ ...typing, title: "" })).toBe(true)
    expect(isWellFormedWorkingCopy(unsafeLink)).toBe(false)
    expect(isWellFormedWorkingCopy(tooLong)).toBe(false)
    expect(isWellFormedWorkingCopy(unknownBlock)).toBe(false)
    expect(isWellFormedWorkingCopy({ ...value, title: "x".repeat(181) })).toBe(false)
    expect(isWellFormedWorkingCopy({ ...value, content: { ...value.content, layout: undefined } } as unknown as WorkingCopy)).toBe(false)
  })

  it("never splits a character written with two code units", () => {
    const [mine, theirs] = replicas(2)

    edit(mine.doc, retype(CLOSING, "Thanks 😀!"))
    edit(mine.doc, retype(CLOSING, "Thanks 😁!"))
    for (const update of mine.outbox) Y.applyUpdate(theirs.doc, update, "remote")

    const fresh = new Y.Doc()
    Y.applyUpdate(fresh, Y.encodeStateAsUpdate(theirs.doc))
    expect(block(readWorkingCopyDoc(fresh), CLOSING)).toMatchObject({ text: "Thanks 😁!" })
  })

  it("changes nothing on its own when formatting arrives from elsewhere", () => {
    const [mine, theirs] = replicas(2)

    // Both make the same words bold at once, which leaves each copy a marker to spare.
    for (const copy of [mine, theirs]) edit(copy.doc, retype(CLOSING, "Kind regards", [{ text: "Kind", bold: true }, { text: " regards" }]))
    const sent = { mine: mine.outbox.splice(0), theirs: theirs.outbox.splice(0) }
    for (const update of sent.theirs) Y.applyUpdate(mine.doc, update, "remote")
    for (const update of sent.mine) Y.applyUpdate(theirs.doc, update, "remote")

    // A tidy-up made on one copy and not passed on would leave copies disagreeing later.
    expect(mine.outbox).toEqual([])
    expect(theirs.outbox).toEqual([])
    expect(readWorkingCopyDoc(theirs.doc)).toEqual(readWorkingCopyDoc(mine.doc))
    expect(block(readWorkingCopyDoc(mine.doc), CLOSING)).toMatchObject({ runs: [{ bold: true, text: "Kind" }, { text: " regards" }] })
  })

  it("agrees on one savable page after many people's random edits arrive in random order", () => {
    const random = seeded(20260928)
    const copies = replicas(3)
    const pending: Array<{ to: number; update: Uint8Array }> = []

    for (let round = 0; round < 300; round += 1) {
      const author = copies[Math.floor(random() * copies.length)]!
      edit(author.doc, (copy) => randomEdit(copy, random, round))

      for (const update of author.outbox.splice(0)) {
        copies.forEach((copy, index) => {
          if (copy !== author) pending.push({ to: index, update })
        })
      }

      // Deliver some changes now, some later, some twice.
      while (pending.length > 0 && random() < 0.6) {
        const [delivery] = pending.splice(Math.floor(random() * pending.length), 1)
        Y.applyUpdate(copies[delivery!.to]!.doc, delivery!.update, "remote")
        if (random() < 0.1) Y.applyUpdate(copies[delivery!.to]!.doc, delivery!.update, "remote")
      }
    }

    for (const delivery of pending) Y.applyUpdate(copies[delivery.to]!.doc, delivery.update, "remote")

    const [first, ...rest] = copies.map((copy) => readWorkingCopyDoc(copy.doc))
    for (const other of rest) expect(other).toEqual(first)
    expectSavable(first!)
  })
})

function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296
    return state / 4_294_967_296
  }
}

let fresh = 1_000
function randomEdit(copy: WorkingCopy, random: () => number, round: number): WorkingCopy {
  const blocks = copy.content.blocks
  const pick = <T,>(items: readonly T[]): T | undefined => items[Math.floor(random() * items.length)]
  const lines = blocks.filter((candidate): candidate is Extract<TemplateBlock, { type: "paragraph" }> => candidate.type === "paragraph")
  const choice = random()

  if (choice < 0.45 && lines.length > 0) {
    const line = pick(lines)!
    const at = Math.floor(random() * (line.text.length + 1))
    const typed = random() < 0.8 ? line.text.slice(0, at) + pick(["a", "b", " ", "é", "😀"])! + line.text.slice(at) : line.text.slice(0, at) + line.text.slice(at + 1)
    const rest = { ...line }
    delete rest.runs
    const text = typed.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    const bolded = random() < 0.2 && text.length > 1 ? { ...rest, runs: [{ bold: true as const, text: text.slice(0, 1) }, { text: text.slice(1) }], text } : { ...rest, text }
    return { ...copy, content: updateTemplateBlock(copy.content, bolded) }
  }

  if (choice < 0.6 && blocks.length < 40) {
    fresh += 1
    return { ...copy, content: insertTemplateBlock(copy.content, pick(blocks)?.id ?? null, { alignment: "left", id: id(fresh), text: `Line ${round}`, type: "paragraph" }) }
  }

  if (choice < 0.7 && blocks.length > 3) {
    return { ...copy, content: deleteTemplateBlock(copy.content, pick(blocks)!.id) }
  }

  if (choice < 0.85 && blocks.length > 1) {
    const moving = pick(blocks)!
    const slot = pick(listTemplateBlockSlots(copy.content, moving.id, false))
    fresh += 1
    const moved = slot ? moveTemplateBlockTo(copy.content, moving.id, slot, id(fresh)) : null
    return moved?.success ? { ...copy, content: moved.content } : copy
  }

  if (choice < 0.93 && blocks.length > 0) {
    fresh += 1
    return { ...copy, content: startTemplateSection(copy.content, pick(blocks)!.id, id(fresh), `Part ${round}`) }
  }

  const section = pick(copy.content.sections)
  return section ? { ...copy, content: removeTemplateSection(copy.content, section.id) } : { ...copy, title: `Title ${round}` }
}
