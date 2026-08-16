import { describe, expect, it } from "vitest"

import { STARTER_TEMPLATES } from "./starter-templates"

describe("starter-templates", () => {
  it("provides valid starter template definitions", () => {
    expect(STARTER_TEMPLATES.length).toBeGreaterThanOrEqual(3)

    for (const starter of STARTER_TEMPLATES) {
      expect(starter.title).toBeTruthy()
      expect(starter.description).toBeTruthy()
      expect(starter.category).toBeTruthy()
      expect(starter.content.schemaVersion).toBe(3)
      expect(starter.content.blocks.length).toBeGreaterThan(0)
    }
  })
})
