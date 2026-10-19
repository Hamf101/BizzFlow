import { expect, it } from "vitest"

import { readFlowTurn } from "@/components/flow/flow-stream"

const streamed = (...lines: object[]): Response => {
  const encoder = new TextEncoder()
  const text = lines.map((line) => `${JSON.stringify(line)}\n`).join("")
  // Split mid-line, as a network delivers it.
  const chunks = [text.slice(0, 7), text.slice(7, 30), text.slice(30)]

  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } }
  )
}

it("hears each stage as it comes, then gives the answer", async () => {
  const stages: string[] = []

  await expect(readFlowTurn(streamed({ stage: "thinking" }, { stage: "finding" }, { result: { reply: "Done." } }), (stage) => stages.push(stage))).resolves.toEqual({
    ok: true,
    payload: { reply: "Done." },
  })
  expect(stages).toEqual(["thinking", "finding"])
})

it("gives the error a stream ends with, or a plain response's", async () => {
  await expect(readFlowTurn(streamed({ stage: "writing" }, { error: "Flow is busy.", status: 429 }), () => undefined)).resolves.toEqual({ error: "Flow is busy.", ok: false })
  await expect(readFlowTurn(Response.json({ error: "Sign in again." }, { status: 401 }), () => undefined)).resolves.toEqual({ error: "Sign in again.", ok: false })
  // A stream cut off before its answer is a failure, not a hang.
  await expect(readFlowTurn(streamed({ stage: "writing" }), () => undefined)).resolves.toEqual({ error: "Flow stopped before it answered. Try again.", ok: false })
})
