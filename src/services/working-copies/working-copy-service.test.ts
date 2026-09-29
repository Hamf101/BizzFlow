import { describe, expect, it, vi } from "vitest"
import * as Y from "yjs"

import { readWorkingCopyDoc, type WorkingCopy, writeWorkingCopyDoc } from "@/lib/collaboration/working-copy-doc"
import type { FakeRow } from "@/services/postgrest-fake.test-support"
import type { TemplateBlock, TemplateContentV3 } from "@/types/template"
import { updateTemplateBlock } from "@/types/template-structure"

import {
  applyWorkingCopyUpdate,
  openWorkingCopyRoom,
  publishTemplateRoom,
  readWorkingCopySince,
  signWorkingCopyPictures,
  type WorkingCopyServiceDeps,
} from "./working-copy-service"
import {
  as,
  database,
  fakeClient,
  INTRO,
  MANAGER_ID,
  NAME,
  ORG_ID,
  OTHER_ORG_ID,
  OWNER_ID,
  ROOM_ID,
  STAFF_ID,
  type Tables,
} from "./working-copy-service.test-support"

function harness(tables = database()) {
  const broadcast = vi.fn(async () => undefined)
  const deps: WorkingCopyServiceDeps = {
    broadcast,
    client: fakeClient(tables) as never,
    createId: () => ROOM_ID,
    requireStoredImages: async () => undefined,
  }
  return { broadcast, deps, tables }
}

/** An editor's copy of the room, which keeps the changes it makes to send. */
function editor(state: Uint8Array) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state, "server")
  const sent: Uint8Array[] = []
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "server") sent.push(update)
  })
  return {
    doc,
    edit(change: (copy: WorkingCopy) => WorkingCopy): Uint8Array {
      const current = readWorkingCopyDoc(doc)
      writeWorkingCopyDoc(doc, change(current), { from: current })
      return Y.mergeUpdates(sent.splice(0))
    },
  }
}

function retitleField(label: string) {
  return (copy: WorkingCopy): WorkingCopy => {
    const field = copy.content.blocks.find((block) => block.id === NAME) as Extract<TemplateBlock, { type: "text_field" }>
    return { ...copy, content: updateTemplateBlock(copy.content, { ...field, label }) }
  }
}

function retypeIntro(text: string) {
  return (copy: WorkingCopy): WorkingCopy => ({
    ...copy,
    content: updateTemplateBlock(copy.content, { alignment: "left", id: INTRO, text, type: "paragraph" }),
  })
}

const template = (tables: Tables): FakeRow => tables.document_templates[0]!

describe("working copy rooms", () => {
  it("opens one room per template, holding the template as saved, for those who may edit templates", async () => {
    const { deps } = harness()

    const first = await openWorkingCopyRoom(as(MANAGER_ID), deps)
    const second = await openWorkingCopyRoom(as(OWNER_ID), deps)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, second.state)

    expect(second).toMatchObject({ revision: 0, roomId: first.roomId, topic: `working-copy:${first.roomId}` })
    expect(readWorkingCopyDoc(doc)).toMatchObject({
      category: "Sales",
      content: { blocks: [{ id: INTRO, text: "Welcome aboard." }, { id: NAME, label: "Client name" }] },
      description: "",
      title: "Welcome pack",
    })
    await expect(openWorkingCopyRoom(as(STAFF_ID), deps)).rejects.toMatchObject({ statusCode: 403 })
    await expect(openWorkingCopyRoom(as(MANAGER_ID, OTHER_ORG_ID), deps)).rejects.toMatchObject({ statusCode: 403 })
  })

  it("keeps each update in order, saves the template with it, and passes it on", async () => {
    const { broadcast, deps, tables } = harness()
    const opened = await openWorkingCopyRoom(as(MANAGER_ID), deps)
    const mine = editor(opened.state)
    const theirs = editor(opened.state)

    const first = mine.edit(retypeIntro("Welcome aboard, and thank you."))
    await expect(applyWorkingCopyUpdate({ ...as(MANAGER_ID), roomId: opened.roomId, update: first }, deps)).resolves.toEqual({ revision: 1 })
    // Made before the first arrived; the room still takes both.
    const second = theirs.edit((copy) => ({ ...retitleField("Full name")(copy), title: "Welcome pack 2026" }))
    await expect(applyWorkingCopyUpdate({ ...as(OWNER_ID), roomId: opened.roomId, update: second }, deps)).resolves.toEqual({ revision: 2 })

    expect(template(tables)).toMatchObject({
      content: { blocks: [{ text: "Welcome aboard, and thank you." }, { label: "Full name" }] },
      revision: 6,
      title: "Welcome pack 2026",
      updated_by: OWNER_ID,
    })
    expect(tables.working_copy_updates.map((update) => [update.revision, update.actor_user_id])).toEqual([[1, MANAGER_ID], [2, OWNER_ID]])
    // Only word that a change was kept: the change itself comes from the app, which checks access each time.
    expect(broadcast).toHaveBeenNthCalledWith(1, `working-copy:${opened.roomId}`, "update", { by: MANAGER_ID, revision: 1 })
    expect(broadcast).toHaveBeenCalledTimes(2)
  })

  it("keeps an unfinished edit for everyone without saving it over the template", async () => {
    const { broadcast, deps, tables } = harness()
    const opened = await openWorkingCopyRoom(as(MANAGER_ID), deps)

    const cleared = editor(opened.state).edit(retitleField(""))

    await expect(applyWorkingCopyUpdate({ ...as(MANAGER_ID), roomId: opened.roomId, update: cleared }, deps)).resolves.toEqual({ revision: 1 })
    expect(template(tables)).toMatchObject({ content: { blocks: [{}, { label: "Client name" }] }, revision: 4 })
    expect(broadcast).toHaveBeenCalledTimes(1)
  })

  it("refuses an update that would break the page or reach past the working copy, keeping nothing", async () => {
    const { broadcast, deps, tables } = harness()
    const opened = await openWorkingCopyRoom(as(MANAGER_ID), deps)
    const unsafe = editor(opened.state).edit((copy) => ({
      ...copy,
      content: updateTemplateBlock(copy.content, { alignment: "left", id: INTRO, runs: [{ link: "javascript:alert(1)", text: "Click" }], text: "Click", type: "paragraph" }),
    }))
    const stray = new Y.Doc()
    Y.applyUpdate(stray, opened.state)
    stray.getMap("elsewhere").set("note", "x".repeat(10))
    const outside = Y.encodeStateAsUpdate(stray, Y.encodeStateVector(editor(opened.state).doc))
    const room = { ...as(MANAGER_ID), roomId: opened.roomId }

    await expect(applyWorkingCopyUpdate({ ...room, update: unsafe }, deps)).rejects.toMatchObject({ statusCode: 422 })
    await expect(applyWorkingCopyUpdate({ ...room, update: outside }, deps)).rejects.toMatchObject({ statusCode: 422 })
    await expect(applyWorkingCopyUpdate({ ...room, update: new Uint8Array(1_048_577) }, deps)).rejects.toMatchObject({ statusCode: 413 })
    await expect(applyWorkingCopyUpdate({ ...room, update: new Uint8Array([1, 2, 3]) }, deps)).rejects.toMatchObject({ statusCode: 400 })
    expect(tables.working_copy_updates).toEqual([])
    expect(broadcast).not.toHaveBeenCalled()
  })

  it("checks again, for every update, that the person may still edit this template", async () => {
    const { deps, tables } = harness()
    const opened = await openWorkingCopyRoom(as(MANAGER_ID), deps)
    const update = editor(opened.state).edit(retypeIntro("Hello"))

    tables.organization_memberships[0]!.role = "staff"

    await expect(applyWorkingCopyUpdate({ ...as(MANAGER_ID), roomId: opened.roomId, update }, deps)).rejects.toMatchObject({ statusCode: 403 })
    await expect(applyWorkingCopyUpdate({ ...as(OWNER_ID), roomId: "40000000-0000-4000-8000-000000000009", update }, deps)).rejects.toMatchObject({ statusCode: 404 })
    expect(tables.working_copy_updates).toEqual([])
  })

  it("takes an update that lost a race after the one that won it", async () => {
    const tables = database()
    const { deps } = harness(tables)
    const opened = await openWorkingCopyRoom(as(MANAGER_ID), deps)
    const winner = editor(opened.state).edit(retypeIntro("First in"))
    const loser = editor(opened.state).edit(retitleField("Second in"))
    let raced = false

    // Just as the loser is kept, the winner's update lands.
    const racing = {
      ...deps,
      client: fakeClient(tables, () => {
        if (!raced) {
          raced = true
          tables.working_copy_rooms[0]!.revision = 1
          tables.working_copy_updates.push({ actor_user_id: OWNER_ID, org_id: ORG_ID, revision: 1, room_id: opened.roomId, update: `\\x${Buffer.from(winner).toString("hex")}` })
        }
      }) as never,
    }

    await expect(applyWorkingCopyUpdate({ ...as(MANAGER_ID), roomId: opened.roomId, update: loser }, racing)).resolves.toEqual({ revision: 2 })
    expect(template(tables)).toMatchObject({ content: { blocks: [{ text: "First in" }, { label: "Second in" }] } })
  })

  it("reads the room again when its history is folded away mid-read, rather than save without it", async () => {
    const tables = database()
    const { deps } = harness(tables)
    const opened = await openWorkingCopyRoom(as(MANAGER_ID), deps)
    const mine = editor(opened.state)
    const room = { ...as(MANAGER_ID), roomId: opened.roomId }
    const renamed = mine.edit((copy) => ({ ...copy, title: "Renamed first" }))
    await applyWorkingCopyUpdate({ ...room, update: renamed }, deps)
    await applyWorkingCopyUpdate({ ...room, update: mine.edit(retitleField("Relabelled second")) }, deps)
    let folded = false

    // Between reading the room and reading its updates, someone folds both into its state.
    const folding = {
      ...deps,
      client: fakeClient(tables, undefined, (table) => {
        if (table === "working_copy_updates" && !folded) {
          folded = true
          const kept = tables.working_copy_updates.map((update) => Buffer.from(String(update.update).slice(2), "hex"))
          tables.working_copy_rooms[0] = { ...tables.working_copy_rooms[0], state: `\\x${Buffer.from(Y.mergeUpdates([opened.state, ...kept])).toString("hex")}`, state_revision: 2 }
          tables.working_copy_updates = []
        }
      }) as never,
    }

    await expect(applyWorkingCopyUpdate({ ...room, update: mine.edit(retypeIntro("Typed third")) }, folding)).resolves.toEqual({ revision: 3 })
    expect(template(tables)).toMatchObject({
      content: { blocks: [{ text: "Typed third" }, { label: "Relabelled second" }] },
      title: "Renamed first",
    })
  })

  it("refuses an update built on changes the room never kept", async () => {
    const { deps, tables } = harness()
    const opened = await openWorkingCopyRoom(as(MANAGER_ID), deps)
    const mine = editor(opened.state)
    mine.edit(retypeIntro("Never sent"))
    const after = mine.edit(retypeIntro("Never sent, then this"))

    await expect(applyWorkingCopyUpdate({ ...as(MANAGER_ID), roomId: opened.roomId, update: after }, deps)).rejects.toMatchObject({ statusCode: 409 })
    expect(tables.working_copy_updates).toEqual([])
  })

  it("brings in a change made outside the room when the room next opens", async () => {
    const { broadcast, deps, tables } = harness()
    const opened = await openWorkingCopyRoom(as(MANAGER_ID), deps)

    Object.assign(template(tables), { revision: 5, title: "Renamed elsewhere" })
    const reopened = await openWorkingCopyRoom(as(MANAGER_ID), deps)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, reopened.state)

    expect(reopened).toMatchObject({ revision: 1, roomId: opened.roomId })
    expect(readWorkingCopyDoc(doc).title).toBe("Renamed elsewhere")
    expect(template(tables)).toMatchObject({ revision: 5 })
    expect(broadcast).toHaveBeenCalledTimes(1)
    await expect(openWorkingCopyRoom(as(MANAGER_ID), deps)).resolves.toMatchObject({ revision: 1 })
  })

  it("publishes only what the person publishing has seen, once the template holds it", async () => {
    const { deps, tables } = harness()
    const publishTemplate = vi.fn(async () => ({}) as never)
    const publishing = { ...deps, publishTemplate }
    const opened = await openWorkingCopyRoom(as(MANAGER_ID), deps)
    const mine = editor(opened.state)
    const room = { ...as(MANAGER_ID), roomId: opened.roomId }

    await applyWorkingCopyUpdate({ ...room, update: mine.edit(retypeIntro("Ready to go")) }, deps)
    await publishTemplateRoom({ ...room, roomRevision: 1 }, publishing)
    expect(publishTemplate).toHaveBeenCalledWith(
      { actorUserId: MANAGER_ID, expectedRevision: 5, organizationId: ORG_ID, templateId: tables.document_templates[0]!.id },
      expect.anything()
    )

    // Someone's change landed after this editor last caught up.
    await applyWorkingCopyUpdate({ ...as(OWNER_ID), roomId: opened.roomId, update: editor(opened.state).edit(retitleField("Their label")) }, deps)
    await expect(publishTemplateRoom({ ...room, roomRevision: 1 }, publishing)).rejects.toMatchObject({ statusCode: 409 })

    // A label cleared and not yet written again can't be published.
    const caughtUp = editor((await openWorkingCopyRoom(as(MANAGER_ID), deps)).state)
    await applyWorkingCopyUpdate({ ...room, update: caughtUp.edit(retitleField("")) }, deps)
    await expect(publishTemplateRoom({ ...room, roomRevision: 3 }, publishing)).rejects.toMatchObject({ statusCode: 400 })
    expect(publishTemplate).toHaveBeenCalledTimes(1)
  })

  it("signs addresses only for pictures the room's working copy holds", async () => {
    const { deps } = harness()
    const opened = await openWorkingCopyRoom(as(MANAGER_ID), deps)
    const picture = { height: 10, id: "60000000-0000-4000-8000-000000000001", type: "png" as const, width: 10 }
    const update = editor(opened.state).edit((copy) => ({
      ...copy,
      content: { ...copy.content, branding: { ...copy.content.branding, logoAsset: picture } },
    }))
    await applyWorkingCopyUpdate({ ...as(MANAGER_ID), roomId: opened.roomId, update }, deps)

    const urls = await signWorkingCopyPictures(
      { ...as(MANAGER_ID), assetIds: [picture.id, "60000000-0000-4000-8000-000000000002"], roomId: opened.roomId },
      { ...deps, signPictures: (async (content: TemplateContentV3) => ({ ...content, branding: { ...content.branding, logoAsset: { ...picture, url: "https://files.example/logo" } } })) as never }
    )

    expect(urls).toEqual({ [picture.id]: "https://files.example/logo" })
    await expect(signWorkingCopyPictures({ ...as(STAFF_ID), assetIds: [picture.id], roomId: opened.roomId }, deps)).rejects.toMatchObject({ statusCode: 403 })
  })

  it("catches an editor up from where it was, and folds a long history into one state", async () => {
    const { deps, tables } = harness()
    const opened = await openWorkingCopyRoom(as(MANAGER_ID), deps)
    const mine = editor(opened.state)
    const room = { ...as(MANAGER_ID), roomId: opened.roomId }

    for (let step = 1; step <= 101; step += 1) {
      await applyWorkingCopyUpdate({ ...room, update: mine.edit(retypeIntro(`Draft ${step}`)) }, deps)
    }

    const behind = await readWorkingCopySince({ ...room, afterRevision: 0 }, deps)
    const recent = await readWorkingCopySince({ ...room, afterRevision: 100 }, deps)
    const late = new Y.Doc()
    Y.applyUpdate(late, opened.state)
    for (const update of behind.updates) Y.applyUpdate(late, update)

    expect(tables.working_copy_rooms[0]).toMatchObject({ revision: 101, state_revision: 100 })
    expect(tables.working_copy_updates.map((update) => update.revision)).toEqual([101])
    expect(recent).toMatchObject({ revision: 101, updates: [expect.any(Uint8Array)] })
    expect(readWorkingCopyDoc(late)).toEqual(readWorkingCopyDoc(mine.doc))
    expect(template(tables)).toMatchObject({ content: { blocks: [{ text: "Draft 101" }, { label: "Client name" }] } })
  })
})
