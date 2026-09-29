import { describe, expect, it } from "vitest"

import { applyWorkingCopyUpdate, openWorkingCopyRoom, readWorkingCopySince, type WorkingCopyServiceDeps } from "@/services/working-copy-service"
import {
  as,
  database,
  fakeClient,
  INTRO,
  MANAGER_ID,
  NAME,
  OWNER_ID,
  ROOM_ID,
} from "@/services/working-copies/working-copy-service.test-support"
import type { TemplateBlock } from "@/types/template"
import { updateTemplateBlock } from "@/types/template-structure"

import { type LiveSession, RoomRefusal, type RoomTransport, startLiveSession } from "./live-session"
import type { WorkingCopy } from "./working-copy-doc"

/** A room served by the real service over an in-memory database, and the editors in it. */
function room() {
  const tables = database()
  const editors: Array<LiveSession<WorkingCopy>> = []
  const deps: WorkingCopyServiceDeps = {
    // Everyone in the room hears each change that was kept.
    broadcast: async (_topic, _event, message) => {
      if ("revision" in message) editors.forEach((editor) => editor.hear(message.revision))
    },
    client: fakeClient(tables) as never,
    createId: () => ROOM_ID,
    requireStoredImages: async () => undefined,
  }
  let offline = false

  function transport(actorUserId: string): RoomTransport {
    const refusing = async <T,>(request: () => Promise<T>): Promise<T> => {
      if (offline) throw new TypeError("Failed to fetch")
      try {
        return await request()
      } catch (error: unknown) {
        const status = (error as { statusCode?: number }).statusCode ?? 500
        throw status >= 400 && status < 500 && status !== 429 ? new RoomRefusal((error as Error).message, status) : error
      }
    }

    return {
      readSince: (afterRevision) => refusing(() => readWorkingCopySince({ ...as(actorUserId), afterRevision, roomId: ROOM_ID }, deps)),
      reopen: () => refusing(() => openWorkingCopyRoom(as(actorUserId), deps)),
      send: (update) => refusing(() => applyWorkingCopyUpdate({ ...as(actorUserId), roomId: ROOM_ID, update }, deps)),
    }
  }

  async function join(actorUserId: string, onRefused?: (message: string) => void): Promise<LiveSession<WorkingCopy>> {
    const opened = await openWorkingCopyRoom(as(actorUserId), deps)
    const editor = startLiveSession<WorkingCopy>({ fromCopy: (copy) => copy, onRefused, opened, toCopy: (copy) => copy, transport: transport(actorUserId) })
    editors.push(editor)
    return editor
  }

  // Everyone sends what they made, then fetches what they missed.
  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round += 1) {
      await Promise.all(editors.map((editor) => editor.flush()))
      await Promise.all(editors.map((editor) => editor.catchUp()))
    }
  }

  return { join, setOffline: (value: boolean) => (offline = value), settle, tables }
}

const retypeIntro = (text: string) => (copy: WorkingCopy): WorkingCopy => ({
  ...copy,
  content: updateTemplateBlock(copy.content, { alignment: "left", id: INTRO, text, type: "paragraph" }),
})
const relabel = (label: string) => (copy: WorkingCopy): WorkingCopy => {
  const field = copy.content.blocks.find((block) => block.id === NAME) as Extract<TemplateBlock, { type: "text_field" }>
  return { ...copy, content: updateTemplateBlock(copy.content, { ...field, label }) }
}
const intro = (copy: WorkingCopy): unknown => copy.content.blocks[0] && "text" in copy.content.blocks[0] ? copy.content.blocks[0].text : null
const label = (copy: WorkingCopy): unknown => (copy.content.blocks[1] as { label?: string }).label

describe("live editing", () => {
  it("shows each editor what the other made, and saves the template with both", async () => {
    const { join, settle, tables } = room()
    const mine = await join(MANAGER_ID)
    const theirs = await join(OWNER_ID)

    mine.change(retypeIntro("Welcome aboard, and thank you."))
    theirs.change(relabel("Full name"))
    await settle()

    for (const editor of [mine, theirs]) {
      expect(intro(editor.snapshot())).toBe("Welcome aboard, and thank you.")
      expect(label(editor.snapshot())).toBe("Full name")
      expect(editor.status()).toBe("saved")
    }
    expect(tables.document_templates[0]).toMatchObject({ content: { blocks: [{ text: "Welcome aboard, and thank you." }, { label: "Full name" }] } })
  })

  it("undoes only this editor's own change, keeping what the other made since", async () => {
    const { join, settle } = room()
    const mine = await join(MANAGER_ID)
    const theirs = await join(OWNER_ID)

    mine.change(retypeIntro("Mine"))
    await settle()
    theirs.change(relabel("Theirs"))
    await settle()
    expect(mine.canUndo()).toBe(true)
    mine.undo()
    await settle()

    for (const editor of [mine, theirs]) {
      expect(intro(editor.snapshot())).toBe("Welcome aboard.")
      expect(label(editor.snapshot())).toBe("Theirs")
    }
  })

  it("keeps changes made while offline and sends them when the room is back", async () => {
    const { join, setOffline, settle, tables } = room()
    const mine = await join(MANAGER_ID)
    const theirs = await join(OWNER_ID)

    setOffline(true)
    mine.change(retypeIntro("Written on the train"))
    await expect(mine.flush()).resolves.toBe(false)
    expect(mine.status()).toBe("offline")

    setOffline(false)
    theirs.change(relabel("Meanwhile"))
    await settle()

    expect(mine.status()).toBe("saved")
    expect(intro(theirs.snapshot())).toBe("Written on the train")
    expect(label(mine.snapshot())).toBe("Meanwhile")
    expect(tables.document_templates[0]).toMatchObject({ content: { blocks: [{ text: "Written on the train" }, { label: "Meanwhile" }] } })
  })

  it("stops, back at what the room kept, when this editor loses the right to edit", async () => {
    const refusals: string[] = []
    const { join, settle, tables } = room()
    const mine = await join(MANAGER_ID, (message) => refusals.push(message))

    mine.change(retypeIntro("Kept"))
    await settle()
    tables.organization_memberships[0]!.role = "staff"
    mine.change(retypeIntro("Kept, then refused"))
    await settle()

    expect(refusals).toEqual(["You cannot edit templates."])
    expect(mine.status()).toBe("stopped")
    expect(intro(mine.snapshot())).toBe("Kept")
    mine.change(retypeIntro("Ignored"))
    expect(intro(mine.snapshot())).toBe("Kept")
    expect(tables.document_templates[0]).toMatchObject({ content: { blocks: [{ text: "Kept" }, {}] } })
  })

  it("drops a change the room refuses and carries on from the room's copy", async () => {
    const refusals: string[] = []
    const { join, settle, tables } = room()
    const mine = await join(MANAGER_ID, (message) => refusals.push(message))

    mine.change((copy) => ({
      ...copy,
      content: updateTemplateBlock(copy.content, { alignment: "left", id: INTRO, runs: [{ link: "javascript:alert(1)", text: "Click" }], text: "Click", type: "paragraph" }),
    }))
    await settle()

    expect(refusals).toEqual(["This change could not be kept."])
    expect(intro(mine.snapshot())).toBe("Welcome aboard.")

    mine.change(retypeIntro("Kept after all"))
    await settle()
    expect(tables.document_templates[0]).toMatchObject({ content: { blocks: [{ text: "Kept after all" }, {}] } })
  })
})
