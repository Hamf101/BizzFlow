import { useEffect, useEffectEvent } from "react"

import type { FlowMentionItem } from "@/components/flow/flow-mentions"

const KEY = "bizflow:flow-handoff"
const FRESH_MS = 60_000

/** An uploaded file attached to Flow, which reads it on every turn while it stays. */
export type FlowSource = Readonly<{ id: string; name: string }>

/** A request for the editor that opens next, the file it is about, and what it mentioned. */
export type FlowHandoff = Readonly<{ instruction: string; mentions?: readonly FlowMentionItem[]; source?: FlowSource }>

/**
 * Leaves a member's request for the editor that opens next, so Flow there
 * carries on with it rather than asking again.
 *
 * @param instruction - What the member asked Flow for.
 * @param source - The file attached to the request, if any.
 * @param mentions - What the request mentioned, which the editor's Flow reads again.
 */
export function handOffToFlow(instruction: string, source?: FlowSource, mentions?: readonly FlowMentionItem[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), instruction, mentions, source }))
  } catch {
    // Storage can be unavailable; the editor then opens without the request.
  }
}

/**
 * Takes a request left in the last minute, once.
 *
 * @returns The request, or null when none is waiting.
 */
export function takeFlowHandoff(): FlowHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    const value = raw
      ? (JSON.parse(raw) as { at?: unknown; instruction?: unknown; mentions?: unknown; source?: { id?: unknown; name?: unknown } })
      : null

    if (!value || typeof value.at !== "number" || Date.now() - value.at >= FRESH_MS || typeof value.instruction !== "string") {
      return null
    }

    const { id, name } = value.source ?? {}
    // Only their ids and kinds go to the server, which checks each one again.
    const mentions = (Array.isArray(value.mentions) ? value.mentions : []).filter(
      (item): item is FlowMentionItem => typeof item?.id === "string" && typeof item.kind === "string" && typeof item.name === "string"
    )

    return {
      instruction: value.instruction,
      ...(mentions.length > 0 ? { mentions } : {}),
      ...(typeof id === "string" && typeof name === "string" ? { source: { id, name } } : {}),
    }
  } catch {
    return null
  }
}

/**
 * Hands an editor the request a workspace page left for it, once, as it opens.
 *
 * @param onRequest - Opens Flow and sends the request.
 */
export function useFlowHandoff(onRequest: (request: FlowHandoff) => void): void {
  const arrive = useEffectEvent(onRequest)

  useEffect(() => {
    // Taken inside the timer, so a development double-run cannot drop it.
    const timer = window.setTimeout(() => {
      const request = takeFlowHandoff()

      if (request) {
        arrive(request)
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])
}
