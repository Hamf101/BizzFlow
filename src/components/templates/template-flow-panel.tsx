"use client"

import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  LoaderCircle,
  Move,
  PencilLine,
  RotateCcw,
  Send,
  Trash2
} from "lucide-react"
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState
} from "react"

import { BizFlowMark } from "@/components/brand/bizflow-mark"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { templateContentSchema } from "@/types/template"
import type {
  TemplateFlowDraft,
  TemplateFlowLedgerItem,
  TemplateFlowMessage,
  TemplateFlowOperationType,
  TemplateFlowResult
} from "@/types/template-flow"

const REQUEST_TIMEOUT_MS = 45_000
const STARTER_PROMPTS = [
  "Create a clear client intake form",
  "Organize this into a professional agreement",
  "Explain the structure of this document"
] as const

type TemplateFlowPanelProps = {
  canUndo: boolean
  draft: TemplateFlowDraft
  initialMessages: TemplateFlowMessage[]
  lastAppliedMessageId: string | null
  onApply: (
    draft: TemplateFlowDraft,
    changedBlockIds: string[],
    messageId: string
  ) => void
  onUndo: () => void
  templateId: string
}

/**
 * Renders Flow as a persistent chat with embedded, accountable change receipts.
 *
 * @param props - Current draft, shared history, apply/undo callbacks, and template id.
 * @returns A chat-first panel whose document actions become ledger entries.
 */
export function TemplateFlowPanel({
  canUndo,
  draft,
  initialMessages,
  lastAppliedMessageId,
  onApply,
  onUndo,
  templateId
}: TemplateFlowPanelProps): ReactElement {
  const [messages, setMessages] =
    useState<TemplateFlowMessage[]>(initialMessages)
  const [instruction, setInstruction] = useState<string>("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [warningMessage, setWarningMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const timelineRef = useRef<HTMLDivElement>(null)

  useEffect((): void => {
    const timeline = timelineRef.current

    if (timeline) {
      timeline.scrollTop = timeline.scrollHeight
    }
  }, [messages, isLoading])

  async function submitMessage(message: string): Promise<void> {
    const trimmedInstruction = message.trim()

    if (!trimmedInstruction || isLoading) {
      return
    }

    setErrorMessage(null)
    setWarningMessage(null)
    setIsLoading(true)
    setInstruction("")
    const controller = new AbortController()
    const timeoutId = window.setTimeout(
      (): void => controller.abort(),
      REQUEST_TIMEOUT_MS
    )
    const startedAt = performance.now()

    try {
      const response = await fetch("/api/templates/flow", {
        body: JSON.stringify({
          templateId,
          draft,
          instruction: trimmedInstruction
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: controller.signal
      })
      const payload = await readJsonResponse(response)

      if (!response.ok) {
        throw new Error(readApiError(payload))
      }

      const result = parseFlowResult(payload)
      setMessages((currentMessages: TemplateFlowMessage[]) => [
        ...currentMessages,
        ...result.messages
      ])

      const assistantMessage = result.messages[1]

      if (assistantMessage.operations.length > 0) {
        onApply(result.draft, result.changedBlockIds, assistantMessage.id)
      }

      if (result.persistenceWarning) {
        setWarningMessage(result.persistenceWarning)
      }

      console.info("template_flow_response_loaded", {
        durationMs: Math.round(performance.now() - startedAt),
        operationCount: assistantMessage.operations.length,
        templateId
      })
    } catch (error: unknown) {
      const reason =
        error instanceof DOMException && error.name === "AbortError"
          ? "Flow took too long to respond. Try a shorter request."
          : error instanceof Error
            ? error.message
            : "Unable to reach Flow."

      console.warn("template_flow_response_failed", {
        durationMs: Math.round(performance.now() - startedAt),
        reason,
        templateId
      })
      setErrorMessage(reason)
      setInstruction(trimmedInstruction)
    } finally {
      window.clearTimeout(timeoutId)
      setIsLoading(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void submitMessage(instruction)
  }

  function handleComposerKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>
  ): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void submitMessage(instruction)
    }
  }

  return (
    <aside
      aria-label="Flow document assistant"
      className="flex min-h-[36rem] flex-col overflow-hidden rounded-[10px] border border-primary/15 bg-secondary/70 shadow-[0_8px_30px_rgba(37,35,41,0.07)] xl:sticky xl:top-5 xl:h-[calc(100vh-2.5rem)] xl:max-h-[52rem]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-primary/10 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-[8px] border border-primary/15 bg-card text-primary">
            <BizFlowMark className="size-5" />
          </span>
          <div>
            <h2 className="font-editorial text-lg font-semibold leading-none">
              Flow
            </h2>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              Conversation · change ledger
            </p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary/70" />
          Document aware
        </span>
      </header>

      <div
        aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        ref={timelineRef}
      >
        {messages.length === 0 ? (
          <FlowEmptyState onSelectPrompt={submitMessage} />
        ) : (
          <ol className="flex flex-col gap-5">
            {messages.map((message: TemplateFlowMessage) => (
              <FlowMessageEntry
                canUndo={
                  canUndo &&
                  message.role === "assistant" &&
                  message.id === lastAppliedMessageId
                }
                key={message.id}
                message={message}
                onUndo={onUndo}
              />
            ))}
          </ol>
        )}

        {isLoading && (
          <div className="mt-5 flex items-center gap-2 border-l border-primary/30 pl-3 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin text-primary" />
            <span>Flow is reading the document…</span>
          </div>
        )}
      </div>

      {(errorMessage || warningMessage) && (
        <div className="px-4 pb-3">
          <Alert variant={errorMessage ? "destructive" : "default"}>
            <AlertTitle>
              {errorMessage ? "Flow could not respond" : "History not saved"}
            </AlertTitle>
            <AlertDescription>
              {errorMessage ?? warningMessage}
            </AlertDescription>
          </Alert>
        </div>
      )}

      <form
        className="border-t border-primary/10 bg-card/75 p-3"
        onSubmit={handleSubmit}
      >
        <label
          className="editorial-kicker mb-2 block text-muted-foreground"
          htmlFor="flow-composer"
        >
          Tell Flow what to create or change
        </label>
        <div className="relative">
          <textarea
            aria-describedby="flow-composer-hint"
            className="min-h-24 w-full resize-none rounded-[8px] border border-primary/15 bg-card px-3 py-2.5 pr-12 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
            disabled={isLoading}
            id="flow-composer"
            maxLength={2_000}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
              setInstruction(event.target.value)
            }
            onKeyDown={handleComposerKeyDown}
            placeholder="Ask a question, create a document, or reorganize what is here…"
            value={instruction}
          />
          <Button
            aria-label="Send message to Flow"
            className="absolute right-2 bottom-2"
            disabled={isLoading || instruction.trim().length < 2}
            size="icon"
            type="submit"
          >
            <Send />
          </Button>
        </div>
        <p
          className="mt-1.5 text-[10px] text-muted-foreground"
          id="flow-composer-hint"
        >
          Enter to send · Shift + Enter for a new line
        </p>
      </form>
    </aside>
  )
}

function FlowEmptyState({
  onSelectPrompt
}: {
  onSelectPrompt: (prompt: string) => Promise<void>
}): ReactElement {
  return (
    <div className="flex min-h-full flex-col justify-center py-6">
      <span className="editorial-kicker text-primary">
        Start with a thought
      </span>
      <h3 className="mt-2 max-w-xs font-editorial text-2xl font-semibold leading-tight">
        Chat with the document, then see every change.
      </h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Ask questions, create content, or reorganize the draft. Flow records a
        ledger only when it changes something.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        {STARTER_PROMPTS.map((prompt: string) => (
          <button
            className="group flex items-center justify-between gap-3 rounded-[8px] border border-primary/10 bg-card/65 px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/25 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            key={prompt}
            onClick={(): void => {
              void onSelectPrompt(prompt)
            }}
            type="button"
          >
            <span>{prompt}</span>
            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </button>
        ))}
      </div>
    </div>
  )
}

function FlowMessageEntry({
  canUndo,
  message,
  onUndo
}: {
  canUndo: boolean
  message: TemplateFlowMessage
  onUndo: () => void
}): ReactElement {
  const isUser = message.role === "user"

  return (
    <li
      className={cn(
        "border-l pl-3",
        isUser ? "border-border" : "border-primary/35"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {isUser ? message.authorName || "Team member" : "Flow"}
        </span>
        <time
          className="text-[10px] text-muted-foreground"
          dateTime={message.createdAt}
        >
          {formatMessageTime(message.createdAt)}
        </time>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
        {message.content}
      </p>

      {message.operations.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-[8px] border border-primary/12 bg-card/70">
          <div className="border-b border-primary/10 px-3 py-2">
            <span className="editorial-kicker text-primary">Change set</span>
          </div>
          <ul>
            {message.operations.map((operation: TemplateFlowLedgerItem) => (
              <FlowLedgerRow key={operation.id} operation={operation} />
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-primary/10 px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Check className="size-3.5 text-primary" />
              {message.operations.length}{" "}
              {message.operations.length === 1 ? "change" : "changes"} applied
            </span>
            {canUndo && (
              <Button onClick={onUndo} size="xs" type="button" variant="ghost">
                <RotateCcw />
                Undo
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function FlowLedgerRow({
  operation
}: {
  operation: TemplateFlowLedgerItem
}): ReactElement {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 border-b border-primary/8 px-3 py-2.5 last:border-b-0">
      {renderOperationIcon(operation.type)}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-primary">
            {formatOperationType(operation.type)}
          </span>
          <span className="text-xs font-medium">{operation.summary}</span>
        </div>
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
          {operation.target}
        </p>
      </div>
    </li>
  )
}

function renderOperationIcon(type: TemplateFlowOperationType): ReactElement {
  const className = "mt-0.5 size-3.5 text-primary"

  if (type === "move_block") {
    return <Move className={className} />
  }

  if (type === "remove_block") {
    return <Trash2 className={className} />
  }

  if (type === "add_block") {
    return <ArrowDownToLine className={className} />
  }

  return <PencilLine className={className} />
}

function formatOperationType(type: TemplateFlowOperationType): string {
  const labels: Record<TemplateFlowOperationType, string> = {
    set_title: "Rename",
    set_description: "Describe",
    set_branding: "Brand",
    add_block: "Add",
    update_block: "Revise",
    update_image: "Position",
    move_block: "Move",
    remove_block: "Remove"
  }

  return labels[type]
}

function formatMessageTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ""
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date)
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error("Flow returned an unreadable response.")
  }
}

function readApiError(payload: unknown): string {
  if (
    isRecord(payload) &&
    typeof payload.error === "string" &&
    payload.error.length > 0
  ) {
    return payload.error
  }

  return "Unable to complete the Flow request."
}

function parseFlowResult(payload: unknown): TemplateFlowResult {
  if (
    !isRecord(payload) ||
    !isRecord(payload.draft) ||
    typeof payload.draft.title !== "string" ||
    typeof payload.draft.description !== "string" ||
    !Array.isArray(payload.messages) ||
    payload.messages.length !== 2 ||
    !Array.isArray(payload.changedBlockIds) ||
    typeof payload.needsConfirmation !== "boolean"
  ) {
    throw new Error("Flow returned an invalid response.")
  }

  const contentResult = templateContentSchema.safeParse(payload.draft.content)
  const messages = payload.messages.map(parseFlowMessage)

  if (
    !contentResult.success ||
    messages.some(
      (message: TemplateFlowMessage | null): boolean => message === null
    )
  ) {
    throw new Error("Flow returned an invalid response.")
  }

  return {
    draft: {
      title: payload.draft.title,
      description: payload.draft.description,
      content: contentResult.data
    },
    messages: messages as [TemplateFlowMessage, TemplateFlowMessage],
    changedBlockIds: payload.changedBlockIds.filter(
      (blockId: unknown): blockId is string => typeof blockId === "string"
    ),
    needsConfirmation: payload.needsConfirmation,
    persistenceWarning:
      typeof payload.persistenceWarning === "string"
        ? payload.persistenceWarning
        : null
  }
}

function parseFlowMessage(value: unknown): TemplateFlowMessage | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string" ||
    (typeof value.authorName !== "string" && value.authorName !== null) ||
    !Array.isArray(value.operations) ||
    !Array.isArray(value.changedBlockIds) ||
    typeof value.createdAt !== "string"
  ) {
    return null
  }

  const operations = value.operations
    .map(parseLedgerItem)
    .filter(
      (
        operation: TemplateFlowLedgerItem | null
      ): operation is TemplateFlowLedgerItem => operation !== null
    )

  if (operations.length !== value.operations.length) {
    return null
  }

  return {
    id: value.id,
    role: value.role,
    content: value.content,
    authorName: value.authorName,
    operations,
    changedBlockIds: value.changedBlockIds.filter(
      (blockId: unknown): blockId is string => typeof blockId === "string"
    ),
    createdAt: value.createdAt
  }
}

function parseLedgerItem(value: unknown): TemplateFlowLedgerItem | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.target !== "string" ||
    !Array.isArray(value.affectedBlockIds)
  ) {
    return null
  }

  const allowedTypes: readonly string[] = [
    "set_title",
    "set_description",
    "set_branding",
    "add_block",
    "update_block",
    "update_image",
    "move_block",
    "remove_block"
  ]

  if (!allowedTypes.includes(value.type)) {
    return null
  }

  return {
    id: value.id,
    type: value.type as TemplateFlowOperationType,
    summary: value.summary,
    target: value.target,
    affectedBlockIds: value.affectedBlockIds.filter(
      (blockId: unknown): blockId is string => typeof blockId === "string"
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
