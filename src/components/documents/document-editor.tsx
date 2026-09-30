"use client"

import { Download, Files, History, MessageSquare, MoreHorizontal, Palette, Send, UserPlus } from "lucide-react"
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react"

import type { DocumentContentInput } from "@/app/(editor)/documents/[documentId]/edit/actions"
import { DocumentRecipientCollection } from "@/components/documents/document-recipient-collection"
import { useFlowHandoff } from "@/components/flow/flow-handoff"
import { EditorCanvas } from "@/components/editor/editor-canvas"
import { normalizeContentForSave } from "@/components/editor/editor-content"
import { type DockTool, EditorDock } from "@/components/editor/editor-dock"
import { FormatBar } from "@/components/editor/format-bar"
import { FlowWindow } from "@/components/flow/flow-window"
import { EditorFrame, type EditorLayoutStore, EditorNotice, EditorSidePanel } from "@/components/editor/editor-frame"
import { type SaveResult, useAutosave } from "@/components/editor/use-autosave"
import { useEditorController } from "@/components/editor/use-editor-controller"
import {
  preloadPanels,
  RoomCheckpoints,
  RoomComments,
  RoomLayer,
  RoomPeople,
  TemplateBlockEditor,
  TemplateFlowPanel,
  PageSetupPanel,
  TemplateBrandingPanel,
  ShareDialog,
} from "@/components/editor/lazy-panels"
import { useLiveRoom } from "@/components/editor/use-live-room"
import { useRoomPlace } from "@/components/editor/use-room-place"
import { useLocalRecovery } from "@/components/editor/use-local-recovery"
import { useMissingPictureAddresses, usePictureAddresses } from "@/components/editor/use-picture-addresses"
import { useWorkingCopyHistory } from "@/components/editor/use-working-copy-history"
import type { FlowStarter } from "@/components/templates/template-flow-panel"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { bizflowToast } from "@/components/ui/toaster"
import type { WorkingCopy } from "@/lib/collaboration/working-copy-doc"
import { formatMediumDateTime } from "@/lib/date-format"
import { SigningRecipientStatusBadge } from "@/lib/page-status-badges"
import { cn } from "@/lib/utils"
import { createTemplateFlowDraftFingerprint } from "@/services/template-flow-proposal-state"
import { resolvePageGeometry } from "@/services/templates/template-render-plan"
import type { DocumentSigningRecipient, GeneratedDocumentSigningView } from "@/types/signing"
import { type TemplateContentV3, upgradeV2TemplateContentToV3 } from "@/types/template"
import type { TemplateFlowProposal } from "@/types/template-flow"
import { applyVisibleTemplateFieldValue } from "@/types/template-visibility"

type DocumentPage = { content: TemplateContentV3; title: string }

const DRAFT_STARTER: FlowStarter = {
  heading: "Ask Flow to change this document.",
  placeholder: "Ask Flow to change something…",
  prompts: ["Tighten the wording", "Add a place to sign at the end", "What's missing before I send it?"],
}

// Once sent, the words are fixed, so Flow explains rather than offers edits.
const SENT_STARTER: FlowStarter = {
  heading: "Ask Flow about this document.",
  placeholder: "Ask Flow about this document…",
  prompts: ["Summarise this document", "Explain it in plain words", "What does a signer agree to?"],
}

type DocumentEditorProps = {
  backHref: string
  canFill: boolean
  canSend: boolean
  /** Whether the member may choose who else can open this document. */
  canShare: boolean
  /** Where this person keeps the dock and zoom. */
  editorLayout?: EditorLayoutStore
  /** Who is writing, as the others in the room see them. */
  me: Readonly<{ id: string; name: string }>
  resendAction: (formData: FormData) => Promise<void>
  saveAnswersAction: (formData: FormData) => Promise<SaveResult>
  saveContentAction: (input: DocumentContentInput) => Promise<SaveResult>
  sendAction: (formData: FormData) => Promise<void>
  view: GeneratedDocumentSigningView
}

/**
 * A document in the editor canvas. While it is a draft its pages can be
 * written on and its fields filled in, and both save as they change. Once
 * sent, the words are fixed and signers' progress shows at the top.
 *
 * @param props - The document, what the member may do, and the server actions.
 * @returns The full-screen document editor.
 */
export function DocumentEditor({
  backHref,
  canFill,
  canSend,
  canShare,
  editorLayout,
  me,
  resendAction,
  saveAnswersAction,
  saveContentAction,
  sendAction,
  view,
}: DocumentEditorProps): ReactElement {
  const document = view.document
  const completed = view.workflowStatus === "completed"
  const writable = canFill && view.workflowStatus === "draft" && view.recipients.length === 0
  // Answers stand as they were signed: once anyone has signed, only the
  // remaining signers can still fill what is theirs.
  const signedCount = view.recipients.filter((recipient) => recipient.status === "signed").length
  const fillable = canFill && !completed && signedCount === 0
  const initial = useMemo(
    (): DocumentPage => ({ content: upgradeV2TemplateContentToV3(document.templateSnapshot), title: document.title }),
    [document]
  )
  // A draft's pages are written together; its answers save on their own, field by field.
  const pictures = usePictureAddresses(initial.content)
  const livePath = `/api/documents/${document.id}/room`
  const fromCopy = (copy: WorkingCopy): DocumentPage => ({ content: pictures.attach(copy.content), title: copy.title })
  const live = useLiveRoom<DocumentPage>({
    enabled: writable,
    fromCopy,
    me,
    onRefused: (message) => bizflowToast.error(message),
    path: livePath,
    toCopy: (next) => {
      pictures.remember(next.content)
      return { content: next.content, title: next.title }
    },
  })
  const history = useWorkingCopyHistory(initial, live.session)
  const room = live.session && live.roomId ? { path: livePath, roomId: live.roomId, seen: live.notesSeen } : null
  const liveMode = history.liveStatus !== null
  const editable = writable && history.liveStatus !== "stopped"
  const page = history.state
  const [answers, setAnswers] = useState<Record<string, unknown>>(view.answers)
  const [drawings, setDrawings] = useState(0)
  const [sending, setSending] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [savedPage, setSavedPage] = useState(initial)
  const [savedAnswers, setSavedAnswers] = useState<Record<string, unknown>>(view.answers)
  const [proposal, setProposal] = useState<TemplateFlowProposal | null>(null)
  const [flowUndo, setFlowUndo] = useState<{ messageId: string; page: DocumentPage } | null>(null)
  const [flowOpen, setFlowOpen] = useState(false)
  const [carried, setCarried] = useState<string | null>(null)

  // A request made from a workspace page opens Flow here and carries on.
  useFlowHandoff((request) => {
    setFlowOpen(true)
    setCarried(request)
  })
  const formRef = useRef<HTMLFormElement>(null)
  const flowDraft = useMemo(() => ({ content: page.content, description: "", title: page.title }), [page])
  const suggested = useMemo(
    () => (proposal ? upgradeV2TemplateContentToV3(proposal.candidateDraft.content) : page.content),
    [page.content, proposal]
  )
  const preview = useEditorController({ change: () => undefined, content: suggested, undo: () => undefined })
  const controller = useEditorController({
    change: (update, coalesceKey) =>
      history.set((current) => ({ ...current, content: update(current.content) }), coalesceKey),
    content: page.content,
    undo: history.undo,
  })
  const content = useAutosave<DocumentPage>({
    // Saving on its own is for when the room can't be reached.
    enabled: writable && !live.session && live.unavailable,
    initialVersion: document.updatedAt,
    save: async (value, version) => {
      const result = await saveContentAction({
        content: normalizeContentForSave(value.content),
        documentId: document.id,
        expectedUpdatedAt: version,
        title: value.title,
      })

      if (result.ok) {
        setSavedPage(value)
      }

      return result
    },
    value: page,
  })
  const answered = useAutosave<{ answers: Record<string, unknown>; drawings: number }>({
    enabled: fillable,
    initialVersion: "answers",
    save: async (value) => {
      // New fields reach the server before their answers do.
      await (live.session ? live.session.flush() : content.flush())

      const formData = new FormData(formRef.current ?? undefined)
      formData.set("documentId", document.id)

      const result = await saveAnswersAction(formData)

      if (result.ok) {
        setSavedAnswers(value.answers)
      }

      return result
    },
    value: { answers, drawings },
  })
  // The copy kept on this device holds the answers as well as the page, so a
  // closed tab never loses what someone typed into the fields. Drawings live
  // in the page itself and are drawn again.
  const recovery = useLocalRecovery({
    key: `document:${document.id}`,
    // Live, what the room has kept is saved; anything waiting stays on this device too.
    saved: { answers: savedAnswers, page: !liveMode ? savedPage : history.liveStatus === "saved" ? page : initial },
    value: { answers, page },
  })
  const settingsBlock = page.content.blocks.find((block) => block.id === controller.settingsBlockId) ?? null
  const settingsIndex = settingsBlock ? page.content.blocks.indexOf(settingsBlock) : -1
  const geometry = resolvePageGeometry(page.content.layout)
  const saveStatus = [history.liveStatus ?? content.status, answered.status].find((status) => status !== "saved") ?? "saved"

  useEffect(preloadPanels, [])

  // Where this person is, for the others in the room.
  useRoomPlace(controller, live.setPlace)

  // Pictures someone else added arrive without an address this page can load.
  useMissingPictureAddresses({ content: page.content, path: livePath, pictures, roomId: live.roomId, session: live.session })
  const pdfHref = `/api/documents/${encodeURIComponent(document.id)}/pdf`

  const tools: DockTool[] = [
    {
      content: () => <PageSetupPanel layout={page.content.layout} onChange={controller.setLayout} />,
      icon: Files,
      id: "pages",
      label: "Pages",
    },
    {
      content: () => (
        <TemplateBrandingPanel
          branding={page.content.branding}
          onChange={(branding) => controller.change((current) => ({ ...current, branding }), "branding")}
        />
      ),
      icon: Palette,
      id: "brand",
      label: "Brand",
    },
    ...(room
      ? [
          {
            content: (close: () => void) => (
              <RoomComments
                blocks={page.content.blocks}
                onShow={(blockId: string) => {
                  controller.select(blockId)
                  close()
                }}
                others={live.others}
                room={room}
                target={controller.selectedBlockId ?? controller.activeBlockId}
              />
            ),
            icon: MessageSquare,
            id: "comments",
            label: "Comments",
            wide: true,
          },
          {
            content: () => (
              <RoomCheckpoints onRestore={(copy: WorkingCopy) => history.set(() => fromCopy(copy))} onSave={live.checkpoint} room={room} />
            ),
            icon: History,
            id: "versions",
            label: "Versions",
          },
        ]
      : []),
  ]

  function applyProposal(next: TemplateFlowProposal, messageId: string): void {
    if (next.status !== "pending" || next.baseDraftFingerprint !== createTemplateFlowDraftFingerprint(flowDraft)) {
      setProposal({ ...next, status: "stale" })
      return
    }

    setFlowUndo({ messageId, page })
    history.set(() => ({
      content: upgradeV2TemplateContentToV3(next.candidateDraft.content),
      title: next.candidateDraft.title,
    }))
    setProposal(null)
  }

  async function openSend(): Promise<void> {
    // Signers must receive what the sender sees, so a save that did not land
    // stops the send rather than sending the stored copy.
    const pageSaved = await (live.session ? live.session.flush() : content.flush())
    const answersSaved = await answered.flush()

    if (!pageSaved || !answersSaved) {
      bizflowToast.error("Couldn't save, so nothing was sent.")
      return
    }

    setSending(true)
  }

  return (
    <>
      <EditorFrame
        backHref={backHref}
        backLabel="Back to Files"
        banner={
          recovery.recovery && (writable || fillable) ? (
            <EditorNotice
              actions={[
                {
                  label: "Restore",
                  onClick: () => {
                    const data = recovery.restore()

                    if (data) {
                      history.set(() => data.page)
                      setAnswers(data.answers)
                    }
                  },
                },
                { label: "Discard", onClick: recovery.discard },
              ]}
            >
              Unsaved changes from{" "}
              {new Date(recovery.recovery.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </EditorNotice>
          ) : proposal ? (
            <EditorNotice
              actions={
                proposal.status === "pending" && writable
                  ? [
                      { label: "Apply", onClick: () => applyProposal(proposal, proposal.id) },
                      { label: "Reject", onClick: () => setProposal(null) },
                    ]
                  : [{ label: "Dismiss", onClick: () => setProposal(null) }]
              }
            >
              {proposal.status === "stale"
                ? "Flow's suggestion is out of date"
                : writable
                  ? "Flow's suggestion"
                  : "Flow's suggestion · this document can no longer change"}
            </EditorNotice>
          ) : null
        }
        canRedo={history.canRedo}
        canUndo={history.canUndo}
        dock={(narrow, orientation) =>
          // Flow has a button of its own, always there.
          writable && !proposal ? (
            <EditorDock
              lead={narrow ? <FormatBar allowFiles={false} controller={controller} narrow /> : undefined}
              narrow={narrow}
              orientation={orientation}
              tools={tools}
            />
          ) : null
        }
        layout={editorLayout}
        extra={
          view.recipients.length > 0 ? (
            <Popover>
              <PopoverTrigger
                className="h-9 shrink-0 rounded-full border border-border px-3 text-[13px] whitespace-nowrap outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
                data-slot="signing-progress"
              >
                {signedCount} of {view.recipients.length} signed
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))]">
                <ul className="grid gap-2">
                  {view.recipients.map((recipient: DocumentSigningRecipient) => (
                    <li className="grid gap-1.5 rounded-[12px] bg-muted/50 p-2.5" key={recipient.id}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{recipient.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{recipient.email}</p>
                        </div>
                        <SigningRecipientStatusBadge status={recipient.status} />
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        {recipient.signedAt
                          ? `Signed ${formatMediumDateTime(recipient.signedAt)}`
                          : `Link expires ${formatMediumDateTime(recipient.tokenExpiresAt)}`}
                        {canSend && recipient.status !== "signed" && !completed ? (
                          <form action={resendAction}>
                            <input name="documentId" type="hidden" value={document.id} />
                            <input name="recipientId" type="hidden" value={recipient.id} />
                            <Button className="h-8 px-2 text-xs md:h-8" size="sm" type="submit" variant="ghost">
                              Resend
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          ) : null
        }
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button aria-label="More" className="size-10" size="icon" title="More" type="button" variant="ghost">
                  <MoreHorizontal />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem render={<a href={pdfHref} rel="noreferrer" target="_blank" />}>
                <Download />
                Download PDF
              </DropdownMenuItem>
              {canShare ? (
                <DropdownMenuItem onClick={() => setSharing(true)}>
                  <UserPlus />
                  Share…
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        }
        onRedo={history.redo}
        onRetrySave={() => {
          void (live.session ? live.session.flush() : content.flush())
          void answered.flush()
        }}
        onSave={live.session ? () => void live.checkpoint("Checkpoint") : undefined}
        onTitleChange={(title) => history.set((current) => ({ ...current, title }), "title")}
        onUndo={history.undo}
        pageWidthPoints={geometry.widthPoints * geometry.scale}
        people={(narrow) => (room ? <RoomPeople me={me} narrow={narrow} others={live.others} room={room} /> : null)}
        panel={(narrow) => (
          <>
            <EditorSidePanel
              narrow={narrow}
              onClose={controller.closeSettings}
              open={settingsBlock?.type === "image"}
              title="Settings"
            >
              {settingsBlock ? (
                <TemplateBlockEditor
                  block={settingsBlock}
                  blocks={page.content.blocks}
                  canMoveDown={settingsIndex < page.content.blocks.length - 1}
                  canMoveUp={settingsIndex > 0}
                  onChange={(block) => controller.updateBlock(block, `settings:${block.id}`)}
                  onDelete={() => controller.remove(settingsBlock.id)}
                  onDuplicate={() => controller.duplicate(settingsBlock.id)}
                  onMoveDown={() => controller.move(settingsBlock.id, "down")}
                  onMoveUp={() => controller.move(settingsBlock.id, "up")}
                  pictureSource={{ documentId: document.id }}
                />
              ) : null}
            </EditorSidePanel>
            {/* On a phone Flow's button rests above the tools' row. */}
            <FlowWindow onOpenChange={setFlowOpen} open={flowOpen} phoneBottom={writable && !proposal ? 84 : 16}>
              <TemplateFlowPanel
                canUndo={flowUndo !== null}
                draft={flowDraft}
                endpoint={`/api/documents/${encodeURIComponent(document.id)}/flow`}
                initialMessages={[]}
                lastAppliedMessageId={flowUndo?.messageId ?? null}
                onApplyProposal={applyProposal}
                onProposalReceived={(next) => {
                  setProposal(next)
                  controller.select(null)
                }}
                onProposalStale={setProposal}
                onRejectProposal={() => setProposal(null)}
                onUndo={() => {
                  if (flowUndo) {
                    history.set(() => flowUndo.page)
                    setFlowUndo(null)
                  }
                }}
                autoSend={carried}
                pendingProposal={proposal}
                starter={writable ? DRAFT_STARTER : SENT_STARTER}
              />
            </FlowWindow>
          </>
        )}
        primary={
          completed ? (
            <a className={cn(buttonVariants(), "h-10 px-4")} href={pdfHref} rel="noreferrer" target="_blank">
              <Download />
              Download
            </a>
          ) : canSend && view.recipients.length === 0 ? (
            <Button className="h-10 px-4" onClick={() => void openSend()} type="button">
              <Send />
              Send
            </Button>
          ) : null
        }
        saveStatus={writable || fillable ? saveStatus : null}
        title={page.title}
        titleEditable={editable && !proposal}
        toolbar={writable && !proposal ? <FormatBar allowFiles={false} controller={controller} narrow={false} /> : undefined}
      >
        {({ narrow, zoom }) => (
          <form
            // Only gathers the answers: the canvas inside sizes itself.
            className="contents"
            onPointerUp={() => setDrawings((count) => count + 1)}
            onSubmit={(event) => event.preventDefault()}
            ref={formRef}
          >
            <EditorCanvas
              allowFiles={false}
              answers={answers}
              controller={proposal ? preview : controller}
              designable={editable && !proposal}
              documentTitle={proposal ? proposal.candidateDraft.title : page.title}
              fields={fillable && !proposal ? "fill" : "read"}
              narrow={narrow}
              onAnswerChange={(fieldKey, value) =>
                setAnswers((current) => applyVisibleTemplateFieldValue(page.content, current, fieldKey, value))
              }
              overlay={room && !proposal ? <RoomLayer narrow={narrow} others={live.others} revision={page.content} room={room} /> : null}
              surface={proposal ? "paper" : "screen"}
              textEditable={editable && !proposal}
              zoom={zoom}
            />
          </form>
        )}
      </EditorFrame>
      <Dialog onOpenChange={setSending} open={sending}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Send for signing</DialogTitle>
          </DialogHeader>
          <DocumentRecipientCollection action={sendAction} documentId={document.id} />
        </DialogContent>
      </Dialog>
      {canShare && sharing ? (
        <ShareDialog name={document.title} onOpenChange={setSharing} open resources={[{ id: document.id, kind: "document" }]} />
      ) : null}
    </>
  )
}
