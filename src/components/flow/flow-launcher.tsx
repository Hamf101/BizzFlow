"use client"

import { ArrowRight, ArrowUp } from "lucide-react"
import Link from "next/link"
import { type FormEvent, type KeyboardEvent, type ReactElement, useRef, useState, useTransition } from "react"

import { createGeneratedDocumentAction } from "@/app/(dashboard)/documents/actions"
import { createTemplateAction } from "@/app/(dashboard)/templates/actions"
import { FlowMark } from "@/components/brand/flow-mark"
import { handOffToFlow } from "@/components/flow/flow-handoff"
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
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
 * Flow from any workspace page: a floating button that opens a conversation
 * which finds the member's work or starts something new. The conversation
 * stays as the member moves between pages.
 *
 * @returns The launcher and its conversation.
 */
export function FlowLauncher(): ReactElement {
  const [open, setOpen] = useState(false)

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger
        aria-label="Flow"
        className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 grid size-13 place-items-center rounded-full border border-border bg-popover text-primary shadow-lg outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-95 motion-reduce:transition-none md:right-6 md:bottom-6"
        data-slot="flow-launcher"
        title="Flow"
      >
        <FlowMark aria-hidden="true" className="size-6" />
      </SheetTrigger>
      <SheetContent
        backdropClassName="md:bg-transparent md:backdrop-blur-none"
        className="md:inset-x-auto md:right-6 md:bottom-24 md:max-h-[min(38rem,calc(100dvh-8rem))] md:w-[24rem] md:rounded-[18px] md:border-b md:[&>span:first-child]:hidden"
      >
        <div className="flex items-center justify-between">
          <SheetTitle>Flow</SheetTitle>
          <SheetClose />
        </div>
        <FlowConversation onLeave={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}

function FlowConversation({ onLeave }: { onLeave: () => void }): ReactElement {
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()
  const nextId = useRef(0)

  function add(turn: Omit<Turn, "id">): void {
    const id = nextId.current++
    setTurns((current) => [...current, { ...turn, id }])
  }

  async function send(message: string): Promise<void> {
    const trimmed = message.trim()

    if (trimmed.length < 2 || busy) {
      return
    }

    const history = turns.slice(-6).map((turn) => ({ role: turn.role, text: turn.text }))
    add({ role: "member", text: trimmed })
    setText("")
    setBusy(true)

    try {
      const response = await fetch("/api/flow", {
        body: JSON.stringify({ history, message: trimmed }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const payload = (await response.json().catch(() => ({}))) as Partial<WorkspaceFlowAnswer> & { error?: string }

      if (!response.ok || !payload.kind) {
        throw new Error(payload.error ?? "Flow couldn't answer that.")
      }

      const answer = payload as WorkspaceFlowAnswer
      add({
        items: answer.kind === "found" ? answer.items : undefined,
        moreHref: answer.kind === "found" ? answer.moreHref : undefined,
        role: "flow",
        text: answer.reply,
      })

      if (answer.kind === "create") {
        // The new draft's editor picks the request up and Flow carries on there.
        handOffToFlow(trimmed)
        const formData = new FormData()
        formData.set("title", answer.title)
        startTransition(() =>
          answer.target === "template" ? createTemplateAction(formData) : createGeneratedDocumentAction(formData)
        )
      }
    } catch (error: unknown) {
      add({ failed: true, role: "flow", text: error instanceof Error ? error.message : "Flow couldn't answer that." })
      setText(trimmed)
    } finally {
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
    <div className="flex flex-col gap-3 px-1">
      {turns.length === 0 ? (
        <div className="grid gap-2 py-2">
          <p className="px-1 pb-1 text-lg font-medium">What do you need?</p>
          {PROMPTS.map((prompt) => (
            <button
              className="group flex items-center justify-between gap-3 rounded-[12px] border border-border bg-card px-3 py-2.5 text-left text-sm outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring/40"
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
            <li
              className={cn(
                "text-sm",
                turn.role === "member" && "max-w-[85%] justify-self-end rounded-[14px] bg-secondary px-3 py-2 text-secondary-foreground",
                turn.failed && "text-destructive"
              )}
              key={turn.id}
            >
              {turn.text}
              {turn.items && turn.items.length > 0 ? (
                <ul className="mt-2 divide-y divide-border overflow-hidden rounded-[12px] border border-border">
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
                <Link className="mt-1.5 inline-block text-xs text-muted-foreground underline-offset-2 hover:underline" href={turn.moreHref} onClick={onLeave}>
                  Open the list
                </Link>
              ) : null}
            </li>
          ))}
          {busy ? <li className="text-sm text-muted-foreground">Thinking…</li> : null}
        </ol>
      )}
      <form
        className="sticky bottom-0 bg-card pt-1"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          void send(text)
        }}
      >
        <label className="sr-only" htmlFor="workspace-flow-composer">
          Ask Flow
        </label>
        <div className="relative">
          <textarea
            className="min-h-20 w-full resize-none rounded-[12px] border border-border bg-card px-3 py-2.5 pr-12 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            disabled={busy}
            id="workspace-flow-composer"
            maxLength={2_000}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask Flow…"
            value={text}
          />
          <button
            aria-label="Send to Flow"
            className="absolute right-2 bottom-2.5 grid size-8 place-items-center rounded-full text-primary outline-none transition-opacity hover:opacity-75 disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-ring/40"
            disabled={busy || text.trim().length < 2}
            type="submit"
          >
            <ArrowUp aria-hidden="true" className="size-5" />
          </button>
        </div>
      </form>
    </div>
  )
}
