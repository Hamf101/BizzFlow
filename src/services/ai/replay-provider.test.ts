import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import type { AiProvider, AiStructuredGenerationRequest } from "@/services/ai/contracts"
import { AiProviderError } from "@/services/ai/errors"
import { createAiRuntime } from "@/services/ai/provider-factory"
import { recordTo } from "@/services/ai/replay-provider"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

function fixtureFile(entries: unknown[]): string {
  const path = join(mkdtempSync(join(tmpdir(), "ai-replay-")), "replay.json")
  writeFileSync(path, JSON.stringify(entries))
  return path
}

function useReplay(file: string): void {
  // No API key: replay must never ask for one.
  process.env = { NODE_ENV: "test", AI_PROVIDER: "replay", AI_REPLAY_FILE: file }
}

function ask(input: string, attachment?: Uint8Array, model?: string) {
  const runtime = createAiRuntime(model ? { model } : {})
  const request: AiStructuredGenerationRequest = {
    attachments: attachment ? [{ data: attachment, kind: "document", mimeType: "application/pdf" }] : undefined,
    input,
    maxOutputTokens: 400,
    model: runtime.model,
    responseSchema: {},
    systemInstruction: "Be Flow.",
    traceId: "trace-1",
  }
  return runtime.provider.generateStructured(request)
}

describe("AI replay provider", () => {
  it("serves the first matching fixture through the real factory, whichever model a member picked", async () => {
    useReplay(fixtureFile([
      { match: "plumbing quote", text: '{"reply":"first"}' },
      { match: "quote", text: '{"reply":"second"}' },
    ]))

    const result = await ask('{"userMessage":"Make a plumbing quote"}', undefined, "gemini-3.5-flash")

    expect(result).toMatchObject({ text: '{"reply":"first"}', traceId: "trace-1", upstreamCalls: 1 })
    expect(result.model).toEqual({ provider: "replay", model: "gemini-3.5-flash" })
  })

  it("names the unmatched request so a fixture can be added", async () => {
    useReplay(fixtureFile([{ match: "plumbing quote", text: "{}" }]))

    const failure = ask("Latest message:\nFind my invoices from March")

    await expect(failure).rejects.toBeInstanceOf(AiProviderError)
    await expect(failure).rejects.toThrow("Find my invoices from March")
  })

  it("tells two entries apart by the attached file's hash", async () => {
    const { createHash } = await import("node:crypto")
    const scan = new Uint8Array([1, 2, 3])
    useReplay(fixtureFile([
      { attachmentSha256: createHash("sha256").update(new Uint8Array([9])).digest("hex"), match: "recreate", text: "other" },
      { attachmentSha256: createHash("sha256").update(scan).digest("hex"), match: "recreate", text: "this scan" },
    ]))

    await expect(ask("recreate this form", scan)).resolves.toMatchObject({ text: "this scan" })
    await expect(ask("recreate this form", new Uint8Array([7]))).rejects.toBeInstanceOf(AiProviderError)
  })

  it("refuses replay and recording in a production deployment, even with the file set", () => {
    const file = fixtureFile([])

    process.env = { NODE_ENV: "production", VERCEL_ENV: "production", AI_PROVIDER: "replay", AI_REPLAY_FILE: file }
    expect(() => createAiRuntime()).toThrow("production")

    process.env = { NODE_ENV: "production", VERCEL_ENV: "production", GEMINI_API_KEY: "key", AI_RECORD_FILE: file }
    expect(() => createAiRuntime()).toThrow("production")
  })

  it("records a real call that replay then serves", async () => {
    const file = fixtureFile([])
    const scan = new Uint8Array([4, 5, 6])
    const real: AiProvider = {
      id: "gemini",
      generateStructured: async (request) => ({
        model: request.model,
        text: '{"reply":"recorded"}',
        traceId: "upstream-1",
        upstreamCalls: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
    }
    // The draft repeats the message, so only the userMessage field picks this call out.
    const input = JSON.stringify({ currentDraft: { title: "Quote" }, userMessage: "Quote" })

    await recordTo(file, real).generateStructured({
      attachments: [{ data: scan, kind: "image", mimeType: "image/png" }],
      input,
      maxOutputTokens: 400,
      model: { provider: "gemini", model: "gemini-3.8-flash" },
      responseSchema: {},
      systemInstruction: "Be Flow.",
      traceId: "trace-1",
    })
    useReplay(file)

    await expect(ask(input, scan)).resolves.toMatchObject({ text: '{"reply":"recorded"}' })
    await expect(ask(JSON.stringify({ currentDraft: { title: "Quote" }, userMessage: "Other" }), scan)).rejects.toThrow()
  })
})
