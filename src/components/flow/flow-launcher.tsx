"use client"

import { ArrowRight, ArrowUp } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { type FormEvent, type KeyboardEvent, type ReactElement, useRef, useState, useTransition } from "react"

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

/**
 * Flow from any workspace page: Flow's button, which opens a conversation
 * that finds the member's work or starts something new. The conversation
 * stays as the member moves between pages.
 *
 * @param props - The workspace a file attached to Flow goes into.
 * @returns The launcher and its conversation.
 */
export function FlowLauncher({ organizationId }: { organizationId: string }): ReactElement {
  const [open, setOpen] = useState(false)

  return (
    // On a phone it rests above the tab bar, which is 4.5rem tall.
    <FlowWindow onOpenChange={setOpen} open={open} phoneBottom={72}>
      <FlowConversation onLeave={() => setOpen(false)} onShow={() => setOpen(true)} organizationId={organizationId} />
    </FlowWindow>
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
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()
  const nextId = useRef(0)
  // Read at once, not from the last render, so a quick second Enter never sends twice.
  const sending = useRef(false)
  const flowModel = useFlowModel()
  const mentions = useFlowMentions()
  // How far the turn in flight has got, as the server says.
  const [stages, setStages] = useState<readonly FlowStage[]>([])
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

  function add(turn: Omit<Turn, "id">): void {
    const id = nextId.current++
    setTurns((current) => [...current, { ...turn, id }])
  }

  async function send(message: string): Promise<void> {
    const source = attachment.source
    const trimmed = message.trim() || (source ? RECREATE : "")

    if (trimmed.length < 2 || sending.current || attachment.uploading) {
      return
    }

    sending.current = true

    const history = turns.slice(-6).map((turn) => ({ role: turn.role, text: turn.text }))
    add({ role: "member", text: trimmed })
    setText("")
    // A mention goes with this message only; a failed send puts it back.
    const mentioned = mentions.items
    mentions.clear()
    setBusy(true)
    // Said at once, before the server's first word arrives.
    setStages(["thinking"])

    try {
      const response = await fetch("/api/flow", {
        body: JSON.stringify({ history, mentions: mentions.payload, message: trimmed, model: flowModel.chosen(), sourceDocumentId: source?.id }),
        headers: FLOW_STREAM_HEADERS,
        method: "POST",
      })
      const turn = await readFlowTurn(response, (stage) => setStages((current) => (current.at(-1) === stage ? current : [...current, stage])))

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
        handOffToFlow(trimmed, answer.sourceDocumentId && source ? source : undefined)
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
      sending.current = false
      setBusy(false)
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
