"use client"

import type { RealtimeChannel, RealtimeClient } from "@supabase/realtime-js"
import { useCallback, useEffect, useRef, useState } from "react"

import { bizflowToast } from "@/components/ui/toaster"
import type { LiveSession, RoomTransport } from "@/lib/collaboration/live-session"
import type { WorkingCopy } from "@/lib/collaboration/working-copy-doc"

/** Someone else in the room: who, in what colour, and where they are. */
export type RoomPerson = Readonly<{
  blockId: string | null
  /** The line their caret is in, and where in its words, while they write. */
  caret: Readonly<{ key: string; offset: number }> | null
  color: string
  key: string
  name: string
  userId: string
}>

/** Where this person is, as the others see it. */
export type RoomPlace = Readonly<{ blockId: string | null; caret: Readonly<{ key: string; offset: number }> | null }>

/** How many times each kind of note changed while this editor was in the room. */
export type RoomNotesSeen = Readonly<{ chat: number; checkpoints: number; comments: number }>

type OpenedRoom = Readonly<{
  realtime: Readonly<{ expiresAt: number | null; key: string; token: string | null; url: string }>
  revision: number
  roomId: string
  state: string
  topic: string
}>

type Refusal = new (message: string, status: number) => Error

// Muted enough for the page's plum; no yellow.
const COLORS = ["#3e7d74", "#ad566c", "#4d6fa3", "#7b5aa6", "#4f7f4a", "#a0624a", "#5b6b7a"]
// Statuses that mean the room will not keep this as it is, whatever happens next.
const REFUSED = new Set([400, 403, 404, 409, 413, 422])
const PLACE_EVERY_MS = 150

/**
 * Opens a working copy's room and keeps this editor in it: the shared copy,
 * word from the room when anyone's change is kept, and who else is here.
 * Nothing about the room loads with the page; it arrives once the page is up,
 * and until then, or if the room cannot be reached, the editor works alone.
 *
 * @param options - Where the room is, who this is, and how the editor's state
 *   maps to a working copy.
 * @returns The live session once the room is open, the others in it, and a
 *   way to say where this person is.
 */
export function useLiveRoom<State>(options: Readonly<{
  enabled: boolean
  fromCopy: (copy: WorkingCopy) => State
  me: Readonly<{ id: string; name: string }>
  onRefused: (message: string) => void
  path: string
  toCopy: (state: State) => WorkingCopy
}>): Readonly<{
  /** Keeps the copy as it stands under a name, once everything made here has reached the room. */
  checkpoint: (label: string) => Promise<boolean>
  notesSeen: RoomNotesSeen
  others: readonly RoomPerson[]
  roomId: string | null
  session: LiveSession<State> | null
  setPlace: (place: RoomPlace) => void
  /** The room could not be opened; the editor saves on its own. */
  unavailable: boolean
}> {
  const [session, setSession] = useState<LiveSession<State> | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [notesSeen, setNotesSeen] = useState<RoomNotesSeen>({ chat: 0, checkpoints: 0, comments: 0 })
  const [others, setOthers] = useState<readonly RoomPerson[]>([])
  const latest = useRef(options)
  const place = useRef<RoomPlace>({ blockId: null, caret: null })
  const channelRef = useRef<RealtimeChannel | null>(null)
  const presenceRef = useRef<() => Record<string, unknown>>(() => ({}))
  const placeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const { enabled, me, path } = options

  useEffect(() => {
    latest.current = options
  })

  useEffect(() => {
    if (!enabled) {
      return
    }

    let stopped = false
    let live: LiveSession<State> | null = null
    let client: RealtimeClient | null = null
    const key = `${me.id}:${Math.random().toString(36).slice(2, 10)}`
    let color = colorOf(me.id)
    const presence = (): Record<string, unknown> => ({ color, name: me.name, userId: me.id, ...place.current })
    presenceRef.current = presence

    const onOnline = (): void => {
      void live?.flush()
      void live?.catchUp()
    }

    void (async () => {
      const opened = await request<OpenedRoom>(path, { method: "POST" })
      const [{ RoomRefusal, startLiveSession }, { RealtimeClient: Client }] = await Promise.all([
        import("@/lib/collaboration/live-session"),
        import("@supabase/realtime-js"),
      ])

      if (stopped) {
        return
      }

      const transport: RoomTransport = {
        readSince: async (afterRevision) => {
          const since = await request<{ revision: number; updates: string[] }>(
            `${path}/updates?roomId=${opened.roomId}&after=${afterRevision}`,
            { method: "GET" },
            RoomRefusal
          )
          return { revision: since.revision, updates: since.updates.map(fromBase64) }
        },
        reopen: async () => {
          const again = await request<OpenedRoom>(path, { method: "POST" }, RoomRefusal)
          return { revision: again.revision, state: fromBase64(again.state) }
        },
        send: (update) =>
          request<{ revision: number }>(
            `${path}/updates`,
            { body: JSON.stringify({ roomId: opened.roomId, update: toBase64(update) }), method: "POST" },
            RoomRefusal
          ),
      }

      setRoomId(opened.roomId)
      live = startLiveSession<State>({
        fromCopy: (copy) => latest.current.fromCopy(copy),
        onRefused: (message) => latest.current.onRefused(message),
        opened: { revision: opened.revision, state: fromBase64(opened.state) },
        toCopy: (state) => latest.current.toCopy(state),
        transport,
      })
      setSession(live)

      let token = { expiresAt: opened.realtime.expiresAt ?? 0, value: opened.realtime.token }
      client = new Client(opened.realtime.url, {
        // The member's own token, renewed shortly before it runs out.
        accessToken: async () => {
          if (!token.value || token.expiresAt * 1_000 - Date.now() < 60_000) {
            const fresh = await request<{ expiresAt: number | null; token: string | null }>("/api/working-copies/token", { method: "GET" })
            token = { expiresAt: fresh.expiresAt ?? 0, value: fresh.token }
          }

          return token.value
        },
        params: { apikey: opened.realtime.key },
      })
      // The member's token goes with the join; a join sent before it is ready is turned away.
      await client.setAuth()

      if (stopped) {
        return
      }

      const channel = client.channel(opened.topic, { config: { presence: { enabled: true, key }, private: true } })
      channelRef.current = channel
      channel
        .on("broadcast", { event: "update" }, ({ payload }: { payload?: { revision?: unknown } }) => {
          if (typeof payload?.revision === "number") {
            live?.hear(payload.revision)
          }
        })
        .on("broadcast", { event: "notes" }, ({ payload }: { payload?: { notes?: unknown } }) => {
          const kind = payload?.notes

          if (kind === "chat" || kind === "checkpoints" || kind === "comments") {
            setNotesSeen((seen) => ({ ...seen, [kind]: seen[kind] + 1 }))
          }
        })
        .on("presence", { event: "sync" }, () => {
          const people = readPeople(channel.presenceState(), key, me.id)
          setOthers(people)

          // No two people here wear the same colour: of two who do, the one whose key sorts later changes.
          if (people.some((person) => person.color === color && person.key < key)) {
            color = COLORS.find((choice) => !people.some((person) => person.color === choice)) ?? color
            void channel.track(presence())
          }
        })
        .subscribe((status: string) => {
          // Joining, or joining again after the connection dropped: fetch what was missed.
          if (status === "SUBSCRIBED") {
            void live?.catchUp()
            void channel.track(presence())
            setNotesSeen((seen) => ({ chat: seen.chat + 1, checkpoints: seen.checkpoints + 1, comments: seen.comments + 1 }))
          }
        })
      window.addEventListener("online", onOnline)
    })().catch(() => {
      // The room could not be reached; the editor keeps working alone and saves as before.
      if (!stopped) {
        setUnavailable(true)
      }
    })

    return () => {
      stopped = true
      window.removeEventListener("online", onOnline)
      clearTimeout(placeTimer.current)
      channelRef.current = null
      live?.stop()
      setSession(null)
      setOthers([])
      if (client) {
        void client.removeAllChannels()
        client.disconnect()
      }
    }
  }, [enabled, me.id, me.name, path])

  // Said at most every so often, and only when it changed.
  const setPlace = useCallback((next: RoomPlace): void => {
    if (
      place.current.blockId === next.blockId &&
      place.current.caret?.key === next.caret?.key &&
      place.current.caret?.offset === next.caret?.offset
    ) {
      return
    }

    place.current = next
    clearTimeout(placeTimer.current)
    placeTimer.current = setTimeout(() => void channelRef.current?.track(presenceRef.current()), PLACE_EVERY_MS)
  }, [])

  const checkpoint = useCallback(
    async (label: string): Promise<boolean> => {
      if (!session || !roomId) {
        return false
      }

      if (!(await session.flush())) {
        bizflowToast.error("Your latest changes haven't been saved yet. Try again in a moment.")
        return false
      }

      try {
        await request(`${path}/notes`, { body: JSON.stringify({ action: "checkpoint", label, roomId }), method: "POST" })
        bizflowToast.success("Checkpoint saved")
        return true
      } catch (error: unknown) {
        bizflowToast.error(error instanceof Error ? error.message : "Unable to keep this checkpoint.")
        return false
      }
    },
    [path, roomId, session]
  )

  return {
    checkpoint,
    notesSeen,
    others,
    roomId,
    session,
    setPlace,
    unavailable,
  }
}

/**
 * The colour a person wears in the room, the same on every screen.
 *
 * @param userId - Who.
 * @returns Their colour.
 */
export function colorOf(userId: string): string {
  return COLORS[[...userId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % COLORS.length]!
}

// Everyone else here, once for each tab they joined from; this person's own other tabs aren't someone else.
function readPeople(state: Record<string, ReadonlyArray<Record<string, unknown>>>, mine: string, myUserId: string): RoomPerson[] {
  return Object.entries(state)
    .filter(([key]) => key !== mine && !key.startsWith(`${myUserId}:`))
    .flatMap(([key, entries]) => {
      const entry = entries.at(-1)

      const caret = entry?.caret as { key?: unknown; offset?: unknown } | null | undefined

      return entry && typeof entry.userId === "string" && typeof entry.name === "string"
        ? [{
            blockId: typeof entry.blockId === "string" ? entry.blockId : null,
            caret:
              caret && typeof caret.key === "string" && caret.key.length <= 200 && Number.isSafeInteger(caret.offset) && Number(caret.offset) >= 0
                ? { key: caret.key, offset: Number(caret.offset) }
                : null,
            color: typeof entry.color === "string" && /^#[0-9a-f]{6}$/i.test(entry.color) ? entry.color : COLORS[0]!,
            key,
            name: entry.name.slice(0, 80),
            userId: entry.userId,
          }]
        : []
    })
}

async function request<T>(url: string, init: RequestInit, Refused?: Refusal): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json" } })

  if (response.ok) {
    return (await response.json()) as T
  }

  const body = (await response.json().catch(() => ({}))) as { error?: unknown }
  const message = typeof body.error === "string" ? body.error : "Unable to reach this working copy."

  throw Refused && REFUSED.has(response.status) ? new Refused(message, response.status) : new Error(message)
}

function toBase64(bytes: Uint8Array): string {
  let binary = ""

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }

  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}
