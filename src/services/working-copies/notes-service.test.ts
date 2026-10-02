import { describe, expect, it, vi } from "vitest"
import * as Y from "yjs"

import { readWorkingCopyDoc, type WorkingCopy, writeWorkingCopyDoc } from "@/lib/collaboration/working-copy-doc"
import { updateTemplateBlock } from "@/types/template-structure"

import {
  addWorkingCopyComment,
  listWorkingCopyCheckpoints,
  listWorkingCopyComments,
  listWorkingCopyMessages,
  resolveWorkingCopyThread,
  restoreWorkingCopyCheckpoint,
  saveWorkingCopyCheckpoint,
  sendWorkingCopyMessage,
} from "./notes-service"
import { applyWorkingCopyUpdate, openWorkingCopyRoom, type WorkingCopyServiceDeps } from "./working-copy-service"
import { as, database, fakeClient, INTRO, MANAGER_ID, OWNER_ID, STAFF_ID } from "./working-copy-service.test-support"

let ids = 0
function harness() {
  const tables = database()
  const broadcast = vi.fn(async () => undefined)
  const deps: WorkingCopyServiceDeps = {
    broadcast,
    client: fakeClient(tables) as never,
    createId: () => `60000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    requireStoredImages: async () => undefined,
  }
  return { broadcast, deps, tables }
}

// Types into the introduction and keeps it, as an editor would.
async function retype(deps: WorkingCopyServiceDeps, roomId: string, text: string): Promise<void> {
  const opened = await openWorkingCopyRoom(as(MANAGER_ID), deps)
  const doc = new Y.Doc()
  Y.applyUpdate(doc, opened.state)
  const updates: Uint8Array[] = []
  doc.on("update", (update: Uint8Array) => updates.push(update))
  const current = readWorkingCopyDoc(doc)
  const next: WorkingCopy = { ...current, content: updateTemplateBlock(current.content, { alignment: "left", id: INTRO, text, type: "paragraph" }) }
  writeWorkingCopyDoc(doc, next, { from: current })
  await applyWorkingCopyUpdate({ ...as(MANAGER_ID), roomId, update: Y.mergeUpdates(updates) }, deps)
}

const introOf = (copy: WorkingCopy): unknown => (copy.content.blocks[0] as { text?: string }).text

describe("working copy notes", () => {
  it("keeps checkpoints of the copy as it stood, and going back keeps first what it replaces", async () => {
    const { broadcast, deps, tables } = harness()
    const { roomId } = await openWorkingCopyRoom(as(MANAGER_ID), deps)
    const room = { ...as(MANAGER_ID), roomId }

    await retype(deps, roomId, "First draft")
    const saved = await saveWorkingCopyCheckpoint({ ...room, label: "  Before review  " }, deps)
    await retype(deps, roomId, "Second draft")
    const restored = await restoreWorkingCopyCheckpoint({ ...as(OWNER_ID), checkpointId: saved.id, roomId }, deps)

    expect(saved).toMatchObject({ createdBy: "Maya Chen", label: "Before review", restoredFrom: null, revision: 1 })
    expect(introOf(restored)).toBe("First draft")
    expect(await listWorkingCopyCheckpoints(room, deps)).toMatchObject([
      { createdBy: "Omar Haddad", label: "Before going back to Before review", restoredFrom: saved.id, revision: 2 },
      { id: saved.id },
    ])
    expect(introOf(tables.working_copy_checkpoints[1]!.value as WorkingCopy)).toBe("Second draft")
    expect(broadcast).toHaveBeenCalledWith(`working-copy:${roomId}`, "notes", { by: OWNER_ID, notes: "checkpoints" })
    await expect(saveWorkingCopyCheckpoint({ ...room, label: " " }, deps)).rejects.toMatchObject({ statusCode: 400 })
    await expect(restoreWorkingCopyCheckpoint({ ...room, checkpointId: "60000000-0000-4000-8000-000000009999" }, deps)).rejects.toMatchObject({ statusCode: 404 })
  })

  it("keeps threads of comments on blocks, with replies, resolved and opened again", async () => {
    const { deps } = harness()
    const { roomId } = await openWorkingCopyRoom(as(MANAGER_ID), deps)
    const room = { ...as(MANAGER_ID), roomId }

    const thread = await addWorkingCopyComment({ ...room, blockId: INTRO, body: "Should this be warmer?", quote: "Welcome aboard." }, deps)
    await addWorkingCopyComment({ ...as(OWNER_ID), body: "Agreed, changing it.", roomId, threadId: thread.id }, deps)
    await resolveWorkingCopyThread({ ...as(OWNER_ID), resolved: true, roomId, threadId: thread.id }, { ...deps, now: () => new Date("2026-09-28T13:00:00Z") })

    expect(await listWorkingCopyComments(room, deps)).toMatchObject([
      { author: "Maya Chen", authorId: MANAGER_ID, blockId: INTRO, quote: "Welcome aboard.", resolvedAt: "2026-09-28T13:00:00.000Z", resolvedBy: "Omar Haddad", threadId: thread.id },
      { author: "Omar Haddad", blockId: null, body: "Agreed, changing it.", threadId: thread.id },
    ])
    await resolveWorkingCopyThread({ ...room, resolved: false, threadId: thread.id }, deps)
    expect((await listWorkingCopyComments(room, deps))[0]).toMatchObject({ resolvedAt: null, resolvedBy: null })
    await expect(addWorkingCopyComment({ ...room, blockId: "70000000-0000-4000-8000-000000000001", body: "Gone?" }, deps)).rejects.toMatchObject({ statusCode: 404 })
    await expect(addWorkingCopyComment({ ...room, body: "Reply", threadId: "70000000-0000-4000-8000-000000000002" }, deps)).rejects.toMatchObject({ statusCode: 404 })
  })

  it("keeps the chat among the people editing, in order, and nobody else can read or write it", async () => {
    const { deps } = harness()
    const { roomId } = await openWorkingCopyRoom(as(MANAGER_ID), deps)

    await sendWorkingCopyMessage({ ...as(OWNER_ID), body: "I'll take the signature page.", roomId }, deps)
    await sendWorkingCopyMessage({ ...as(MANAGER_ID), body: "  On it.  ", roomId }, deps)

    expect(await listWorkingCopyMessages({ ...as(MANAGER_ID), roomId }, deps)).toMatchObject([
      { author: "Omar Haddad", authorId: OWNER_ID, body: "I'll take the signature page." },
      { author: "Maya Chen", authorId: MANAGER_ID, body: "On it." },
    ])
    await expect(listWorkingCopyMessages({ ...as(STAFF_ID), roomId }, deps)).rejects.toMatchObject({ statusCode: 403 })
    await expect(sendWorkingCopyMessage({ ...as(STAFF_ID), body: "Hi", roomId }, deps)).rejects.toMatchObject({ statusCode: 403 })
    await expect(sendWorkingCopyMessage({ ...as(MANAGER_ID), body: "", roomId }, deps)).rejects.toMatchObject({ statusCode: 400 })
  })
})
