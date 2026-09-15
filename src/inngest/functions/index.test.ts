import { describe, expect, it } from "vitest"

import { inngestFunctions } from "@/inngest/functions"

describe("inngestFunctions", () => {
  it("keeps function ids unique so registration cannot collide", () => {
    const ids = inngestFunctions.map(
      (backgroundFunction): string => backgroundFunction.opts.id
    )

    expect(new Set(ids).size).toBe(ids.length)
  })
})
