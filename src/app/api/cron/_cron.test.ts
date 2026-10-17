import { afterEach, describe, expect, it, vi } from "vitest"

import { setCronMonitor } from "@/lib/observability"

import { monitoredCronResponse } from "./_cron"

afterEach(() => setCronMonitor(null))

describe("monitoredCronResponse", () => {
  it("reports a run that answered 500 as failed, and still answers with it", async () => {
    const outcomes: string[] = []
    setCronMonitor(async (slug, _schedule, job) => {
      try {
        const result = await job()
        outcomes.push(`${slug}:ok`)
        return result
      } catch (error) {
        outcomes.push(`${slug}:failed`)
        throw error
      }
    })

    const failed = await monitoredCronResponse("purge", "45 3 * * *", async () => new Response("no", { status: 500 }))
    const passed = await monitoredCronResponse("purge", "45 3 * * *", async () => new Response("ok", { status: 200 }))

    expect([failed.status, passed.status]).toEqual([500, 200])
    expect(outcomes).toEqual(["purge:failed", "purge:ok"])
  })

  it("just runs the work when no monitor is set up", async () => {
    const work = vi.fn(async () => new Response("ok"))

    await expect(monitoredCronResponse("purge", "45 3 * * *", work)).resolves.toHaveProperty("status", 200)
    expect(work).toHaveBeenCalledOnce()
  })
})
