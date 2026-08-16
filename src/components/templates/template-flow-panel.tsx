"use client"

import {
  ArrowDownToLine,
  ArrowRight,
  AlertTriangle,
  Check,
  LoaderCircle,
  Move,
  PencilLine,
  RotateCcw,
  Send,
  Trash2,
  X
} from "lucide-react"
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"

import { BizFlowMark } from "@/components/brand/bizflow-mark"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { createTemplateFlowDraftFingerprint } from "@/services/template-flow-proposal-state"
import { templateContentSchema } from "@/types/template"
import type {
  TemplateFlowDraft,
  TemplateFlowLedgerItem,
  TemplateFlowMessage,
  TemplateFlowOperationType,
  TemplateFlowProposal,
  TemplateFlowQualityIssue,
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
  onApply?: (
    draft: TemplateFlowDraft,
    changedBlockIds: string[],
    messageId: string
  ) => void
  onApplyProposal?: (
    proposal: TemplateFlowProposal,
    messageId: string
  ) => void
  onProposalReceived?: (
    proposal: TemplateFlowProposal,
    messageId: string
  ) => void
  onProposalStale?: (proposal: TemplateFlowProposal) => void
  onRejectProposal?: (proposal: TemplateFlowProposal) => void
  onUndo: () => void
  pendingProposal?: TemplateFlowProposal | null
  templateId: string
}

/**
 * Renders Flow as a persistent chat with reviewable proposal receipts.
 *
 * @param props - Current draft, history, proposal callbacks, and template id.
 * @returns A chat-first panel that stages coherent batches before acceptance.
 */
export function TemplateFlowPanel({
  canUndo,
  draft,
  initialMessages,
  lastAppliedMessageId,
  onApply,
  onApplyProposal,
  onProposalReceived,
  onProposalStale,
  onRejectProposal,
  onUndo,
  pendingProposal: controlledPendingProposal,
  templateId
}: TemplateFlowPanelProps): ReactElement {
  const [messages, setMessages] =
    useState<TemplateFlowMessage[]>(initialMessages)
  const [instruction, setInstruction] = useState<string>("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [warningMessage, setWarningMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [localPendingProposal, setLocalPendingProposal] =
    useState<TemplateFlowProposal | null>(null)
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<TemplateFlowDraft>(draft)
  const isProposalControlled = controlledPendingProposal !== undefined
  const pendingProposal = isProposalControlled
    ? controlledPendingProposal
    : localPendingProposal
  const displayedPendingProposal = useMemo((): TemplateFlowProposal | null => {
    if (
      pendingProposal?.status !== "pending" ||
      pendingProposal.baseDraftFingerprint ===
        createTemplateFlowDraftFingerprint(draft)
    ) {
      return pendingProposal
    }

    return { ...pendingProposal, status: "stale" }
  }, [draft, pendingProposal])

  useEffect((): void => {
    draftRef.current = draft
  }, [draft])

  useEffect((): void => {
    const timeline = timelineRef.current

    if (timeline) {
      timeline.scrollTop = timeline.scrollHeight
    }
  }, [messages, isLoading, pendingProposal])

  async function submitMessage(message: string): Promise<void> {
    const trimmedInstruction = message.trim()

    if (!trimmedInstruction || isLoading || pendingProposal !== null) {
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

      if (result.proposal !== null) {
        const isCurrentBase =
          result.proposal.baseDraftFingerprint ===
          createTemplateFlowDraftFingerprint(draftRef.current)
        const stagedProposal: TemplateFlowProposal = isCurrentBase
          ? result.proposal
          : { ...result.proposal, status: "stale" }

        setPendingMessageId(assistantMessage.id)
        if (!isProposalControlled) {
          setLocalPendingProposal(stagedProposal)
        }
        onProposalReceived?.(stagedProposal, assistantMessage.id)

        if (!isCurrentBase) {
          setErrorMessage(
            "The draft changed while Flow was preparing this proposal. Reject it and ask Flow again."
          )
          onProposalStale?.(stagedProposal)
        }
      }

      if (result.persistenceWarning) {
        setWarningMessage(result.persistenceWarning)
      }

      console.info("template_flow_response_loaded", {
        durationMs: Math.round(performance.now() - startedAt),
        operationCount: result.proposal?.operations.length ?? 0,
        proposalId: result.proposal?.id ?? null,
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

  function applyPendingProposal(): void {
    if (pendingProposal === null) {
      return
    }

    const messageId = pendingMessageId ?? pendingProposal.id
    const isCurrentBase =
      pendingProposal.status === "pending" &&
      pendingProposal.baseDraftFingerprint ===
        createTemplateFlowDraftFingerprint(draftRef.current)

    if (!isCurrentBase) {
      const staleProposal: TemplateFlowProposal = {
        ...pendingProposal,
        status: "stale"
      }

      if (!isProposalControlled) {
        setLocalPendingProposal(staleProposal)
      }
      setErrorMessage(
        "This proposal is stale because the draft changed. Reject it and ask Flow again."
      )
      onProposalStale?.(staleProposal)
      return
    }

    if (onApplyProposal) {
      onApplyProposal(pendingProposal, messageId)
    } else {
      onApply?.(
        pendingProposal.candidateDraft,
        pendingProposal.changedBlockIds,
        messageId
      )
    }

    if (!isProposalControlled) {
      setLocalPendingProposal(null)
    }
    setPendingMessageId(null)
    setErrorMessage(null)
  }

  function rejectPendingProposal(): void {
    if (pendingProposal === null) {
      return
    }

    onRejectProposal?.(displayedPendingProposal ?? pendingProposal)
    if (!isProposalControlled) {
      setLocalPendingProposal(null)
    }
    setPendingMessageId(null)
    setErrorMessage(null)
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
              Conversation · proposal ledger
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

        {displayedPendingProposal !== null && (
          <FlowPendingProposalReceipt
            canApply={
              displayedPendingProposal.status === "pending" &&
              (onApplyProposal !== undefined || onApply !== undefined)
            }
            onApply={applyPendingProposal}
            onReject={rejectPendingProposal}
            proposal={displayedPendingProposal}
          />
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
            disabled={isLoading || pendingProposal !== null}
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
            disabled={
              isLoading ||
              pendingProposal !== null ||
              instruction.trim().length < 2
            }
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
          {pendingProposal
            ? "Apply all or reject all before asking Flow for another change"
            : "Enter to send · Shift + Enter for a new line"}
        </p>
      </form>
    </aside>
  )
}

function FlowPendingProposalReceipt({
  canApply,
  onApply,
  onReject,
  proposal
}: {
  canApply: boolean
  onApply: () => void
  onReject: () => void
  proposal: TemplateFlowProposal
}): ReactElement {
  const isStale = proposal.status === "stale"

  return (
    <section
      aria-label="Pending Flow proposal"
      className="mt-5 overflow-hidden rounded-[8px] border border-primary/20 bg-card shadow-sm"
    >
      <div className="flex items-start justify-between gap-3 border-b border-primary/10 px-3 py-2.5">
        <div>
          <span className="editorial-kicker text-primary">
            {isStale ? "Stale proposal" : "Pending proposal"}
          </span>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {isStale
              ? "The base draft changed. This batch can no longer be applied."
              : `${proposal.operations.length} ${
                  proposal.operations.length === 1 ? "change" : "changes"
                } proposed as one reviewable batch.`}
          </p>
        </div>
        {isStale && (
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        )}
      </div>

      {proposal.qualityIssues.length > 0 && (
        <div className="border-b border-primary/10 px-3 py-2.5">
          <p className="text-[11px] font-medium">Deterministic review</p>
          <ul className="mt-1.5 space-y-1.5">
            {proposal.qualityIssues.map(
              (issue: TemplateFlowQualityIssue, index: number) => (
                <li
                  className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground"
                  key={`${issue.code}-${index}`}
                >
                  <AlertTriangle
                    className={cn(
                      "mt-0.5 size-3 shrink-0",
                      issue.severity === "critical"
                        ? "text-destructive"
                        : "text-primary"
                    )}
                  />
                  <span>{issue.message}</span>
                </li>
              )
            )}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 px-3 py-2.5">
        <Button onClick={onReject} size="sm" type="button" variant="outline">
          <X />
          Reject all
        </Button>
        <Button disabled={!canApply} onClick={onApply} size="sm" type="button">
          <Check />
          Apply all
        </Button>
      </div>
    </section>
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
        Chat with the document, then review every proposal.
      </h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Ask questions, create content, or reorganize the draft. Flow records a
        ledger when it prepares a reviewable batch.
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
            <span className="editorial-kicker text-primary">
              Proposed change set
            </span>
          </div>
          <ul>
            {message.operations.map((operation: TemplateFlowLedgerItem) => (
              <FlowLedgerRow key={operation.id} operation={operation} />
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-primary/10 px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <PencilLine className="size-3.5 text-primary" />
              {message.operations.length}{" "}
              {message.operations.length === 1 ? "change" : "changes"} proposed
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
    (payload.proposal !== null && !isRecord(payload.proposal)) ||
    !Array.isArray(payload.messages) ||
    payload.messages.length !== 2 ||
    typeof payload.needsConfirmation !== "boolean"
  ) {
    throw new Error("Flow returned an invalid response.")
  }

  const messages = payload.messages.map(parseFlowMessage)
  const proposal =
    payload.proposal === null ? null : parseFlowProposal(payload.proposal)

  if (
    (payload.proposal !== null && proposal === null) ||
    messages.some(
      (message: TemplateFlowMessage | null): boolean => message === null
    )
  ) {
    throw new Error("Flow returned an invalid response.")
  }

  return {
    proposal,
    messages: messages as [TemplateFlowMessage, TemplateFlowMessage],
    needsConfirmation: payload.needsConfirmation,
    persistenceWarning:
      typeof payload.persistenceWarning === "string"
        ? payload.persistenceWarning
        : null
  }
}

function parseFlowProposal(value: unknown): TemplateFlowProposal | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    (value.status !== "pending" && value.status !== "stale") ||
    typeof value.baseDraftFingerprint !== "string" ||
    !isRecord(value.candidateDraft) ||
    typeof value.candidateDraft.title !== "string" ||
    typeof value.candidateDraft.description !== "string" ||
    !Array.isArray(value.operations) ||
    value.operations.length === 0 ||
    !Array.isArray(value.changedBlockIds) ||
    !Array.isArray(value.qualityIssues)
  ) {
    return null
  }

  const contentResult = templateContentSchema.safeParse(
    value.candidateDraft.content
  )
  const operations = value.operations.map(parseLedgerItem)
  const changedBlockIds = value.changedBlockIds.filter(
    (blockId: unknown): blockId is string => typeof blockId === "string"
  )
  const qualityIssues = value.qualityIssues.map(parseFlowQualityIssue)

  if (
    !contentResult.success ||
    operations.some(
      (operation: TemplateFlowLedgerItem | null): boolean => operation === null
    ) ||
    operations.length !== value.operations.length ||
    changedBlockIds.length !== value.changedBlockIds.length ||
    qualityIssues.some(
      (issue: TemplateFlowQualityIssue | null): boolean => issue === null
    )
  ) {
    return null
  }

  return {
    id: value.id,
    status: value.status,
    baseDraftFingerprint: value.baseDraftFingerprint,
    candidateDraft: {
      title: value.candidateDraft.title,
      description: value.candidateDraft.description,
      content: contentResult.data
    },
    operations: operations as TemplateFlowLedgerItem[],
    changedBlockIds,
    qualityIssues: qualityIssues as TemplateFlowQualityIssue[]
  }
}

function parseFlowQualityIssue(
  value: unknown
): TemplateFlowQualityIssue | null {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    (value.severity !== "critical" && value.severity !== "warning") ||
    typeof value.message !== "string" ||
    !Array.isArray(value.affectedBlockIds)
  ) {
    return null
  }

  const affectedBlockIds = value.affectedBlockIds.filter(
    (blockId: unknown): blockId is string => typeof blockId === "string"
  )

  if (affectedBlockIds.length !== value.affectedBlockIds.length) {
    return null
  }

  return {
    code: value.code,
    severity: value.severity,
    message: value.message,
    affectedBlockIds
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
    (value.receiptStatus !== "proposed" && value.receiptStatus !== null) ||
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
    receiptStatus: value.receiptStatus,
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
