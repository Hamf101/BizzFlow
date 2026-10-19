import type { FlowStage } from "@/services/template-flow/contracts"

/** What a Flow request asks for to hear each stage as it starts. */
export const FLOW_STREAM_HEADERS = { Accept: "application/x-ndjson", "Content-Type": "application/json" } as const

export type FlowTurnRead = Readonly<{ ok: true; payload: unknown }> | Readonly<{ error: string; ok: false }>

/**
 * Reads one Flow turn: each stage as the server reaches it, then the answer
 * or the error it ended with. A plain JSON response, such as a refusal before
 * the turn began, reads the same way.
 *
 * @param response - The Flow route's response.
 * @param onStage - Hears each stage as it arrives.
 * @returns The answer, or a message to show.
 */
export async function readFlowTurn(response: Response, onStage: (stage: FlowStage) => void): Promise<FlowTurnRead> {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson") || !response.body) {
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null

    return response.ok ? { ok: true, payload } : { error: readError(payload), ok: false }
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffered = ""

  for (;;) {
    const { done, value } = await reader.read()
    buffered += value ?? ""
    const lines = buffered.split("\n")
    // The last piece may be half a line; it waits for the rest.
    buffered = done ? "" : (lines.pop() ?? "")

    for (const line of lines) {
      if (!line.trim()) continue

      const message = JSON.parse(line) as { error?: unknown; result?: unknown; stage?: FlowStage }

      if (message.stage) onStage(message.stage)
      else if ("result" in message) return { ok: true, payload: message.result }
      else return { error: readError(message), ok: false }
    }

    if (done) return { error: "Flow stopped before it answered. Try again.", ok: false }
  }
}

function readError(payload: { error?: unknown } | null): string {
  return typeof payload?.error === "string" && payload.error ? payload.error : "Flow couldn't answer that. Try again shortly."
}
