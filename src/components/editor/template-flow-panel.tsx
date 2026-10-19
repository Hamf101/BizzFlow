"use client"

import {
  ArrowDownToLine,
  ArrowRight,
  FilePlus2,
  ArrowUp,
  AlertTriangle,
  Check,
  Columns2,
  LayoutTemplate,
  LoaderCircle,
  type LucideIcon,
  Move,
  PencilLine,
  RotateCcw,
  Rows2,
  Section,
  Trash2,
  X
} from "lucide-react"
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState
} from "react"
import * as z from "zod"

import { FLOW_COMPOSER_ATTACH, FlowAddButton, FlowAttachChip, RECREATE, useFlowAttachment } from "@/components/flow/flow-attach"
import type { FlowHandoff, FlowSource } from "@/components/flow/flow-handoff"
import { FlowModelPicker, useFlowModel } from "@/components/flow/flow-model-picker"
import { FlowMentionChips, useFlowMentions } from "@/components/flow/flow-mentions"
import { FlowMessage, FlowWorking } from "@/components/flow/flow-message"
import { FLOW_STREAM_HEADERS, readFlowTurn } from "@/components/flow/flow-stream"
import { FLOW_COMPOSER, FLOW_SEND } from "@/components/flow/flow-window"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { bizflowToast } from "@/components/ui/toaster"
import { cn } from "@/lib/utils"
import { TEMPLATE_FLOW_OPERATION_TYPES } from "@/services/template-ai/flow-response-schema"
import {
  createTemplateFlowDraftFingerprint,
  toTemplateFlowDraft
} from "@/services/template-flow-proposal-state"
import { templateContentSchema } from "@/types/template"
import type {
  FlowFillResult,
  TemplateFlowDraft,
  TemplateFlowLedgerItem,
  TemplateFlowMessage,
  TemplateFlowOperationType,
  TemplateFlowProposal,
  TemplateFlowQualityIssue,
  TemplateFlowResult,
  TemplateFlowWireOperation
} from "@/types/template-flow"
import type { FlowStage } from "@/services/template-flow/contracts"

// The server bounds every AI call itself (two at most per turn), so this only
// catches a connection that never answers, and must outlast the longest turn.
const REQUEST_TIMEOUT_MS = 300_000
const TEMPLATE_STARTER: FlowStarter = {
  heading: "Ask Flow to build or change this document.",
  placeholder: "Ask Flow to create or change something…",
  prompts: [
    "Create a clear client intake form",
    "Organize this into a professional agreement",
    "Explain the structure of this document"
  ]
}

/** What an empty conversation offers: a line, a few first messages, and the box's hint. */
export type FlowStarter = Readonly<{ heading: string; placeholder: string; prompts: readonly string[] }>

// A pause this long between one author's messages starts a new run, which shows its time again.
const RUN_BREAK_MS = 10 * 60_000

/** A proposal as Flow made it, and the changes its reviewer dropped by hand. */
type FlowReview = Readonly<{ original: TemplateFlowProposal; dropped: ReadonlySet<number> }>

type TemplateFlowPanelProps = {
  canUndo: boolean
  draft: TemplateFlowDraft
  initialMessages: TemplateFlowMessage[]
  lastAppliedMessageId: string | null
  onApplyProposal: (
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
  /** The proposal on show, which the editor owns so the page can preview it. */
  pendingProposal: TemplateFlowProposal | null
  /** A request carried in from elsewhere, sent once when it arrives, with the file it is about. */
  autoSend?: FlowHandoff | null
  /** Where turns go; a document's Flow answers at its own route. */
  endpoint?: string
  /** The empty conversation's line and first messages, for what is open. */
  starter?: FlowStarter
  /** Sent with each turn to the template route, which reads it from the body. */
  templateId?: string
  /** Given, a form can be attached for Flow to recreate; it is uploaded into this workspace's Files. */
  organizationId?: string
  /**
   * Fills with the answers read off a form, offered once such a proposal is
   * applied: a template makes a filled copy and opens it, a document fills
   * them in `here`.
   */
  fill?: Readonly<{
    action: (answers: Record<string, unknown>) => Promise<FlowFillResult>
    here?: boolean
    /** Opens the filled copy; a full page load when not given. */
    open?: (href: string) => void
  }>
  /** Saves what the editor holds, so the fields the answers go in are saved first; or says why it can't. */
  onSaveFirst?: () => Promise<string | null>
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
  onApplyProposal,
  onProposalReceived,
  onProposalStale,
  onRejectProposal,
  onUndo,
  pendingProposal,
  autoSend = null,
  endpoint = "/api/templates/flow",
  starter = TEMPLATE_STARTER,
  templateId,
  organizationId,
  fill,
  onSaveFirst
}: TemplateFlowPanelProps): ReactElement {
  // First, so the kept model is read before a carried message is sent.
  const flowModel = useFlowModel()
  const [messages, setMessages] =
    useState<TemplateFlowMessage[]>(initialMessages)
  const [instruction, setInstruction] = useState<string>("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [warningMessage, setWarningMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null)
  const [review, setReview] = useState<FlowReview | null>(null)
  const [isRebuilding, setIsRebuilding] = useState<boolean>(false)
  const attachment = useFlowAttachment(organizationId ?? "")
  const mentions = useFlowMentions()
  // How far the turn in flight has got, as the server says, and whether it is reading a form.
  const [stages, setStages] = useState<readonly FlowStage[]>([])
  const [readingForm, setReadingForm] = useState(false)
  // The answers each proposal read off its form, by its message, kept in this
  // tab only and never saved with the chat. A form recreated over several
  // turns is answered a turn at a time, so every applied turn's answers from
  // the same form are offered together.
  const [formAnswers, setFormAnswers] = useState<ReadonlyMap<string, FormAnswers>>(new Map())
  const justApplied = lastAppliedMessageId === null ? undefined : formAnswers.get(lastAppliedMessageId)

  // Applied from Flow or from the editor's own banner: either way it arrives here.
  if (lastAppliedMessageId !== null && justApplied && !justApplied.applied) {
    setFormAnswers(new Map(formAnswers).set(lastAppliedMessageId, { ...justApplied, applied: true }))
  }

  const appliedAnswers = [...formAnswers.values()].filter((entry) => entry.applied)
  const fillSourceId = appliedAnswers.at(-1)?.sourceId
  const combinedAnswers: Record<string, unknown> = Object.assign(
    {},
    ...appliedAnswers.filter((entry) => entry.sourceId === fillSourceId).map((entry) => entry.answers)
  )
  const [filling, setFilling] = useState<boolean>(false)
  const timelineRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<TemplateFlowDraft>(draft)
  // What the editor holds now, read after a rebuild: null once it was rejected.
  const heldRef = useRef<TemplateFlowProposal | null>(pendingProposal)
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
    heldRef.current = pendingProposal
  }, [pendingProposal])

  const carried = useRef<string | null>(null)
  const sendCarried = useEffectEvent(({ instruction, source }: FlowHandoff): void => {
    const attached = organizationId ? source : undefined

    if (attached) {
      attachment.set(attached)
    }

    void submitMessage(instruction, attached ?? null)
  })

  useEffect((): void => {
    const key = autoSend ? JSON.stringify(autoSend) : null

    // The ref keeps a development double-run from sending it twice.
    if (autoSend && carried.current !== key) {
      carried.current = key
      sendCarried(autoSend)
    }
  }, [autoSend])

  useEffect((): void => {
    const timeline = timelineRef.current

    if (timeline) {
      timeline.scrollTop = timeline.scrollHeight
    }
  }, [messages, isLoading, pendingProposal])

  async function submitMessage(message: string, source: FlowSource | null = attachment.source): Promise<void> {
    const trimmedInstruction = message.trim() || (source ? RECREATE : "")

    if (!trimmedInstruction || isLoading || pendingProposal !== null || attachment.uploading) {
      return
    }

    setErrorMessage(null)
    setWarningMessage(null)
    setIsLoading(true)
    // Said at once, before the server's first word arrives.
    setStages(["reading"])
    setReadingForm(source !== null)
    setInstruction("")
    // A mention goes with this message only; a failed send puts it back.
    const mentioned = mentions.items
    mentions.clear()
    const controller = new AbortController()
    const timeoutId = window.setTimeout(
      (): void => controller.abort(),
      REQUEST_TIMEOUT_MS
    )
    const startedAt = performance.now()

    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify({
          templateId,
          draft: toTemplateFlowDraft(draft),
          instruction: trimmedInstruction,
          mentions: mentions.payload,
          model: flowModel.chosen(),
          // Sent again on every turn while it stays attached: each turn reads it afresh.
          sourceDocumentId: source?.id
        }),
        headers: FLOW_STREAM_HEADERS,
        method: "POST",
        signal: controller.signal
      })
      const turn = await readFlowTurn(response, (stage) => setStages((current) => (current.at(-1) === stage ? current : [...current, stage])))

      if (!turn.ok) {
        throw new Error(turn.error)
      }

      const result = parseFlowResult(turn.payload)
      setMessages((currentMessages: TemplateFlowMessage[]) => [
        ...currentMessages,
        ...result.messages
      ])

      const assistantMessage = result.messages[1]
      const answers = result.proposal?.sourceAnswers

      if (answers && source && Object.keys(answers).length > 0) {
        setFormAnswers((current) => new Map(current).set(assistantMessage.id, { answers, applied: false, sourceId: source.id }))
      }

      if (result.proposal !== null) {
        const isCurrentBase =
          result.proposal.baseDraftFingerprint ===
          createTemplateFlowDraftFingerprint(draftRef.current)
        const stagedProposal: TemplateFlowProposal = isCurrentBase
          ? result.proposal
          : { ...result.proposal, status: "stale" }

        setPendingMessageId(assistantMessage.id)
        setReview({ original: stagedProposal, dropped: new Set() })
        stageProposal(stagedProposal, assistantMessage.id)

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
        endpoint
      })
    } catch (error: unknown) {
      const reason =
        error instanceof DOMException && error.name === "AbortError"
          ? "Flow took too long to answer. Try again."
          : error instanceof Error
            ? error.message
            : "Unable to reach Flow."

      console.warn("template_flow_response_failed", {
        durationMs: Math.round(performance.now() - startedAt),
        reason,
        endpoint
      })
      setErrorMessage(reason)
      setInstruction(message.trim())
      mentions.restore(mentioned)
    } finally {
      window.clearTimeout(timeoutId)
      setIsLoading(false)
    }
  }

  function stageProposal(next: TemplateFlowProposal, messageId: string): void {
    onProposalReceived?.(next, messageId)
  }

  // Dropping or keeping a change rebuilds the batch on the server from the
  // changes still kept, so the page shows, and Apply takes, exactly those.
  async function reviewChange(index: number, drop: boolean): Promise<void> {
    if (review === null || isRebuilding) {
      return
    }

    const dropped = new Set(review.dropped)
    const messageId = pendingMessageId ?? review.original.id

    if (drop) {
      dropped.add(index)
      // The answers are keyed by the fields as first made; a rebuild makes them
      // again and can key them otherwise, so its answers go rather than land wrong.
      setFormAnswers((current) => withoutAnswers(current, (id) => id === messageId))
    } else {
      dropped.delete(index)
    }

    setReview({ ...review, dropped })
    setErrorMessage(null)

    if (dropped.size === 0) {
      stageProposal(review.original, messageId)
      return
    }

    const droppedBy = readDroppedBy(review.original.operations, dropped)
    const kept = review.original.wireOperations.filter((_, at: number): boolean => droppedBy[at] === null)

    // Nothing left to apply: show the page as it is, with no server call.
    if (kept.length === 0) {
      stageProposal(
        { ...review.original, candidateDraft: toTemplateFlowDraft(draftRef.current), changedBlockIds: [], operations: [], qualityIssues: [], wireOperations: [] },
        messageId
      )
      return
    }

    setIsRebuilding(true)
    // Until the rebuilt batch arrives the editor holds nothing to apply, so
    // its own Apply cannot take the dropped changes; the page keeps its preview.
    const held = pendingProposal ?? review.original
    stageProposal({ ...held, operations: [], wireOperations: [] }, messageId)

    try {
      const response = await fetch(`${endpoint}/rebuild`, {
        body: JSON.stringify({
          templateId,
          draft: toTemplateFlowDraft(draftRef.current),
          baseDraftFingerprint: review.original.baseDraftFingerprint,
          operations: kept
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      })
      const payload = await readJsonResponse(response)
      const rebuilt = response.ok && isRecord(payload) ? parseFlowProposal(payload.proposal) : null

      if (rebuilt === null) {
        throw new Error(response.ok ? "Flow returned an invalid response." : readApiError(payload))
      }

      // Rejected while it rebuilt: it stays rejected.
      if (heldRef.current !== null) {
        stageProposal(rebuilt, messageId)
      }
    } catch (error: unknown) {
      if (heldRef.current === null) {
        return
      }

      setReview(review)
      stageProposal(held, messageId)
      setErrorMessage(error instanceof Error ? error.message : "Unable to reach Flow.")
    } finally {
      setIsRebuilding(false)
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

      setErrorMessage(
        "This proposal is stale because the draft changed. Reject it and ask Flow again."
      )
      onProposalStale?.(staleProposal)
      return
    }

    onApplyProposal(pendingProposal, messageId)
    setPendingMessageId(null)
    setErrorMessage(null)
  }

  function rejectPendingProposal(): void {
    if (pendingProposal === null) {
      return
    }

    onRejectProposal?.(displayedPendingProposal ?? pendingProposal)
    setPendingMessageId(null)
    setErrorMessage(null)
  }

  // Fills with what the form said, once the fields it goes in are saved.
  async function fillAnswers(sourceId: string, answers: Record<string, unknown>): Promise<void> {
    if (!fill) {
      return
    }

    setFilling(true)

    const refusal = (await onSaveFirst?.()) ?? null
    const result = refusal === null ? await fill.action(answers).catch(() => null) : { message: refusal, ok: false as const }

    if (!result?.ok) {
      bizflowToast.error(result?.message ?? "The answers couldn't be filled in. Try again.")
      setFilling(false)
      return
    }

    // Said before a filled copy opens; the toast outlasts the move.
    bizflowToast[result.kept > 0 ? "success" : "info"](describeFill(result.kept, result.dropped))

    // Filled in, or nothing fit: the form is done with, so later turns no longer carry it.
    setFormAnswers((current) => withoutAnswers(current, (_, entry) => entry.sourceId === sourceId))

    if (attachment.source?.id === sourceId) {
      attachment.clear()
    }

    if (result.href) {
      if (fill.open) {
        fill.open(result.href)
      } else {
        window.location.assign(result.href)
      }

      return
    }

    setFilling(false)
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
    <aside aria-label="Flow document assistant" className="flex min-h-0 flex-1 flex-col">

      <div
        aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        ref={timelineRef}
      >
        {messages.length === 0 ? (
          <FlowEmptyState onSelectPrompt={submitMessage} starter={starter} />
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((message: TemplateFlowMessage, index: number) => {
              const previous = messages[index - 1]
              const applied = message.role === "assistant" && message.id === lastAppliedMessageId
              const answers = applied && fill && fillSourceId && Object.keys(combinedAnswers).length > 0 ? combinedAnswers : undefined

              return (
              <FlowMessageEntry
                canUndo={canUndo && applied}
                fillHere={fill?.here === true}
                filling={filling}
                key={message.id}
                message={message}
                onFill={answers && fillSourceId ? (): void => void fillAnswers(fillSourceId, answers) : undefined}
                onUndo={(): void => {
                  // What an undone proposal read off its form no longer has fields to go in.
                  setFormAnswers((current) => withoutAnswers(current, (id) => id === lastAppliedMessageId))
                  onUndo()
                }}
                // The open card lists these changes and tracks drops; one list, not two.
                showChanges={displayedPendingProposal === null || message.id !== pendingMessageId}
                startsRun={
                  previous?.role !== message.role ||
                  (previous.authorUserId ?? previous.authorName) !== (message.authorUserId ?? message.authorName) ||
                  Date.parse(message.createdAt) - Date.parse(previous.createdAt) > RUN_BREAK_MS
                }
              />
              )
            })}
          </ol>
        )}

        {displayedPendingProposal !== null && (
          <FlowPendingProposalReceipt
            canApply={displayedPendingProposal.status === "pending" && !isRebuilding}
            isRebuilding={isRebuilding}
            onApply={applyPendingProposal}
            onReject={rejectPendingProposal}
            onReview={(index: number, drop: boolean): void => {
              void reviewChange(index, drop)
            }}
            proposal={displayedPendingProposal}
            review={review ?? { original: displayedPendingProposal, dropped: new Set() }}
          />
        )}

        {isLoading && (
          <ul className="mt-3 flex flex-col">
            <FlowWorking readingForm={readingForm} stages={stages} />
          </ul>
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

      <form className="px-3 pt-1 pb-3" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="flow-composer">
          Ask Flow
        </label>
        {organizationId ? <FlowMentionChips mentions={mentions} /> : null}
        {organizationId ? <FlowAttachChip attachment={attachment} /> : null}
        <div className="relative">
          {/* One line tall, growing with the message to about six. */}
          <textarea
            aria-describedby={pendingProposal ? "flow-composer-hint" : undefined}
            className={cn(FLOW_COMPOSER, organizationId && FLOW_COMPOSER_ATTACH, "disabled:opacity-60")}
            disabled={isLoading || pendingProposal !== null}
            id="flow-composer"
            maxLength={2_000}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
              setInstruction(event.target.value)
            }
            onKeyDown={handleComposerKeyDown}
            onPaste={organizationId ? mentions.onPaste : undefined}
            placeholder={starter.placeholder}
            value={instruction}
          />
          {organizationId ? (
            <FlowAddButton attachment={attachment} disabled={isLoading || pendingProposal !== null} mentions={mentions} />
          ) : null}
          <button
            aria-label="Send message to Flow"
            className={FLOW_SEND}
            disabled={
              isLoading ||
              pendingProposal !== null ||
              attachment.uploading ||
              (instruction.trim().length < 2 && !attachment.source)
            }
            type="submit"
          >
            <ArrowUp aria-hidden="true" className="size-5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <FlowModelPicker disabled={isLoading} model={flowModel.model} onChange={flowModel.pick} />
          {pendingProposal ? (
            <p className="text-[10px] text-muted-foreground" id="flow-composer-hint">
              Apply or reject the proposal first
            </p>
          ) : null}
        </div>
      </form>
    </aside>
  )
}

/** The answers one proposal read off a form, whether it was applied, and the form. */
type FormAnswers = Readonly<{ answers: Record<string, unknown>; applied: boolean; sourceId: string }>

function withoutAnswers(
  current: ReadonlyMap<string, FormAnswers>,
  drop: (messageId: string, entry: FormAnswers) => boolean
): ReadonlyMap<string, FormAnswers> {
  return new Map([...current].filter(([messageId, entry]) => !drop(messageId, entry)))
}

/**
 * What filling with a form's answers did, in a line.
 *
 * @param kept - Answers filled in.
 * @param dropped - Answers no field took.
 * @returns The line.
 */
export function describeFill(kept: number, dropped: number): string {
  if (kept === 0) {
    return "No answers fit the form."
  }

  const filled = `Filled ${kept} ${kept === 1 ? "answer" : "answers"}.`

  return dropped > 0 ? `${filled} ${dropped} didn't fit the form.` : filled
}

function FlowPendingProposalReceipt({
  canApply,
  isRebuilding,
  onApply,
  onReject,
  onReview,
  proposal,
  review
}: {
  canApply: boolean
  isRebuilding: boolean
  onApply: () => void
  onReject: () => void
  onReview: (index: number, drop: boolean) => void
  proposal: TemplateFlowProposal
  review: FlowReview
}): ReactElement {
  const isStale = proposal.status === "stale"
  const items = review.original.operations
  const droppedBy = readDroppedBy(items, review.dropped)
  const keptCount = droppedBy.filter((by: number | null): boolean => by === null).length

  return (
    <section
      aria-label="Pending Flow proposal"
      className="mt-5 overflow-hidden rounded-md border border-primary/20 bg-card shadow-sm"
    >
      <div className="flex items-start justify-between gap-3 border-b border-primary/10 px-3 py-2.5">
        <div>
          <span className="editorial-kicker text-primary">
            {isStale ? "Stale proposal" : "Pending proposal"}
          </span>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {isStale
              ? "The base draft changed. This batch can no longer be applied."
              : keptCount < items.length
                ? `${keptCount} of ${items.length} changes will apply.`
                : `${items.length} ${
                    items.length === 1 ? "change" : "changes"
                  } proposed as one reviewable batch.`}
          </p>
        </div>
        {isStale && (
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        )}
      </div>

      <ul className="border-b border-primary/10">
        {items.map((item: TemplateFlowLedgerItem, index: number) => {
          const by = droppedBy[index] ?? null
          const removes =
            item.type === "remove_block" ||
            review.original.wireOperations[index]?.payload.removeLogo === true

          return (
            <li
              className={cn(
                "flex items-center gap-2 border-b border-primary/8 py-1 pr-1.5 pl-3 last:border-b-0",
                by !== null && by !== index && "pl-7"
              )}
              key={item.id}
            >
              {renderOperationIcon(removes ? "remove_block" : item.type, removes ? "text-destructive" : undefined)}
              <div className="min-w-0 flex-1 py-1">
                <p
                  className={cn(
                    "text-xs",
                    removes && "text-destructive",
                    by !== null && "text-muted-foreground line-through"
                  )}
                >
                  {item.summary}
                </p>
                {by !== null && by !== index && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {`Dropped with "${items[by]?.summary ?? ""}", since it needs that change.`}
                  </p>
                )}
              </div>
              {isStale || (by !== null && by !== index) ? null : by === index ? (
                <button
                  className="h-7 shrink-0 rounded-full px-2.5 text-xs font-medium text-primary outline-none transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-35 max-md:h-11"
                  disabled={isRebuilding}
                  onClick={(): void => onReview(index, false)}
                  type="button"
                >
                  Keep
                </button>
              ) : (
                <button
                  aria-label="Drop this change"
                  className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-35 max-md:size-11"
                  disabled={isRebuilding}
                  onClick={(): void => onReview(index, true)}
                  type="button"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {proposal.qualityIssues.length > 0 && (
        <div className="border-b border-primary/10 px-3 py-2.5">
          <p className="text-[11px] font-medium">Checks</p>
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
        <Button disabled={!canApply || keptCount === 0} onClick={onApply} size="sm" type="button">
          <Check />
          Apply {keptCount} {keptCount === 1 ? "change" : "changes"}
        </Button>
      </div>
    </section>
  )
}

function FlowEmptyState({
  onSelectPrompt,
  starter
}: {
  onSelectPrompt: (prompt: string) => Promise<void>
  starter: FlowStarter
}): ReactElement {
  return (
    <div className="flex min-h-full flex-col justify-center py-6">
      <h3 className="max-w-xs font-editorial text-2xl font-semibold leading-tight">
        {starter.heading}
      </h3>
      <div className="mt-5 flex flex-col gap-2">
        {starter.prompts.map((prompt: string) => (
          <button
            className="group flex items-center justify-between gap-3 rounded-md border border-primary/10 bg-card/65 px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/25 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
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
  fillHere,
  filling,
  message,
  onFill,
  onUndo,
  showChanges,
  startsRun
}: {
  canUndo: boolean
  /** Whether the answers go into this page rather than a copy. */
  fillHere: boolean
  filling: boolean
  message: TemplateFlowMessage
  /** Offered once a proposal with answers read off its form is applied. */
  onFill?: () => void
  onUndo: () => void
  showChanges: boolean
  /** Whether this opens a run of one author's messages, which names them once. */
  startsRun: boolean
}): ReactElement {
  const time = <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>

  if (message.role === "user") {
    const name = message.authorName || "Team member"

    return (
      <FlowMessage
        author={
          startsRun ? (
            <>
              {name}
              {time}
            </>
          ) : undefined
        }
        from="member"
        speaker={name}
      >
        {message.content}
      </FlowMessage>
    )
  }

  return (
    <FlowMessage author={startsRun ? time : undefined} from="flow">
      <p className="whitespace-pre-wrap">{message.content}</p>

      {showChanges && message.operations.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-md border border-primary/12 bg-card/70">
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
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-primary/10 px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <PencilLine className="size-3.5 text-primary" />
              {message.operations.length}{" "}
              {message.operations.length === 1 ? "change" : "changes"} proposed
            </span>
            <span className="ml-auto flex items-center gap-1">
              {onFill && (
                <Button className="max-md:h-9" disabled={filling} onClick={onFill} size="xs" type="button" variant="ghost">
                  {filling ? <LoaderCircle className="animate-spin" /> : fillHere ? <PencilLine /> : <FilePlus2 />}
                  {fillHere ? "Fill in answers" : "Create filled copy"}
                </Button>
              )}
              {canUndo && (
                <Button className="max-md:h-9" onClick={onUndo} size="xs" type="button" variant="ghost">
                  <RotateCcw />
                  Undo
                </Button>
              )}
            </span>
          </div>
        </div>
      )}
    </FlowMessage>
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
          <span className="text-[11px] text-primary">
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

// One for every kind of change, so a new kind cannot go without.
const OPERATION_ICONS: Record<TemplateFlowOperationType, LucideIcon> = {
  set_title: PencilLine,
  set_description: PencilLine,
  set_branding: PencilLine,
  add_block: ArrowDownToLine,
  update_block: PencilLine,
  update_image: PencilLine,
  move_block: Move,
  remove_block: Trash2,
  set_section: Section,
  set_row: Columns2,
  stand_alone: Rows2,
  set_block_rule: LayoutTemplate,
  set_layout: LayoutTemplate
}

function renderOperationIcon(type: TemplateFlowOperationType, className = "text-primary"): ReactElement {
  const Icon = OPERATION_ICONS[type]

  return <Icon aria-hidden="true" className={cn("mt-0.5 size-3.5 shrink-0", className)} />
}

/**
 * Which hand-dropped change each change goes with: itself when dropped by
 * hand, the dropped change it needs, or null when it is kept. Changes only
 * need earlier ones, so one pass in order settles it.
 */
function readDroppedBy(items: readonly TemplateFlowLedgerItem[], dropped: ReadonlySet<number>): Array<number | null> {
  const droppedBy: Array<number | null> = []

  items.forEach((item: TemplateFlowLedgerItem, index: number): void => {
    const need = item.dependsOn.find((at: number): boolean => at < index && droppedBy[at] !== null)

    droppedBy.push(dropped.has(index) ? index : need === undefined ? null : (droppedBy[need] ?? null))
  })

  return droppedBy
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
    remove_block: "Remove",
    set_section: "Section",
    set_row: "Row",
    stand_alone: "Separate",
    set_block_rule: "Lay out",
    set_layout: "Page setup"
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

const strings = z.array(z.unknown()).transform((values) => values.filter((value): value is string => typeof value === "string"))

const ledgerItemSchema = z.object({
  id: z.string(),
  // The one list of what Flow can do: a type left off a second list here
  // would drop the whole proposal it arrived in.
  type: z.enum(TEMPLATE_FLOW_OPERATION_TYPES),
  summary: z.string(),
  target: z.string(),
  affectedBlockIds: strings,
  dependsOn: z.array(z.unknown()).catch([]).transform((values) => values.filter((value): value is number => Number.isInteger(value)))
})

const flowProposalSchema = z
  .object({
    id: z.string(),
    status: z.enum(["pending", "stale"]),
    baseDraftFingerprint: z.string(),
    candidateDraft: z.object({ title: z.string(), description: z.string(), content: templateContentSchema }),
    operations: z.array(ledgerItemSchema),
    // Read only by the server, which checks them again before using them.
    wireOperations: z.array(z.custom<TemplateFlowWireOperation>(isRecord)),
    changedBlockIds: z.array(z.string()),
    // Answers read off an attached form; the server checks them again before filling them in.
    sourceAnswers: z.record(z.string(), z.unknown()).optional(),
    qualityIssues: z.array(
      z.object({ code: z.string(), severity: z.enum(["critical", "warning"]), message: z.string(), affectedBlockIds: z.array(z.string()) })
    )
  })
  .refine((proposal) => proposal.wireOperations.length === proposal.operations.length)

const flowMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  // A server from before author ids were sent leaves it out.
  authorUserId: z.string().nullable().catch(null),
  authorName: z.string().nullable(),
  operations: z.array(ledgerItemSchema),
  changedBlockIds: strings,
  receiptStatus: z.literal("proposed").nullable(),
  createdAt: z.string()
})

const flowResultSchema = z.object({
  proposal: flowProposalSchema.nullable(),
  messages: z.tuple([flowMessageSchema, flowMessageSchema]),
  needsConfirmation: z.boolean(),
  persistenceWarning: z.string().nullable().catch(null)
})

export function parseFlowResult(payload: unknown): TemplateFlowResult {
  const result = flowResultSchema.safeParse(payload)

  if (!result.success) {
    throw new Error("Flow returned an invalid response.")
  }

  return result.data
}

export function parseFlowProposal(value: unknown): TemplateFlowProposal | null {
  return flowProposalSchema.safeParse(value).data ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
