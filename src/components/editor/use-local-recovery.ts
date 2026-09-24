"use client"

import { useEffect, useState } from "react"

import { clearLocalDraft, loadLocalDraft, saveLocalDraft, type SavedDraft } from "@/lib/draft-autosave"

/**
 * Keeps a copy of unsaved work on this device, so a closed tab or a lost
 * connection never loses it, and offers it back when the editor next opens
 * with something different.
 *
 * @param options - The storage key, the work now, and the work the server has.
 * @returns A copy waiting to be restored, and ways to restore or discard it.
 */
export function useLocalRecovery<Value>({
  key,
  saved,
  value,
}: {
  key: string
  saved: Value
  value: Value
}): {
  discard: () => void
  recovery: SavedDraft<Value> | null
  restore: () => Value | null
} {
  const [recovery, setRecovery] = useState<SavedDraft<Value> | null>(null)
  const [ready, setReady] = useState(false)
  const serialized = JSON.stringify(value)
  const savedSerialized = JSON.stringify(saved)

  useEffect(() => {
    const draft = loadLocalDraft<Value>(key)
    const timer = window.setTimeout(() => {
      if (draft && JSON.stringify(draft.data) !== savedSerialized) {
        setRecovery(draft)
      } else if (draft) {
        clearLocalDraft(key)
      }

      setReady(true)
    }, 0)

    return () => window.clearTimeout(timer)
    // Only the copy found when the editor opens is offered back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!ready || recovery) {
      return
    }

    const timer = window.setTimeout(() => {
      if (serialized === savedSerialized) {
        clearLocalDraft(key)
      } else {
        saveLocalDraft(key, JSON.parse(serialized) as Value)
      }
    }, 800)

    return () => window.clearTimeout(timer)
  }, [key, ready, recovery, savedSerialized, serialized])

  return {
    discard: () => {
      clearLocalDraft(key)
      setRecovery(null)
    },
    recovery,
    restore: () => {
      const data = recovery?.data ?? null
      setRecovery(null)
      return data
    },
  }
}
