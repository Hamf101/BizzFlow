"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/** What a save reports back: the version to save from next, or why it failed. */
export type SaveResult =
  | Readonly<{ ok: true; version: string }>
  | Readonly<{ message: string; ok: false; status: number }>

/** Where saving stands, as the top bar says it. */
export type AutosaveStatus = "conflict" | "error" | "offline" | "saved" | "saving" | "unsaved"

const RETRY_MS = 5_000

/**
 * Saves a value shortly after it stops changing, one save at a time, always
 * from the latest version the server returned. A conflict stops saving until
 * the page is reloaded, so nobody's work is overwritten; a lost connection
 * retries on its own.
 *
 * @param options - The value, the version it was loaded at, whether saving is
 *   allowed, and how to save.
 * @returns Where saving stands, and a way to save now.
 */
export function useAutosave<Value>({
  delay = 900,
  enabled,
  initialVersion,
  save,
  value,
}: {
  delay?: number
  enabled: boolean
  initialVersion: string
  save: (value: Value, version: string) => Promise<SaveResult>
  value: Value
}): { flush: () => Promise<boolean>; status: AutosaveStatus } {
  const serialized = JSON.stringify(value)
  const [status, setStatus] = useState<AutosaveStatus>("saved")
  const savedRef = useRef(serialized)
  const versionRef = useRef(initialVersion)
  const latestRef = useRef({ serialized, value })
  const runningRef = useRef<Promise<boolean> | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const stoppedRef = useRef(false)
  const saveRef = useRef(save)

  useEffect(() => {
    latestRef.current = { serialized, value }
    saveRef.current = save
  })

  const run = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timerRef.current)

    // Wait out every save already running, not only the one found first: two
    // callers that resume together must not send one version twice, which the
    // server would answer with a conflict that stops saving for good.
    while (runningRef.current) {
      await runningRef.current
    }

    const { serialized: attempt, value: current } = latestRef.current

    if (stoppedRef.current || attempt === savedRef.current) {
      return !stoppedRef.current
    }

    setStatus("saving")

    const running = (async (): Promise<boolean> => {
      try {
        const result = await saveRef.current(current, versionRef.current)

        if (result.ok) {
          versionRef.current = result.version
          savedRef.current = attempt
          setStatus(latestRef.current.serialized === attempt ? "saved" : "unsaved")
          return true
        }

        if (result.status === 409) {
          stoppedRef.current = true
          setStatus("conflict")
          return false
        }

        setStatus("error")
        return false
      } catch {
        setStatus("offline")
        return false
      } finally {
        runningRef.current = null
      }
    })()

    runningRef.current = running

    // A change made while this save ran has its own save waiting on it.
    return running
  }, [])

  useEffect(() => {
    if (!enabled || stoppedRef.current || serialized === savedRef.current) {
      return
    }

    setStatus((current) => (current === "offline" || current === "saving" ? current : "unsaved"))
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => void run(), delay)

    return () => window.clearTimeout(timerRef.current)
  }, [delay, enabled, run, serialized])

  // A lost connection retries on its own.
  useEffect(() => {
    if (status !== "offline") {
      return
    }

    const timer = window.setTimeout(() => void run(), RETRY_MS)
    return () => window.clearTimeout(timer)
  }, [run, status])

  useEffect(() => {
    function warn(event: BeforeUnloadEvent): void {
      if (latestRef.current.serialized !== savedRef.current && !stoppedRef.current) {
        event.preventDefault()
      }
    }

    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [])

  return { flush: run, status }
}
