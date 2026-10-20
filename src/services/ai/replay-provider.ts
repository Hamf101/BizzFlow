import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"

import * as z from "zod"

import { isProductionRuntime } from "@/lib/env"
import type { AiProvider, AiStructuredGenerationRequest } from "@/services/ai/contracts"
import { AI_PROVIDER_ERROR_CODES, createProviderError } from "@/services/ai/errors"

export const REPLAY_PROVIDER_ID = "replay"

// One recorded answer: served when `match` is part of the request's input and,
// if set, the first attached file hashes to `attachmentSha256`.
const replayFileSchema = z.array(
  z.object({
    match: z.string().min(1),
    attachmentSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    text: z.string(),
    usage: z
      .object({
        cachedTokens: z.number().nullish(),
        inputTokens: z.number().nullable(),
        outputTokens: z.number().nullable(),
        totalTokens: z.number().nullable(),
      })
      .optional(),
  })
)

type ReplayEntry = z.infer<typeof replayFileSchema>[number]

async function readEntries(file: string): Promise<ReplayEntry[]> {
  return replayFileSchema.parse(JSON.parse(await readFile(file, "utf8")))
}

function firstAttachmentHash(request: AiStructuredGenerationRequest): string | undefined {
  const data = request.attachments?.[0]?.data
  return data ? createHash("sha256").update(data).digest("hex") : undefined
}

/**
 * The part of an input that picks one call out: Template Flow's `userMessage`
 * field exactly as JSON.stringify wrote it (the draft beside it may repeat the
 * words), or else the input's end, where Workspace Flow puts the latest message.
 */
function matchKey(input: string): string {
  try {
    const message: unknown = JSON.parse(input)?.userMessage
    if (typeof message === "string") return `"userMessage":${JSON.stringify(message)}`
  } catch {
    // Not JSON: fall through to the tail.
  }
  return input.slice(-120)
}

function refuse(reason: string): never {
  console.error("ai_provider_misconfigured", { reason })
  throw new Error(`Invalid AI environment: ${reason}`)
}

/**
 * Answers Flow from a fixture file instead of a vendor, so e2e runs and demos
 * are deterministic and need no key. The file is read on every call, so an
 * entry added while the server runs is served at once.
 *
 * @param file - Path of the JSON fixture (AI_REPLAY_FILE).
 * @returns A provider that serves the first matching entry.
 * @throws Error on a Vercel production deployment, or without a file.
 */
export function createReplayProvider(file: string | undefined): AiProvider {
  // VERCEL_ENV, not NODE_ENV: e2e and demos run `next start`, a production build.
  if (process.env.VERCEL_ENV === "production") {
    refuse("AI_PROVIDER=replay cannot run in production.")
  }

  if (!file) {
    refuse("AI_PROVIDER=replay needs AI_REPLAY_FILE.")
  }

  return {
    id: REPLAY_PROVIDER_ID,
    async generateStructured(request) {
      const hash = firstAttachmentHash(request)
      const entry = (await readEntries(file)).find(
        (candidate) =>
          request.input.includes(candidate.match) &&
          (candidate.attachmentSha256 === undefined || candidate.attachmentSha256 === hash)
      )

      if (!entry) {
        throw createProviderError({
          failure: {
            code: AI_PROVIDER_ERROR_CODES.INVALID_REQUEST,
            message: `No replay entry in ${file} matches: ${matchKey(request.input).slice(0, 120)}`,
            retryable: false,
          },
          provider: REPLAY_PROVIDER_ID,
          request,
        })
      }

      return {
        model: request.model,
        text: entry.text,
        traceId: request.traceId,
        upstreamCalls: 1,
        usage: entry.usage ?? { inputTokens: null, outputTokens: null, totalTokens: null },
      }
    },
  }
}

/**
 * Wraps a real provider so each answer is appended to a replay file, for
 * recording demo and e2e fixtures from `pnpm dev`.
 *
 * @param file - Replay file to append to (AI_RECORD_FILE); created if missing.
 * @param provider - The real provider that answers.
 * @returns The same provider, recording as it goes.
 * @throws Error in a production build or deployment.
 */
export function recordTo(file: string, provider: AiProvider): AiProvider {
  if (isProductionRuntime()) {
    refuse("AI_RECORD_FILE cannot be used in production.")
  }

  return {
    id: provider.id,
    async generateStructured(request) {
      const result = await provider.generateStructured(request)
      const attachmentSha256 = firstAttachmentHash(request)
      // ponytail: read-modify-write, so two calls finishing together can drop one; fine for a dev recorder.
      // A file that is there but unreadable throws rather than being overwritten.
      const entries = existsSync(file) ? await readEntries(file) : []

      entries.push({ match: matchKey(request.input), ...(attachmentSha256 ? { attachmentSha256 } : {}), text: result.text })
      await writeFile(file, `${JSON.stringify(entries, null, 2)}\n`)

      return result
    },
  }
}
