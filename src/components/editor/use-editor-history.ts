"use client"

import { useCallback, useState } from "react"

type History<State> = {
  future: State[]
  lastAt: number
  lastKey: string | null
  past: State[]
  present: State
}

const LIMIT = 100
// Keystrokes in one line within this long undo together, like a word processor.
const COALESCE_MS = 1_000

/**
 * Holds editor state with undo and redo. Changes that share a key close
 * together, such as typing in one line, undo as one step.
 *
 * @param initial - The state the editor opened with.
 * @returns The current state, a way to change it, and undo, redo and reset.
 */
export function useEditorHistory<State>(initial: State): {
  canRedo: boolean
  canUndo: boolean
  redo: () => void
  reset: (state: State) => void
  set: (update: (state: State) => State, coalesceKey?: string) => void
  state: State
  undo: () => void
} {
  const [history, setHistory] = useState<History<State>>({
    future: [],
    lastAt: 0,
    lastKey: null,
    past: [],
    present: initial,
  })

  const set = useCallback((update: (state: State) => State, coalesceKey?: string): void => {
    setHistory((current) => {
      const next = update(current.present)

      if (Object.is(next, current.present)) {
        return current
      }

      const now = Date.now()
      const joins =
        coalesceKey !== undefined &&
        coalesceKey === current.lastKey &&
        now - current.lastAt < COALESCE_MS

      return {
        future: [],
        lastAt: now,
        lastKey: coalesceKey ?? null,
        past: joins ? current.past : [...current.past.slice(-(LIMIT - 1)), current.present],
        present: next,
      }
    })
  }, [])

  const undo = useCallback((): void => {
    setHistory((current) => {
      const previous = current.past.at(-1)

      return previous === undefined
        ? current
        : {
            future: [current.present, ...current.future],
            lastAt: 0,
            lastKey: null,
            past: current.past.slice(0, -1),
            present: previous,
          }
    })
  }, [])

  const redo = useCallback((): void => {
    setHistory((current) => {
      const [next, ...rest] = current.future

      return next === undefined
        ? current
        : {
            future: rest,
            lastAt: 0,
            lastKey: null,
            past: [...current.past, current.present],
            present: next,
          }
    })
  }, [])

  const reset = useCallback((state: State): void => {
    setHistory({ future: [], lastAt: 0, lastKey: null, past: [], present: state })
  }, [])

  return {
    canRedo: history.future.length > 0,
    canUndo: history.past.length > 0,
    redo,
    reset,
    set,
    state: history.present,
    undo,
  }
}
