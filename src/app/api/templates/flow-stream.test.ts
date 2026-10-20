import { expect, it } from "vitest"

import { FLOW_STREAM_TYPE, streamFlowTurn } from "@/app/api/templates/_utils"
import { TemplateFlowServiceError } from "@/services/template-flow-service"

const asking = (accept: string): Request => new Request("https://app.bizflow.test/api/flow", { headers: { accept } })
const lines = async (response: Response): Promise<unknown[]> =>
  (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown)

it("streams each stage as it starts, then the answer", async () => {
  const response = await streamFlowTurn(asking(FLOW_STREAM_TYPE), "test_flow", async (onStage) => {
    onStage("thinking")
    onStage("finding")
    return { kind: "reply", reply: "Done." }
  })

  expect(response.headers.get("content-type")).toContain(FLOW_STREAM_TYPE)
  expect(await lines(response)).toEqual([{ stage: "thinking" }, { stage: "finding" }, { result: { kind: "reply", reply: "Done." } }])
})

it("ends a stream that fails with the same safe message a plain answer gives", async () => {
  const response = await streamFlowTurn(asking(FLOW_STREAM_TYPE), "test_flow", async (onStage) => {
    onStage("writing")
    throw new TemplateFlowServiceError("Flow is busy. Wait a minute and try again.", 429)
  })

  expect(await lines(response)).toEqual([{ stage: "writing" }, { error: "Flow is busy. Wait a minute and try again.", status: 429 }])
})

it("answers in one piece when the caller doesn't read a stream", async () => {
  const response = await streamFlowTurn(asking("application/json"), "test_flow", async (onStage) => {
    onStage("thinking")
    return { kind: "reply", reply: "Done." }
  })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ kind: "reply", reply: "Done." })
})
