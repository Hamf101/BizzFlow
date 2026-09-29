"use client"

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"

import type { LiveSession, LiveStatus } from "@/lib/collaboration/live-session"

import { useEditorHistory } from "./use-editor-history"

type Update<State> = (state: State) => State

// Changes waiting for the room; past this many they are left to local recovery.
const MOST_WAITING = 1_000
// Rooms whose copy already holds what was made here before they opened.
const caughtUp = new WeakSet<object>()

/**
 * Editor state with undo and redo that becomes shared once the working copy's
 * room opens. Until then the state and its undo are the editor's own; changes
 * made meanwhile are made again on the room's copy when it arrives, so nothing
 * typed in the first moment is lost and nobody else's work is written over.
 * A change asked for by something started before the room opened, such as a
 * picture still uploading, reaches the room all the same. Live, undo takes
 * back only this person's own changes.
 *
 * @param initial - The state the editor opened with.
 * @param session - The room's live session, once it is open.
 * @returns The state, a way to change it, undo and redo, and how saving stands when live.
 */
export function useWorkingCopyHistory<State>(
  initial: State,
  session: LiveSession<State> | null
): Readonly<{
  canRedo: boolean
  canUndo: boolean
  liveStatus: LiveStatus | null
  redo: () => void
  set: (update: Update<State>, coalesceKey?: string) => void
  state: State
  undo: () => void
}> {
  const local = useEditorHistory(initial)
  const live = useRef<LiveSession<State> | null>(null)
  const waiting = useRef<Array<readonly [Update<State>, string | undefined]>>([])
  // Undo before the room opened leaves changes that cannot be made again one by one.
  const replayable = useRef(true)
  const localState = useRef(local.state)
  const { redo: localRedo, set: localSet, undo: localUndo } = local
  // The room's copy shows only once what was made here before it opened is on
  // it too; a moment without it would take away the line being typed in.
  const active = session && caughtUp.has(session) ? session : null
  const state = useSyncExternalStore(
    session?.subscribe ?? subscribeNever,
    () => (session && caughtUp.has(session) ? session.snapshot() : local.state),
    () => local.state
  )

  useEffect(() => {
    localState.current = local.state
  })

  useEffect(() => {
    live.current = session

    if (!session) {
      return
    }

    const made = waiting.current.splice(0)

    if (replayable.current) {
      for (const [update, coalesceKey] of made) {
        session.change(update, coalesceKey)
      }
    } else if (JSON.stringify(session.snapshot()) === JSON.stringify(initial)) {
      // Nobody else has changed it since it opened, so this editor's copy can stand as it is.
      session.change(() => localState.current)
    }
    // Otherwise the copy stays on this device, where recovery offers it back.

    caughtUp.add(session)
    session.refresh()
  }, [initial, session])

  // Each looks for the room when called, so one kept from before the room opened still reaches it.
  const set = useCallback(
    (update: Update<State>, coalesceKey?: string): void => {
      if (live.current) {
        live.current.change(update, coalesceKey)
        return
      }

      if (waiting.current.length < MOST_WAITING) {
        waiting.current.push([update, coalesceKey])
      }

      localSet(update, coalesceKey)
    },
    [localSet]
  )
  const undo = useCallback((): void => {
    if (live.current) {
      live.current.undo()
      return
    }

    replayable.current = false
    localUndo()
  }, [localUndo])
  const redo = useCallback((): void => {
    if (live.current) {
      live.current.redo()
      return
    }

    replayable.current = false
    localRedo()
  }, [localRedo])

  return {
    canRedo: active ? active.canRedo() : local.canRedo,
    canUndo: active ? active.canUndo() : local.canUndo,
    liveStatus: active ? active.status() : null,
    redo,
    set,
    state,
    undo,
  }
}

function subscribeNever(): () => void {
  return () => undefined
}
