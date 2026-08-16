import { describe, expect, it } from "vitest"

import { inngestFunctions } from "@/inngest/functions"
import { processDueRemindersFunction } from "@/inngest/functions/process-due-reminders"
import { taskAssignedFunction } from "@/inngest/functions/task-assigned"

describe("inngestFunctions", () => {
  it("serves every background function exactly once", () => {
    expect(inngestFunctions).toEqual([
      processDueRemindersFunction,
      taskAssignedFunction,
    ])
  })

  it("keeps function ids unique so registration cannot collide", () => {
    const ids = inngestFunctions.map(
      (backgroundFunction): string => backgroundFunction.opts.id
    )

    expect(new Set(ids).size).toBe(ids.length)
  })
})
