import * as Y from "yjs"

import { newWorkingCopyDoc, readWorkingCopyDoc, type WorkingCopy, workingCopyRoot, writeWorkingCopyDoc } from "./working-copy-doc"

/** How an editor reaches its room: keep a change, read what came after a revision, start over. */
export type RoomTransport = Readonly<{
  readSince: (afterRevision: number) => Promise<{ revision: number; updates: Uint8Array[] }>
  reopen: () => Promise<{ revision: number; state: Uint8Array }>
  send: (update: Uint8Array) => Promise<{ revision: number }>
}>

/** A refusal from the room: the change can never be kept as it is. */
export class RoomRefusal extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "RoomRefusal"
    this.status = status
  }
}

/** Where this editor's changes stand, as the top bar says it; stopped once it may no longer edit here. */
export type LiveStatus = "offline" | "saved" | "saving" | "stopped"

/** An editor's live copy of a room: what it shows, how to change it, and how its changes are kept. */
export type LiveSession<State> = Readonly<{
  canRedo: () => boolean
  canUndo: () => boolean
  change: (update: (state: State) => State, coalesceKey?: string) => void
  /** Hears that a change was kept, so the session fetches it when it is new. */
  hear: (revision: number) => void
  /** Fetches whatever this copy has missed, as after a reconnect. */
  catchUp: () => Promise<void>
  /** Sends what is waiting now; resolves once everything made so far is kept. */
  flush: () => Promise<boolean>
  redo: () => void
  /** Reads the copy again, as when something it is shown with, such as a picture's address, arrived. */
  refresh: () => void
  /** The last revision of the room this copy holds. */
  revision: () => number
  snapshot: () => State
  status: () => LiveStatus
  stop: () => void
  subscribe: (listener: () => void) => () => void
  undo: () => void
}>

const REMOTE = "remote"
const LOCAL = "local"
// Keystrokes are gathered for this long before they are sent, and never longer than the most.
const GATHER_MS = 300
const MOST_MS = 1_500
const RETRY_MS = [1_000, 3_000, 8_000, 15_000]

/**
 * Starts editing a room's working copy live. What the editor shows is always
 * the shared document; each change the person makes is written into it as the
 * smallest edits that get there, gathered for a moment and sent to be kept.
 * Changes others make are fetched when the room says they were kept, and
 * undo takes back only this person's own changes.
 *
 * @param options - The room as opened, how to reach it, and how the editor's
 *   state maps to a working copy.
 * @returns The live session.
 */
export function startLiveSession<State>(options: Readonly<{
  fromCopy: (copy: WorkingCopy) => State
  onRefused?: (message: string) => void
  opened: Readonly<{ revision: number; state: Uint8Array }>
  toCopy: (state: State) => WorkingCopy
  transport: RoomTransport
}>): LiveSession<State> {
  const listeners = new Set<() => void>()
  let doc = newWorkingCopyDoc()
  let undoManager: Y.UndoManager
  let revision = options.opened.revision
  // What the room last confirmed this copy holds, to come back to when editing stops.
  let confirmed = { revision: options.opened.revision, state: options.opened.state }
  let copy: WorkingCopy
  let state: State
  let dirty = false
  let pending: Uint8Array[] = []
  let sending: Promise<boolean> | null = null
  let catching: Promise<void> | null = null
  let catchAgain = false
  let current: LiveStatus = "saved"
  let gatherTimer: ReturnType<typeof setTimeout> | undefined
  let firstPendingAt = 0
  let retry = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let lastKey: string | undefined
  let stopped = false

  const notify = (): void => listeners.forEach((listener) => listener())
  const setStatus = (next: LiveStatus): void => {
    if (current !== next) {
      current = next
      notify()
    }
  }

  function begin(opened: Readonly<{ revision: number; state: Uint8Array }>): void {
    undoManager?.destroy()
    doc.destroy()
    doc = newWorkingCopyDoc()
    Y.applyUpdate(doc, opened.state, REMOTE)
    revision = opened.revision
    copy = readWorkingCopyDoc(doc)
    state = options.fromCopy(copy)
    undoManager = new Y.UndoManager(workingCopyRoot(doc), { captureTimeout: 1_000, trackedOrigins: new Set([LOCAL]) })
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      dirty = true

      if (origin !== REMOTE) {
        pending.push(update)
        // Waiting to be kept already counts as saving; offline stays offline until it is back.
        if (current === "saved") {
          current = "saving"
        }
        schedule()
      }

      notify()
    })
  }

  function read(): State {
    if (dirty) {
      dirty = false
      copy = keepUnchanged(copy, readWorkingCopyDoc(doc))
      state = options.fromCopy(copy)
    }

    return state
  }

  function schedule(): void {
    clearTimeout(gatherTimer)
    const now = Date.now()
    firstPendingAt ||= now
    gatherTimer = setTimeout(() => void flush(), Math.max(0, Math.min(GATHER_MS, firstPendingAt + MOST_MS - now)))
  }

  async function flush(): Promise<boolean> {
    clearTimeout(gatherTimer)

    if (sending) {
      // Whatever was made while that send was out goes next.
      return sending.then((kept) => (kept && pending.length > 0 ? flush() : kept))
    }

    if (stopped || pending.length === 0) {
      return !stopped
    }

    sending = send().finally(() => {
      sending = null
    })
    return sending
  }

  async function send(): Promise<boolean> {
    while (pending.length > 0 && !stopped) {
      const count = pending.length
      const update = Y.mergeUpdates(pending.slice(0, count))
      firstPendingAt = 0
      setStatus("saving")

      try {
        const kept = await options.transport.send(update)
        pending = pending.slice(count)
        retry = 0

        if (kept.revision === revision + 1) {
          revision = kept.revision
        } else if (kept.revision > revision) {
          await catchUp()
        }
      } catch (error: unknown) {
        if (error instanceof RoomRefusal) {
          options.onRefused?.(error.message)
          pending = []

          try {
            if (error.status === 403 || error.status === 404) {
              throw error
            }

            // The room will never keep this; start again from what it has.
            begin(await options.transport.reopen())
            setStatus("saved")
          } catch {
            // This person may no longer edit here: back to what the room kept, and nothing more is sent.
            begin(confirmed)
            stopped = true
            setStatus("stopped")
          }

          notify()
          return false
        }

        setStatus("offline")
        clearTimeout(retryTimer)
        retryTimer = setTimeout(() => void flush(), RETRY_MS[Math.min(retry, RETRY_MS.length - 1)])
        retry += 1
        return false
      }
    }

    confirm()
    setStatus("saved")
    return true
  }

  function confirm(): void {
    if (pending.length === 0) {
      confirmed = { revision, state: Y.encodeStateAsUpdate(doc) }
    }
  }

  async function catchUp(): Promise<void> {
    if (stopped) {
      return
    }

    if (catching) {
      catchAgain = true
      return catching
    }

    catching = (async () => {
      do {
        catchAgain = false
        const { revision: reached, updates } = await options.transport.readSince(revision)
        doc.transact(() => {
          for (const update of updates) Y.applyUpdate(doc, update, REMOTE)
        }, REMOTE)
        revision = Math.max(revision, reached)
        confirm()
      } while (catchAgain && !stopped)
    })()
      .catch(() => {
        if (!stopped) {
          setStatus("offline")
        }
      })
      .finally(() => {
        catching = null
      })

    return catching
  }

  begin(options.opened)

  return {
    canRedo: () => undoManager.redoStack.length > 0,
    canUndo: () => undoManager.undoStack.length > 0,
    catchUp,
    change: (update, coalesceKey) => {
      if (stopped) {
        return
      }

      const before = read()
      const next = update(before)

      if (Object.is(next, before)) {
        return
      }

      // Keystrokes in one place within a second undo together, like a word processor.
      if (coalesceKey === undefined || coalesceKey !== lastKey) {
        undoManager.stopCapturing()
      }

      lastKey = coalesceKey
      writeWorkingCopyDoc(doc, options.toCopy(next), { from: options.toCopy(before), origin: LOCAL })
    },
    flush,
    hear: (kept) => {
      if (kept > revision) {
        void catchUp()
      }
    },
    redo: () => {
      lastKey = undefined
      undoManager.redo()
    },
    refresh: () => {
      dirty = true
      notify()
    },
    revision: () => revision,
    snapshot: read,
    status: () => current,
    stop: () => {
      stopped = true
      clearTimeout(gatherTimer)
      clearTimeout(retryTimer)
      undoManager.destroy()
      doc.destroy()
      listeners.clear()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    undo: () => {
      lastKey = undefined
      undoManager.undo()
    },
  }
}

// The blocks that did not change stay the very same objects, so only what changed draws again.
function keepUnchanged(previous: WorkingCopy, next: WorkingCopy): WorkingCopy {
  const before = new Map(previous.content.blocks.map((block) => [block.id, block]))
  const blocks = next.content.blocks.map((block) => {
    const old = before.get(block.id)
    return old && JSON.stringify(old) === JSON.stringify(block) ? old : block
  })

  return { ...next, content: { ...next.content, blocks } }
}
