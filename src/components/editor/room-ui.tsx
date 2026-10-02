"use client"

import { Check, MessageCircle, RotateCcw, SendHorizontal } from "lucide-react"
import {
  type FormEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { colorOf, type RoomNotesSeen, type RoomPerson } from "@/components/editor/use-live-room"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { bizflowToast } from "@/components/ui/toaster"
import type { WorkingCopy } from "@/lib/collaboration/working-copy-doc"
import { cn } from "@/lib/utils"
import type { WorkingCopyChatMessage, WorkingCopyCheckpoint, WorkingCopyComment } from "@/services/working-copy-service"
import type { TemplateBlock } from "@/types/template"

/** An open room: where its notes are kept, and how often each kind has changed. */
export type RoomNotes = Readonly<{ path: string; roomId: string; seen: RoomNotesSeen }>

type Kind = keyof RoomNotesSeen
type List = { data: readonly unknown[] | null; listeners: Set<() => void>; shown: number; started: number; tick: number }
type Thread = Readonly<{ first: WorkingCopyComment; replies: readonly WorkingCopyComment[] }>
type Box = Readonly<{ color: string; height: number; key: string; names: readonly string[]; width: number; x: number; y: number }>
type Fold = Readonly<{ blockId: string; count: number; x: number; y: number }>
type Marks = Readonly<{ carets: readonly Box[]; folds: readonly Fold[]; outlines: readonly Box[] }>

const NO_MARKS: Marks = { carets: [], folds: [], outlines: [] }
const TIME = new Intl.DateTimeFormat(undefined, { timeStyle: "short" })
const DAY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
const lists = new Map<string, List>()

/**
 * Where the others are on the page, and the comments on it: an outline with a
 * name on the part someone has, a named caret where someone writes, and a
 * folded page beside each part with comments, which opens them. Never printed.
 *
 * @param props - Who else is here, the room, the page as it stands, and
 *   whether the screen is phone-narrow.
 * @returns The marks, over the pages.
 */
export function RoomLayer({
  narrow,
  others,
  revision,
  room,
}: {
  narrow: boolean
  others: readonly RoomPerson[]
  /** What changes when the page does, so the marks follow it. */
  revision: unknown
  room: RoomNotes
}): ReactElement {
  const layer = useRef<HTMLDivElement>(null)
  const comments = useNotes<WorkingCopyComment>(room, "comments")
  const today = useToday()
  const [marks, setMarks] = useState<Marks>(NO_MARKS)
  const [open, setOpen] = useState<string | null>(null)
  const threads = useMemo(() => threadsOf(comments ?? []), [comments])
  const place = useCallback(() => {
    if (layer.current) {
      setMarks(measure(layer.current, others, openCounts(threads), narrow))
    }
  }, [narrow, others, threads])

  // After the page has laid itself out, and whenever the canvas changes size.
  useEffect(() => {
    const frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
  }, [place, revision])
  useEffect(() => {
    const canvas = layer.current?.parentElement

    if (!canvas || typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(place)
    observer.observe(canvas)
    void document.fonts?.ready.then(place)

    return () => observer.disconnect()
  }, [place])

  const shown = (blockId: string) => threads.filter((thread) => thread.first.blockId === blockId && !thread.first.resolvedAt)
  const tint = tintAmong(others)

  return (
    <div className="pointer-events-none absolute inset-0 z-10 print:hidden" data-slot="room-layer" ref={layer}>
      {marks.outlines.map((box) => (
        <div
          aria-hidden="true"
          className="absolute rounded-[11px] border-2 transition-[left,top,width,height] duration-150 ease-out motion-reduce:transition-none"
          data-slot="room-outline"
          key={box.key}
          style={{ borderColor: box.color, height: box.height + 16, left: box.x - 8, top: box.y - 8, width: box.width + 16 }}
        >
          <span className="absolute -top-[11px] right-1 flex gap-1">
            {box.names.map((name) => (
              <span
                className="rounded-[5px] px-1.5 py-[3px] text-[11px] leading-none font-semibold whitespace-nowrap text-brand-paper"
                key={name}
                style={{ backgroundColor: box.color }}
              >
                {name}
              </span>
            ))}
          </span>
        </div>
      ))}
      {marks.carets.map((box) => (
        <div
          aria-hidden="true"
          className="absolute w-0.5 rounded-[1px] transition-[left,top] duration-100 ease-out motion-reduce:transition-none"
          data-slot="room-caret"
          key={box.key}
          style={{ backgroundColor: box.color, height: box.height, left: box.x - 1, top: box.y }}
        >
          <span
            className={cn(
              "absolute bottom-full left-0 mb-px rounded-[5px] rounded-bl-none leading-none font-semibold whitespace-nowrap text-brand-paper",
              narrow ? "px-[3px] py-0.5 text-[10px]" : "px-[5px] py-[3px] text-[11px]"
            )}
            style={{ backgroundColor: box.color }}
          >
            {/* A phone's lines sit close, so a whole name would cover the words above; the people at the top carry the name. */}
            {narrow ? Array.from(box.names[0])[0] : box.names[0]}
          </span>
        </div>
      ))}
      {marks.folds.map((fold) => {
        const label = `${fold.count} ${fold.count === 1 ? "comment" : "comments"}`
        const className = "pointer-events-auto absolute rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        const style = { left: fold.x, top: fold.y }

        return narrow ? (
          <button aria-label={label} className={className} key={fold.blockId} onClick={() => setOpen(fold.blockId)} style={style} title={label} type="button">
            <FoldMark count={fold.count} size={24} />
          </button>
        ) : (
          <Popover key={fold.blockId} onOpenChange={(next: boolean) => setOpen(next ? fold.blockId : null)} open={open === fold.blockId}>
            <PopoverTrigger aria-label={label} className={className} style={style} title={label}>
              <FoldMark count={fold.count} size={26} />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[19rem]" side="right" sideOffset={10}>
              <PopoverTitle className="px-0.5 pb-1 text-sm font-medium">Comments</PopoverTitle>
              <Threads room={room} threads={shown(fold.blockId)} tint={tint} today={today} />
            </PopoverContent>
          </Popover>
        )
      })}
      {narrow ? (
        <Sheet onOpenChange={(next: boolean) => (next ? undefined : setOpen(null))} open={open !== null}>
          <SheetContent>
            <SheetTitle>Comments</SheetTitle>
            <div className="px-1 pb-2">{open ? <Threads room={room} threads={shown(open)} tint={tint} today={today} /> : null}</div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  )
}

/**
 * Who else is here, at the top: clicking them opens the chat among everyone
 * editing this, which only they can read. A dot says something new was said.
 *
 * @param props - This person, the others here, the room, and whether the
 *   screen is phone-narrow.
 * @returns The people, and their chat.
 */
export function RoomPeople({
  me,
  narrow,
  others,
  room,
}: {
  me: Readonly<{ id: string; name: string }>
  narrow: boolean
  others: readonly RoomPerson[]
  room: RoomNotes
}): ReactElement {
  const messages = useNotes<WorkingCopyChatMessage>(room, "chat")
  const today = useToday()
  const [open, setOpen] = useState(false)
  const [known, setKnown] = useState<ReadonlySet<string> | null>(null)
  const people = others.filter((person, index) => others.findIndex((other) => other.userId === person.userId) === index)
  const names = people.map((person) => firstName(person.name))
  const colors = people.map((person) => person.color)

  // What was said before this page opened, or while the chat is open, has been seen.
  if (messages && (known === null || (open && messages.some((message) => !known.has(message.id))))) {
    setKnown(new Set(messages.map((message) => message.id)))
  }

  const unread = Boolean(known && messages?.some((message) => message.authorId !== me.id && !known.has(message.id)))
  const pill = people.length > 0 && !narrow
  const label = people.length > 0 ? `Chat with ${sayNames(names)}` : "Chat"
  const face = (
    <>
      {people.length > 0 ? <TeamMark colors={colors} size={narrow ? 22 : 24} /> : <MessageCircle aria-hidden="true" className="size-[18px]" />}
      {pill ? (
        <>
          <span className="max-w-40 truncate">{names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ")}</span>
          <MessageCircle aria-hidden="true" className="size-4" />
        </>
      ) : null}
      {unread ? <span aria-hidden="true" className="absolute top-0.5 right-0.5 size-2 rounded-full bg-primary ring-2 ring-canvas" data-slot="chat-unread" /> : null}
    </>
  )
  const triggerClass = cn(
    "relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
    pill ? "mr-1 bg-secondary pr-2 pl-1.5 text-primary hover:bg-secondary/75" : "w-9 justify-center text-foreground/80 hover:bg-muted"
  )
  const here = people.length > 0 ? `${sayNames(names)} ${people.length === 1 ? "is" : "are"} here` : "Only you are here"
  const chat = (heading: ReactNode) => (
    <Chat
      heading={heading}
      me={me}
      messages={messages}
      tint={tintAmong(others)}
      onSend={(body) => post(room, "chat", { action: "message", body })}
      placeholder={people.length > 0 ? `Message ${sayNames(names)}…` : "Message everyone editing this…"}
      today={today}
    />
  )
  const headingClass = "flex items-center gap-1.5 px-3.5 pt-3 pb-1 text-[12.5px] font-normal text-muted-foreground"

  if (narrow) {
    return (
      <>
        <button aria-label={label} className={triggerClass} data-slot="room-people" onClick={() => setOpen(true)} title={label} type="button">
          {face}
        </button>
        <Sheet onOpenChange={setOpen} open={open}>
          <SheetContent className="px-0">
            {chat(
              <SheetTitle className={cn(headingClass, "pt-0 font-sans tracking-normal normal-case")}>
                {people.length > 0 ? <TeamMark colors={colors} size={20} /> : null}
                {here}
              </SheetTitle>
            )}
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger aria-label={label} className={triggerClass} data-slot="room-people" title={label}>
        {face}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[20rem] p-0">
        {chat(
          <PopoverTitle className={headingClass}>
            {people.length > 0 ? <TeamMark colors={colors} size={20} /> : null}
            {here}
          </PopoverTitle>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Every comment on the page, open threads first, and a way to start one on
 * the part in use or on the page.
 *
 * @param props - The page's blocks, the block in use, the room, and how to
 *   show a block a thread is on.
 * @returns The comments.
 */
export function RoomComments({
  blocks,
  onShow,
  others,
  room,
  target,
}: {
  blocks: readonly TemplateBlock[]
  onShow: (blockId: string) => void
  others: readonly RoomPerson[]
  room: RoomNotes
  target: string | null
}): ReactElement {
  const comments = useNotes<WorkingCopyComment>(room, "comments")
  const today = useToday()
  const [showResolved, setShowResolved] = useState(false)
  const threads = threadsOf(comments ?? [])
  const resolved = threads.filter((thread) => thread.first.resolvedAt)
  const on = blocks.find((block) => block.id === target)
  const place = (thread: Thread): ReactNode => {
    const block = blocks.find((candidate) => candidate.id === thread.first.blockId)

    return block ? (
      <button className="justify-self-start text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => onShow(block.id)} type="button">
        On {nameOf(block)}
      </button>
    ) : (
      <span className="text-[12px] text-muted-foreground">{thread.first.blockId ? "On a part that is gone" : "On the page"}</span>
    )
  }

  return (
    <div className="grid gap-3" data-slot="room-comments">
      {comments === null ? (
        <p className="text-[13px] text-muted-foreground">Loading…</p>
      ) : threads.length === resolved.length ? (
        <p className="text-[13px] text-muted-foreground">No open comments.</p>
      ) : null}
      <Threads place={place} room={room} threads={threads.filter((thread) => !thread.first.resolvedAt)} tint={tintAmong(others)} today={today} />
      {resolved.length > 0 ? (
        <button
          className="justify-self-start text-[12.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setShowResolved(!showResolved)}
          type="button"
        >
          {showResolved ? "Hide resolved" : `Show resolved (${resolved.length})`}
        </button>
      ) : null}
      {showResolved ? <Threads place={place} room={room} threads={resolved} tint={tintAmong(others)} today={today} /> : null}
      <Composer
        label="New comment"
        onSend={(body) => post(room, "comments", { action: "comment", blockId: on?.id ?? null, body })}
        placeholder={on ? `Comment on ${nameOf(on)}…` : "Comment on the page…"}
      />
    </div>
  )
}

/**
 * Named points in the copy's life to come back to. Going back first keeps
 * the copy it replaces, so that can be brought back too.
 *
 * @param props - The room, how to keep a checkpoint, and how the editor takes
 *   a copy that comes back.
 * @returns The checkpoints.
 */
export function RoomCheckpoints({
  onRestore,
  onSave,
  room,
}: {
  onRestore: (copy: WorkingCopy) => void
  onSave: (label: string) => Promise<boolean>
  room: RoomNotes
}): ReactElement {
  const checkpoints = useNotes<WorkingCopyCheckpoint>(room, "checkpoints")
  const today = useToday()

  async function restore(checkpoint: WorkingCopyCheckpoint): Promise<void> {
    const result = await post<{ copy?: WorkingCopy }>(room, "checkpoints", { action: "restore", checkpointId: checkpoint.id })

    if (result?.copy) {
      onRestore(result.copy)
      bizflowToast.success(`Back to “${checkpoint.label}”`)
    }
  }

  return (
    <div className="grid gap-2" data-slot="room-checkpoints">
      <Composer action="Save" label="Checkpoint name" maxLength={120} onSend={onSave} placeholder="Name this checkpoint…" />
      {checkpoints?.length === 0 ? (
        <p className="px-0.5 text-[13px] text-muted-foreground">None yet. ⌘S or Ctrl+S keeps one as you go.</p>
      ) : null}
      <ul className="grid gap-1">
        {checkpoints?.map((checkpoint) => (
          <li className="flex min-h-11 items-center gap-3 rounded-[8px] px-2 hover:bg-muted/60" key={checkpoint.id}>
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-sm">{checkpoint.label}</span>
              <span className="truncate text-xs text-muted-foreground">
                {checkpoint.createdBy} · {when(checkpoint.createdAt, today)}
              </span>
            </span>
            <Button onClick={() => void restore(checkpoint)} size="sm" type="button" variant="outline">
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Threads({
  place,
  room,
  threads,
  tint,
  today,
}: {
  place?: (thread: Thread) => ReactNode
  room: RoomNotes
  threads: readonly Thread[]
  tint: (userId: string | null) => string
  today: string
}): ReactElement {
  return (
    <>
      {threads.map((thread) => {
        const resolved = thread.first.resolvedAt !== null
        const resolve = (
          <Button
            aria-label={resolved ? "Reopen" : "Resolve"}
            className="-my-1 ml-auto size-7 shrink-0"
            onClick={() => void post(room, "comments", { action: "resolve", resolved: !resolved, threadId: thread.first.id })}
            size="icon-sm"
            title={resolved ? "Reopen" : "Resolve"}
            type="button"
            variant="ghost"
          >
            {resolved ? <RotateCcw /> : <Check />}
          </Button>
        )

        return (
          <article className="grid gap-0.5 border-b border-border pb-2 last:border-b-0 last:pb-0" data-slot="comment-thread" key={thread.first.id}>
            {/* In a list the thread says where it is, beside its tick; on the page, its first comment does. */}
            {place ? (
              <div className="flex min-h-7 items-center gap-2">
                {place(thread)}
                {resolve}
              </div>
            ) : null}
            {thread.first.quote ? (
              <q className="border-l-2 border-primary/40 pl-2 text-[12.5px] text-muted-foreground">{thread.first.quote}</q>
            ) : null}
            {[thread.first, ...thread.replies].map((comment) => (
              <div className="grid grid-cols-[24px_1fr] gap-x-2 gap-y-0.5 py-1" key={comment.id}>
                <Face color={tint(comment.authorId)} name={comment.author} />
                <p className="flex min-w-0 items-baseline gap-1.5 text-[13px] font-semibold">
                  <span className="truncate">{comment.author}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">{when(comment.createdAt, today)}</span>
                  {!place && comment === thread.first ? resolve : null}
                </p>
                <p className="col-start-2 text-[13.5px] leading-[1.4] break-words whitespace-pre-wrap">{comment.body}</p>
              </div>
            ))}
            {resolved ? (
              <p className="text-xs text-muted-foreground">Resolved by {thread.first.resolvedBy ?? "a former member"}</p>
            ) : (
              <Composer
                label="Reply"
                onSend={(body) => post(room, "comments", { action: "comment", body, threadId: thread.first.id })}
                placeholder="Reply…"
              />
            )}
          </article>
        )
      })}
    </>
  )
}

function Chat({
  heading,
  me,
  messages,
  onSend,
  placeholder,
  tint,
  today,
}: {
  heading: ReactNode
  me: Readonly<{ id: string }>
  messages: readonly WorkingCopyChatMessage[] | null
  onSend: (body: string) => Promise<unknown>
  placeholder: string
  tint: (userId: string | null) => string
  today: string
}): ReactElement {
  const list = useRef<HTMLDivElement>(null)

  // The newest message stays in view.
  useLayoutEffect(() => {
    if (list.current) {
      list.current.scrollTop = list.current.scrollHeight
    }
  }, [messages])

  return (
    <div className="flex max-h-[min(30rem,70dvh)] flex-col" data-slot="room-chat">
      {heading}
      <div className="flex min-h-24 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1.5 pb-1 text-[13.5px]" ref={list}>
        {messages === null ? (
          <p className="m-auto text-[12.5px] text-muted-foreground">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="m-auto max-w-56 text-center text-[12.5px] text-muted-foreground">
            Nothing said yet. Only people who can edit this see what is said here.
          </p>
        ) : (
          messages.map((message, index) => {
            const day = DAY.format(new Date(message.createdAt))
            const mine = message.authorId === me.id

            return (
              <div className="contents" key={message.id}>
                {index === 0 || DAY.format(new Date(messages[index - 1]!.createdAt)) !== day ? (
                  <p className="self-center text-[11.5px] text-muted-foreground">{day === today ? "Today" : day}</p>
                ) : null}
                {mine ? (
                  <p
                    className="max-w-[13.75rem] self-end rounded-[12px] rounded-br-[4px] bg-secondary px-2.5 py-[7px] leading-[1.35] break-words whitespace-pre-wrap text-secondary-foreground"
                    title={when(message.createdAt, today)}
                  >
                    {message.body}
                  </p>
                ) : (
                  <div className="flex items-end gap-2" title={when(message.createdAt, today)}>
                    <Face color={tint(message.authorId)} name={message.author} />
                    <div className="min-w-0">
                      <p className="mb-0.5 ml-0.5 text-[11.5px] text-muted-foreground">{firstName(message.author)}</p>
                      <p className="max-w-[13.75rem] rounded-[12px] rounded-bl-[4px] bg-muted px-2.5 py-[7px] leading-[1.35] break-words whitespace-pre-wrap">
                        {message.body}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
      <div className="px-3 pb-3">
        <Composer label="Message" onSend={onSend} placeholder={placeholder} />
      </div>
    </div>
  )
}

// One line to write in, sent with Enter or its button, emptied once kept.
function Composer({
  action,
  label,
  maxLength = 4_000,
  onSend,
  placeholder,
}: {
  /** A word for the button, where an arrow would not say what it does. */
  action?: string
  label: string
  maxLength?: number
  onSend: (body: string) => Promise<unknown>
  placeholder: string
}): ReactElement {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const body = text.trim()

    if (!body || busy) {
      return
    }

    setBusy(true)
    const kept = await onSend(body)
    setBusy(false)

    if (kept) {
      setText("")
    }
  }

  return (
    <form
      className="mt-1 flex h-9 items-center gap-1 rounded-[9px] border border-input bg-card pr-1 pl-2.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
      onSubmit={(event) => void send(event)}
    >
      <input
        aria-label={label}
        className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
        maxLength={maxLength}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        value={text}
      />
      {action ? (
        <Button className="h-7 px-2.5" disabled={busy || !text.trim()} size="sm" type="submit" variant="ghost">
          {action}
        </Button>
      ) : (
        <button
          aria-label="Send"
          className="grid size-7 place-items-center rounded-[7px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
          disabled={busy || !text.trim()}
          title="Send"
          type="submit"
        >
          <SendHorizontal aria-hidden="true" className="size-4" />
        </button>
      )}
    </form>
  )
}

// A person's initial in their colour.
function Face({ color, name }: { color: string; name: string }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, var(--card))`, boxShadow: `inset 0 0 0 1.5px ${color}`, color }}
    >
      {[...name.trim()][0]?.toUpperCase() ?? "?"}
    </span>
  )
}

// The page with its corner folded, carrying a count: comments beside a part of the page.
function FoldMark({ count, size }: { count: number; size: number }): ReactElement {
  return (
    <span className="relative grid place-items-center" style={{ height: size, width: size }}>
      <svg aria-hidden="true" className="absolute inset-0 size-full" viewBox="0 0 26 26">
        <path className="fill-primary" d="M3 3H17L23 9V23H3Z" />
        <path className="fill-(--fold-wisteria)" d="M17 3V9H23Z" />
      </svg>
      <span className="relative mt-1 -ml-[3px] text-[11px] leading-none font-semibold text-primary-foreground tabular-nums">
        {count > 99 ? "99+" : count}
      </span>
    </span>
  )
}

// A small folded page wearing the colours of the people here.
function TeamMark({ colors, size }: { colors: readonly string[]; size: number }): ReactElement {
  return (
    <svg aria-hidden="true" className="shrink-0" height={size} viewBox="-190 -240 380 480" width={size * 0.8}>
      <path className="fill-secondary stroke-primary" d="M-180 -230H90L180 -140V230H-180Z" strokeLinejoin="round" strokeWidth={14} />
      <path d="M-180 -230L-40 -60L-180 0Z" fill={colors[0]} fillOpacity={0.9} />
      <path d="M60 40L180 60V230Z" fill={colors[1] ?? colors[0]} fillOpacity={0.9} />
      <path className="fill-(--fold-lavender)" d="M-40 -60L60 40L-90 120Z" fillOpacity={0.9} style={colors[2] ? { fill: colors[2] } : undefined} />
      <path className="fill-(--fold-wisteria) stroke-primary" d="M90 -230V-140H180Z" strokeLinejoin="round" strokeWidth={14} />
    </svg>
  )
}

// Where each mark goes, in the layer's own pixels: others' carets and the parts
// they have, and a fold beside each part with open comments.
function measure(layer: HTMLElement, others: readonly RoomPerson[], counts: ReadonlyMap<string, number>, narrow: boolean): Marks {
  const canvas = layer.parentElement

  if (!canvas) {
    return NO_MARKS
  }

  const origin = layer.getBoundingClientRect()
  const boxOf = (blockId: string) => canvas.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)?.getBoundingClientRect() ?? null
  const carets: Box[] = []
  const held = new Map<string, { color: string; names: string[] }>()

  for (const person of others) {
    const key = person.caret ? CSS.escape(person.caret.key) : null
    const line = key ? canvas.querySelector<HTMLElement>(`[data-line-key="${key}"], [data-caret-key="${key}"]`) : null
    const at = line && person.caret ? caretBox(line, person.caret.offset) : null

    if (at) {
      carets.push({ color: person.color, height: at.height, key: person.key, names: [firstName(person.name)], width: 2, x: at.left - origin.left, y: at.top - origin.top })
    } else if (person.blockId) {
      const holders = held.get(person.blockId) ?? { color: person.color, names: [] }
      holders.names.push(firstName(person.name))
      held.set(person.blockId, holders)
    }
  }

  const outlines = [...held].flatMap(([blockId, { color, names }]) => {
    const box = boxOf(blockId)
    return box ? [{ color, height: box.height, key: blockId, names: [...new Set(names)], width: box.width, x: box.left - origin.left, y: box.top - origin.top }] : []
  })
  // Beside the part in the page's margin; on a phone, at the column's edge.
  const folds = [...counts].flatMap(([blockId, count]) => {
    const box = boxOf(blockId)
    return box ? [{ blockId, count, x: narrow ? origin.width - 25 : box.right - origin.left + 10, y: box.top - origin.top - 2 }] : []
  })

  return { carets, folds, outlines }
}

// The caret's box at so many characters into a line's words.
function caretBox(line: HTMLElement, offset: number): DOMRect | null {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest("style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  const range = document.createRange()
  let left = offset
  let last: Text | null = null

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    last = node

    if (left <= node.length) {
      break
    }

    left -= node.length
  }

  if (!last || last.length === 0) {
    // An empty line: its start.
    const box = line.getBoundingClientRect()
    return new DOMRect(box.left, box.top, 0, Math.min(box.height, parseFloat(getComputedStyle(line).fontSize) * 1.4 || box.height))
  }

  const at = Math.min(left, last.length)
  range.setStart(last, at)
  range.collapse(true)
  const box = range.getClientRects()[0]

  if (box) {
    return box
  }

  // A collapsed range can have no box; the character beside it does.
  const beside = Math.min(at, last.length - 1)
  range.setStart(last, beside)
  range.setEnd(last, beside + 1)
  const character = range.getClientRects()[0]

  return character ? new DOMRect(at > beside ? character.right : character.left, character.top, 0, character.height) : null
}

// A person's colour: what they wear in the room while they are here, and their own otherwise.
function tintAmong(others: readonly RoomPerson[]): (userId: string | null) => string {
  return (userId) => others.find((person) => person.userId === userId)?.color ?? colorOf(userId ?? "")
}

function threadsOf(comments: readonly WorkingCopyComment[]): Thread[] {
  return comments.flatMap((first) =>
    first.id === first.threadId
      ? [{ first, replies: comments.filter((comment) => comment.threadId === first.id && comment.id !== first.id) }]
      : []
  )
}

// How many comments are open on each part of the page.
function openCounts(threads: readonly Thread[]): Map<string, number> {
  const counts = new Map<string, number>()

  for (const thread of threads) {
    if (thread.first.blockId && !thread.first.resolvedAt) {
      counts.set(thread.first.blockId, (counts.get(thread.first.blockId) ?? 0) + 1 + thread.replies.length)
    }
  }

  return counts
}

function listOf(roomId: string, kind: Kind): List {
  const key = `${roomId}:${kind}`
  const found = lists.get(key)

  if (found) {
    return found
  }

  const list: List = { data: null, listeners: new Set(), shown: 0, started: 0, tick: -1 }
  lists.set(key, list)
  return list
}

// Fetches a list again; an answer never replaces one asked for after it.
async function reload(room: RoomNotes, kind: Kind): Promise<void> {
  const list = listOf(room.roomId, kind)
  const order = (list.started += 1)
  const response = await fetch(`${room.path}/notes?roomId=${encodeURIComponent(room.roomId)}&kind=${kind}`, { cache: "no-store" }).catch(() => null)
  const body = response?.ok ? ((await response.json().catch(() => null)) as { notes?: unknown } | null) : null

  if (Array.isArray(body?.notes) && order > list.shown) {
    list.shown = order
    list.data = body.notes
    list.listeners.forEach((listener) => listener())
  }
}

// Everything showing a list shares it; it is fetched once for each change the room hears of.
function useNotes<T>(room: RoomNotes, kind: Kind): readonly T[] | null {
  const list = listOf(room.roomId, kind)
  const tick = room.seen[kind]
  const subscribe = useCallback(
    (listener: () => void) => {
      list.listeners.add(listener)
      return () => void list.listeners.delete(listener)
    },
    [list]
  )
  const data = useSyncExternalStore(subscribe, () => list.data, () => null)

  useEffect(() => ask(room, kind, tick), [kind, room, tick])

  return data as readonly T[] | null
}

// However many ask, a list is fetched once for each change the room hears of.
function ask(room: RoomNotes, kind: Kind, tick: number): void {
  const list = listOf(room.roomId, kind)

  if (list.tick < tick) {
    list.tick = tick
    void reload(room, kind)
  }
}

// Leaves something in the room, then shows the list with it at once.
async function post<T = unknown>(room: RoomNotes, kind: Kind, body: Record<string, unknown>): Promise<T | null> {
  const response = await fetch(`${room.path}/notes`, {
    body: JSON.stringify({ ...body, roomId: room.roomId }),
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  }).catch(() => null)

  if (!response?.ok) {
    const failure = ((await response?.json().catch(() => null)) ?? {}) as { error?: unknown }
    bizflowToast.error(typeof failure.error === "string" ? failure.error : "Unable to keep this. Check your connection.")
    return null
  }

  void reload(room, kind)
  return response.status === 204 ? ({} as T) : ((await response.json()) as T)
}

function useToday(): string {
  const [today] = useState(() => DAY.format(new Date()))
  return today
}

function when(iso: string, today: string): string {
  const date = new Date(iso)
  const day = DAY.format(date)

  return day === today ? TIME.format(date) : `${day}, ${TIME.format(date)}`
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

function sayNames(names: readonly string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : names.length <= 3
      ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
      : `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`
}

function nameOf(block: TemplateBlock): string {
  const record = block as Readonly<Record<string, unknown>>
  const words = [record.label, record.text].find((value): value is string => typeof value === "string" && value.trim().length > 0)

  if (words) {
    const clean = words.trim().replace(/\s+/g, " ")
    return `“${clean.length > 32 ? `${clean.slice(0, 31)}…` : clean}”`
  }

  return block.type === "image" ? "the picture" : block.type === "table" ? "the table" : "this part"
}
