import { describe, expect, it } from "vitest"

import { getEditorLayout, saveEditorLayout } from "@/services/editor-layout-service"
import { PostgrestReadQuery, type FakeRow, type PostgrestFakeResult } from "@/services/postgrest-fake.test-support"

class ProfileQuery extends PostgrestReadQuery {
  private values: FakeRow | null = null
  update(values: FakeRow): this {
    this.values = values
    return this
  }
  protected override execute(): PostgrestFakeResult {
    const result = super.execute()
    if (this.values) result.data?.forEach((row) => Object.assign(row, this.values))
    return result
  }
}

function fixture() {
  const profiles: FakeRow[] = [
    { id: "user-1", editor_layout: {} },
    { id: "user-2", editor_layout: { zoom: { x: 0, y: 0 } } },
  ]
  const deps = { client: { from: () => new ProfileQuery(profiles) } as never }
  return { deps, profiles }
}

const layout = { dock: { orientation: "flat", x: 0.5, y: 1 }, zoom: { x: 0.25, y: 0 } }

describe("editor layout", () => {
  it("keeps a person's own layout for their next session and leaves everyone else's alone", async () => {
    const { deps, profiles } = fixture()
    await saveEditorLayout({ actorUserId: "user-1", layout }, deps)
    expect(await getEditorLayout({ actorUserId: "user-1" }, deps)).toEqual(layout)
    expect(profiles[1].editor_layout).toEqual({ zoom: { x: 0, y: 0 } })
  })

  it.each([
    { dock: { orientation: "flat", x: 1.5, y: 0 } },
    { dock: { orientation: "sideways", x: 0, y: 0 } },
    { zoom: { x: 0, y: 0 }, theme: "dark" },
  ])("rejects a layout outside the editor, %j, without writing it", async (bad) => {
    const { deps, profiles } = fixture()
    await expect(saveEditorLayout({ actorUserId: "user-1", layout: bad }, deps)).rejects.toMatchObject({ statusCode: 400 })
    expect(profiles[0].editor_layout).toEqual({})
  })

  it("reads a layout that no longer fits as the editor's own arrangement", async () => {
    const { deps, profiles } = fixture()
    profiles[0].editor_layout = { dock: { orientation: "diagonal", x: 3, y: 0 } }
    expect(await getEditorLayout({ actorUserId: "user-1" }, deps)).toEqual({})
  })
})
