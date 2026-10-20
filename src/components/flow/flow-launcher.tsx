"use client"

import { ArrowRight, ArrowUp } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { type FormEvent, type KeyboardEvent, type ReactElement, useEffect, useState, useSyncExternalStore, useTransition } from "react"

import { createGeneratedDocumentAction } from "@/app/(dashboard)/documents/actions"
import { createTemplateAction } from "@/app/(dashboard)/templates/actions"
import { FLOW_COMPOSER_ATTACH, FlowAddButton, FlowAttachChip, RECREATE, useFlowAttachment, useFlowOpenWith } from "@/components/flow/flow-attach"
import { handOffToFlow } from "@/components/flow/flow-handoff"
import { FlowModelPicker, useFlowModel } from "@/components/flow/flow-model-picker"
import { FlowMentionChips, useFlowMentions } from "@/components/flow/flow-mentions"
import { FlowMessage, FlowWorking } from "@/components/flow/flow-message"
import { FLOW_STREAM_HEADERS, readFlowTurn } from "@/components/flow/flow-stream"
import { FLOW_COMPOSER, FLOW_SEND, FlowWindow } from "@/components/flow/flow-window"
import { cn } from "@/lib/utils"
import type { FlowStage } from "@/services/template-flow/contracts"
import type { WorkspaceFlowAnswer, WorkspaceFlowItem } from "@/services/workspace-flow-service"

const PROMPTS = ["What's overdue?", "What needs my review?", "Start an intake form"] as const

type Turn = Readonly<{
  failed?: boolean
  id: number
  items?: readonly WorkspaceFlowItem[]
  moreHref?: string
  role: "flow" | "member"
  text: string
}>

type Conversation = Readonly<{ busy: boolean; organizationId: string; stages: readonly FlowStage[]; turns: readonly Turn[] }>

const FLOW_TAB = "/flow"
const EMPTY: Conversation = { busy: false, organizationId: "", stages: [], turns: [] }
// One conversation for the popup and the Flow tab, kept as the member moves between pages.
// ponytail: lives until the page reloads; saved sessions arrive with the agent's tables.
let conversation = EMPTY
let nextId = 0
// Bumped when the conversation is dropped, so a reply still on its way can't land in the next one.
let epoch = 0
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function change(organizationId: string, next: (current: Conversation) => Partial<Conversation>): void {
  // Another workspace starts its own conversation.
  const current = conversation.organizationId === organizationId ? conversation : { ...EMPTY, organizationId }
  conversation = { ...current, ...next(current) }
  for (const listener of listeners) listener()
}

/**
 * Flow from any workspace page: Flow's button, which opens a conversation
 * that finds the member's work or starts something new. On the Flow tab the
 * conversation is the page, so the button steps aside.
 *
 * @param props - The workspace a file attached to Flow goes into.
 * @returns The launcher and its conversation.
 */
export function FlowLauncher({ organizationId }: { organizationId: string }): ReactElement | null {
  const [open, setOpen] = useState(false)

  // Leaving the workspace, such as signing out, drops the conversation: the next person here never sees it.
  useEffect(
    () => () => {
      epoch++
      conversation = EMPTY
    },
    []
  )

  if (usePathname() === FLOW_TAB) return null

  return (
    // On a phone it rests above the tab bar, which is 4.5rem tall.
    <FlowWindow expandHref={FLOW_TAB} onOpenChange={setOpen} open={open} phoneBottom={72}>
      <FlowConversation onLeave={() => setOpen(false)} onShow={() => setOpen(true)} organizationId={organizationId} />
    </FlowWindow>
  )
}

/**
 * The Flow tab: the same conversation as the popup, with the whole page to itself.
 *
 * @param props - The workspace a file attached to Flow goes into.
 * @returns The conversation, page-sized.
 */
export function FlowTab({ organizationId }: { organizationId: string }): ReactElement {
  return (
    // As tall as the screen less the layout's padding, so the composer starts at the bottom;
    // the page scrolls the conversation and the composer stays in reach, above a phone's tab bar.
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] w-full max-w-3xl flex-col max-md:min-h-[calc(100dvh-15rem)] [&>form]:sticky [&>form]:bottom-0 [&>form]:mt-auto [&>form]:bg-background max-md:[&>form]:bottom-[calc(4.5rem+env(safe-area-inset-bottom))]">
      <FlowConversation onLeave={() => undefined} onShow={() => undefined} organizationId={organizationId} />
    </div>
  )
}

function FlowConversation({
  onLeave,
  onShow,
  organizationId,
}: {
  onLeave: () => void
  onShow: () => void
  organizationId: string
}): ReactElement {
  const shown = useSyncExternalStore(subscribe, () => conversation, () => EMPTY)
  // How far the turn in flight has got, as the server says.
  const { busy, stages, turns } = shown.organizationId === organizationId ? shown : EMPTY
  const [text, setText] = useState("")
  const [, startTransition] = useTransition()
  const flowModel = useFlowModel()
  const mentions = useFlowMentions()
  const router = useRouter()
  // Files shows a file attached on it in place.
  const attachment = useFlowAttachment(organizationId, () => {
    if (window.location.pathname === "/documents") router.refresh()
  })

  // Files' "Open in Flow" opens it with that file attached.
  useFlowOpenWith((source) => {
    attachment.set(source)
    onShow()
  })


  async function send(message: string): Promise<void> {
    const source = attachment.source
    const trimmed = message.trim() || (source ? RECREATE : "")

    // Read from the store, not the last render, so a quick second Enter never sends twice.
    if (trimmed.length < 2 || (conversation.organizationId === organizationId && conversation.busy) || attachment.uploading) {
      return
    }

    const started = epoch
    const update = (next: (current: Conversation) => Partial<Conversation>): void => {
      if (epoch === started) change(organizationId, next)
    }
    const add = (turn: Omit<Turn, "id">): void => {
      const id = nextId++
      update((current) => ({ turns: [...current.turns, { ...turn, id }] }))
    }
    const history = turns.slice(-6).map((turn) => ({ role: turn.role, text: turn.text }))
    add({ role: "member", text: trimmed })
    setText("")
    // A mention goes with this message only; a failed send puts it back.
    const mentioned = mentions.items
    mentions.clear()
    // Said at once, before the server's first word arrives.
    update(() => ({ busy: true, stages: ["thinking"] }))

    try {
      const response = await fetch("/api/flow", {
        body: JSON.stringify({ history, mentions: mentions.payload, message: trimmed, model: flowModel.chosen(), sourceDocumentId: source?.id }),
        headers: FLOW_STREAM_HEADERS,
        method: "POST",
      })
      const turn = await readFlowTurn(response, (stage) =>
        update((current) => (current.stages.at(-1) === stage ? {} : { stages: [...current.stages, stage] }))
      )

      if (!turn.ok) throw new Error(turn.error)

      const payload = (turn.payload ?? {}) as Partial<WorkspaceFlowAnswer>

      if (!payload.kind) throw new Error("Flow couldn't answer that.")

      const answer = payload as WorkspaceFlowAnswer
      add({
        items: answer.kind === "found" ? answer.items : undefined,
        moreHref: answer.kind === "found" ? answer.moreHref : undefined,
        role: "flow",
        text: answer.reply,
      })

      if (answer.kind === "create") {
        // The new draft's editor picks the request up and Flow carries on there.
        handOffToFlow(trimmed, answer.sourceDocumentId && source ? source : undefined, mentioned)
        // The new template has the form now; the next request here starts fresh.
        attachment.clear()
        const formData = new FormData()
        formData.set("title", answer.title)
        startTransition(() =>
          answer.target === "template" ? createTemplateAction(formData) : createGeneratedDocumentAction(formData)
        )
      }
    } catch (error: unknown) {
      add({ failed: true, role: "flow", text: error instanceof Error ? error.message : "Flow couldn't answer that." })
      setText(message.trim())
      mentions.restore(mentioned)
    } finally {
      update(() => ({ busy: false }))
    }
  }

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void send(text)
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-2">
      {turns.length === 0 ? (
        <div className="grid gap-2 py-2">
          <p className="px-1 pb-1 text-lg font-medium">What do you need?</p>
          {PROMPTS.map((prompt) => (
            <button
              className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring/40"
              key={prompt}
              onClick={() => void send(prompt)}
              type="button"
            >
              {prompt}
              <ArrowRight aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      ) : (
        <ol aria-live="polite" className="grid gap-3 py-1">
          {turns.map((turn) => (
            <FlowMessage failed={turn.failed} from={turn.role} key={turn.id} speaker={turn.role === "member" ? "You" : undefined}>
              {turn.text}
              {turn.items && turn.items.length > 0 ? (
                <ul className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {turn.items.map((item) => (
                    <li key={item.id}>
                      <Link className="grid px-3 py-2 outline-none hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset" href={item.href} onClick={onLeave}>
                        <span className="truncate">{item.title}</span>
                        <span className="text-xs text-muted-foreground">{item.meta}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              {turn.moreHref ? (
                <Link className="mt-1.5 block w-fit text-xs text-muted-foreground underline-offset-2 hover:underline" href={turn.moreHref} onClick={onLeave}>
                  Open the list
                </Link>
              ) : null}
            </FlowMessage>
          ))}
          {busy ? <FlowWorking stages={stages} /> : null}
        </ol>
      )}
      </div>
      <form
        className="px-3 pt-1 pb-3"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          void send(text)
        }}
      >
        <label className="sr-only" htmlFor="workspace-flow-composer">
          Ask Flow
        </label>
        <FlowMentionChips mentions={mentions} />
        <FlowAttachChip attachment={attachment} />
        <div className="relative">
          {/* One line tall, growing with the message to about six. */}
          <textarea
            className={cn(FLOW_COMPOSER, FLOW_COMPOSER_ATTACH)}
            disabled={busy}
            id="workspace-flow-composer"
            maxLength={2_000}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKey}
            onPaste={mentions.onPaste}
            placeholder="Ask Flow…"
            value={text}
          />
          <FlowAddButton attachment={attachment} disabled={busy} mentions={mentions} />
          <button
            aria-label="Send to Flow"
            className={FLOW_SEND}
            disabled={busy || attachment.uploading || (text.trim().length < 2 && !attachment.source)}
            type="submit"
          >
            <ArrowUp aria-hidden="true" className="size-5" />
          </button>
        </div>
        <FlowModelPicker disabled={busy} model={flowModel.model} onChange={flowModel.pick} />
      </form>
    </>
  )
}
