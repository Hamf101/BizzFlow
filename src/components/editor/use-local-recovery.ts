"use client"

import { useEffect, useRef, useState } from "react"

import { clearLocalDraft, loadLocalDraft, saveLocalDraft, type SavedDraft } from "@/lib/draft-autosave"

/** A copy kept on this device, with the server version it was made on top of. */
type Kept<Value> = { value: Value; version: string }

/**
 * Keeps a copy of unsaved work on this device, so a closed tab or a lost
 * connection never loses it, and offers it back when the editor next opens
 * with something different, but only over the version it was made on, so
 * newer work is never overwritten by an older copy. A copy made on another
 * version waits for the editor's next version, such as the room's once it
 * opens: offered if it is the copy's, and let go if it is not.
 *
 * @param options - The storage key, the work now, the work the server has,
 *   and the version that work is: the server's, or the room's while live.
 * @returns A copy waiting to be restored, and ways to restore or discard it.
 */
export function useLocalRecovery<Value>({
  key,
  saved,
  value,
  version,
}: {
  key: string
  saved: Value
  value: Value
  version: string
}): {
  discard: () => void
  recovery: SavedDraft<Value> | null
  restore: () => Value | null
} {
  const [recovery, setRecovery] = useState<SavedDraft<Value> | null>(null)
  const [waiting, setWaiting] = useState<{ draft: SavedDraft<Kept<Value>>; since: string } | null>(null)
  const [ready, setReady] = useState(false)
  const serialized = JSON.stringify(value)
  const savedSerialized = JSON.stringify(saved)
  // While a copy is offered or waiting, new work is kept beside it rather than over it.
  const offeredKey = `${key}:offered`
  const writeKey = recovery || waiting ? offeredKey : key
  const latestRef = useRef({ ready, savedSerialized, serialized, version, writeKey })

  useEffect(() => {
    latestRef.current = { ready, savedSerialized, serialized, version, writeKey }
  })

  useEffect(() => {
    // Work kept while an earlier copy was offered is the newer of the two.
    const draft = loadLocalDraft<Kept<Value>>(offeredKey) ?? loadLocalDraft<Kept<Value>>(key)
    const timer = window.setTimeout(() => {
      if (draft?.data && JSON.stringify(draft.data.value) !== savedSerialized) {
        if (draft.data.version === version) {
          setRecovery({ ...draft, data: draft.data.value })
        } else {
          setWaiting({ draft, since: version })
        }
      } else {
        clearLocalDraft(key)
      }

      clearLocalDraft(offeredKey)
      setReady(true)
    }, 0)

    return () => window.clearTimeout(timer)
    // Only the copy found when the editor opens is offered back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!waiting || waiting.since === version) {
      return
    }

    const timer = window.setTimeout(() => {
      if (waiting.draft.data.version === version) {
        setRecovery({ ...waiting.draft, data: waiting.draft.data.value })
      } else {
        clearLocalDraft(key)
        clearLocalDraft(offeredKey)
      }

      setWaiting(null)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [key, offeredKey, version, waiting])

  useEffect(() => {
    if (!ready) {
      return
    }

    const timer = window.setTimeout(() => keep(latestRef.current), 800)
    return () => window.clearTimeout(timer)
  }, [ready, savedSerialized, serialized, version, writeKey])

  // Leaving the editor keeps what is there now, without waiting.
  useEffect(() => () => {
    if (latestRef.current.ready) {
      keep(latestRef.current)
    }
  }, [])

  return {
    discard: () => {
      clearLocalDraft(key)
      clearLocalDraft(offeredKey)
      setRecovery(null)
    },
    recovery,
    restore: () => {
      const data = recovery?.data ?? null
      clearLocalDraft(offeredKey)
      setRecovery(null)
      return data
    },
  }
}

function keep(current: { savedSerialized: string; serialized: string; version: string; writeKey: string }): void {
  if (current.serialized === current.savedSerialized) {
    clearLocalDraft(current.writeKey)
  } else {
    saveLocalDraft(current.writeKey, { value: JSON.parse(current.serialized) as unknown, version: current.version })
  }
}
