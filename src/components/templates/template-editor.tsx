"use client"

import { Archive, FilePenLine, Files, History, Link2, ListChecks, MessageSquare, MoreHorizontal, Palette, UserPlus } from "lucide-react"
import Link from "next/link"
import { type ReactElement, useEffect, useMemo, useRef, useState, useTransition } from "react"

import type { TemplateDraftInput, TemplateVersionResult } from "@/app/(dashboard)/templates/actions"
import { useFlowHandoff } from "@/components/flow/flow-handoff"
import { EditorCanvas } from "@/components/editor/editor-canvas"
import { normalizeContentForSave } from "@/components/editor/editor-content"
import { type DockTool, EditorDock } from "@/components/editor/editor-dock"
import { FormatBar } from "@/components/editor/format-bar"
import { FlowDockSlot, FlowWindow } from "@/components/flow/flow-window"
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
  TemplateChecksPanel,
  ShareDialog,
} from "@/components/editor/lazy-panels"
import { useLiveRoom } from "@/components/editor/use-live-room"
import { useRoomPlace } from "@/components/editor/use-room-place"
import { useLocalRecovery } from "@/components/editor/use-local-recovery"
import { useMissingPictureAddresses, usePictureAddresses } from "@/components/editor/use-picture-addresses"
import { useWorkingCopyHistory } from "@/components/editor/use-working-copy-history"
import type { TemplateEditorState } from "@/components/templates/template-editor-state"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { SuggestInput } from "@/components/ui/suggest-input"
import { bizflowToast } from "@/components/ui/toaster"
import type { WorkingCopy } from "@/lib/collaboration/working-copy-doc"
import { createTemplateFlowDraftFingerprint } from "@/services/template-flow-proposal-state"
import { resolvePageGeometry } from "@/services/templates/template-render-plan"
import {
  evaluateTemplateQuality,
  isTemplateQualityIssueSaveBlocking,
} from "@/services/templates/template-quality-service"
import {
  type DocumentTemplate,
  type DocumentTemplateVersion,
  type TemplateContentV3,
  upgradeV2TemplateContentToV3,
} from "@/types/template"
import type { TemplateFlowMessage, TemplateFlowProposal } from "@/types/template-flow"
import { withGeneratedFieldKeys } from "@/types/template-structure"
import { applyVisibleTemplateFieldValue } from "@/types/template-visibility"


type TemplateEditorProps = {
  archiveAction: (formData: FormData) => Promise<void>
  /** Categories already in use in this tenant, offered as suggestions. */
  categorySuggestions?: readonly string[]
  /** Where this person keeps the dock and zoom. */
  editorLayout?: EditorLayoutStore
  initialFlowMessages: TemplateFlowMessage[]
  loadVersionAction: (templateId: string, revision: number) => Promise<TemplateVersionResult>
  /** Who is editing, as the others in the room see them. */
  me: Readonly<{ id: string; name: string }>
  publishAction: (formData: FormData) => Promise<void>
  saveDraftAction: (input: TemplateDraftInput) => Promise<SaveResult>
  template: DocumentTemplate
  /** The versions it was published at, newest first. */
  versions?: readonly DocumentTemplateVersion[]
}

/**
 * The template studio in the editor canvas: pages to type on, the dock with
 * everything that can be added, Flow and Checks. The page is the printed
 * page, and its boxes take answers, so the author tries the form as it grows.
 * A draft saves as it changes. A published template's changes stay on this
 * device until Save, and reach staff on Update.
 *
 * @param props - The template, its Flow history, and the server actions.
 * @returns The full-screen template editor.
 */
export function TemplateEditor({
  archiveAction,
  categorySuggestions = [],
  editorLayout,
  initialFlowMessages,
  loadVersionAction,
  me,
  publishAction,
  saveDraftAction,
  template,
  versions = [],
}: TemplateEditorProps): ReactElement {
  const initial = useMemo(
    (): TemplateEditorState => ({
      category: template.category ?? "",
      // Field keys are ours to keep valid; a template never shows or asks for one.
      content: withGeneratedFieldKeys(upgradeV2TemplateContentToV3(template.content)),
      description: template.description ?? "",
      title: template.title,
    }),
    [template]
  )
  const pictures = usePictureAddresses(initial.content as TemplateContentV3)
  const livePath = `/api/templates/${template.id}/room`
  const fromCopy = (copy: WorkingCopy): TemplateEditorState => ({
    category: copy.category ?? "",
    content: pictures.attach(copy.content),
    description: copy.description ?? "",
    title: copy.title,
  })
  const live = useLiveRoom<TemplateEditorState>({
    enabled: template.status !== "archived",
    fromCopy,
    me,
    onRefused: (message) => bizflowToast.error(message),
    path: livePath,
    toCopy: (next) => {
      pictures.remember(next.content as TemplateContentV3)
      return { category: next.category, content: next.content as TemplateContentV3, description: next.description, title: next.title }
    },
  })
  const history = useWorkingCopyHistory(initial, live.session)
  const room = live.session && live.roomId ? { path: livePath, roomId: live.roomId, seen: live.notesSeen } : null
  const liveMode = history.liveStatus !== null
  const editable = history.liveStatus !== "stopped"
  const state = history.state
  const content = state.content as TemplateContentV3
  // What the author types into the boxes to try the form; never saved.
  const [testAnswers, setTestAnswers] = useState<Record<string, unknown>>({})
  const [proposal, setProposal] = useState<TemplateFlowProposal | null>(null)
  const [flowUndo, setFlowUndo] = useState<{ messageId: string; state: TemplateEditorState } | null>(null)
  const [flowOpen, setFlowOpen] = useState(false)
  const [carried, setCarried] = useState<string | null>(null)

  // A request made from a workspace page opens Flow here and carries on.
  useFlowHandoff((request) => {
    setFlowOpen(true)
    setCarried(request)
  })
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [savedState, setSavedState] = useState(initial)
  const [, startTransition] = useTransition()
  const revisionRef = useRef(template.revision)
  const isDraft = template.status === "draft"
  const quality = useMemo(
    () => evaluateTemplateQuality({ content, description: state.description, title: state.title }),
    [content, state.description, state.title]
  )
  const validationErrors = quality.issues.filter(isTemplateQualityIssueSaveBlocking).length
  const controller = useEditorController({
    change: (update, coalesceKey) =>
      history.set((current) => ({ ...current, content: update(current.content as TemplateContentV3) }), coalesceKey),
    content,
    undo: history.undo,
  })
  useEffect(preloadPanels, [])

  // Where this person is, for the others in the room.
  useRoomPlace(controller, live.setPlace)

  // Pictures someone else added arrive without an address this page can load.
  useMissingPictureAddresses({ content, path: livePath, pictures, roomId: live.roomId, session: live.session })

  const candidate = useMemo(
    () => (proposal ? upgradeV2TemplateContentToV3(proposal.candidateDraft.content) : content),
    [content, proposal]
  )
  const preview = useEditorController({ change: () => undefined, content: candidate, undo: () => undefined })
  const autosave = useAutosave<TemplateEditorState>({
    enabled: !live.session && live.unavailable && isDraft && validationErrors === 0,
    initialVersion: String(template.revision),
    save: async (value, version) => {
      const result = await saveDraftAction(toDraftInput(template.id, Number(version), value))

      if (result.ok) {
        revisionRef.current = Number(result.version)
        setSavedState(value)
      }

      return result
    },
    value: state,
  })
  const recovery = useLocalRecovery({
    key: `template:${template.id}`,
    // Live, what the room has kept is saved; anything waiting stays on this device too.
    saved: !liveMode ? savedState : history.liveStatus === "saved" ? state : initial,
    value: state,
  })
  const settingsBlock = content.blocks.find((block) => block.id === controller.settingsBlockId) ?? null
  const settingsIndex = settingsBlock ? content.blocks.indexOf(settingsBlock) : -1
  // Live, every change is kept as it is made, so there is nothing to save by hand.
  const unsaved = !liveMode && JSON.stringify(state) !== JSON.stringify(savedState)
  // On a published template the button saves first, then publishes.
  const needsSave = !isDraft && unsaved
  // Changes staff don't have yet: saved past what was published, or made since this opened.
  const unpublished = template.revision !== template.publishedRevision || stableJson(state) !== stableJson(initial)
  const geometry = resolvePageGeometry(content.layout)

  function submit(action: (formData: FormData) => Promise<void>): void {
    const input = toDraftInput(template.id, revisionRef.current, state)
    const formData = new FormData()

    formData.set("templateId", input.templateId)
    formData.set("expectedRevision", String(input.expectedRevision))
    formData.set("title", input.title)
    formData.set("description", input.description)
    formData.set("category", input.category)
    formData.set("content", JSON.stringify(input.content))
    startTransition(() => action(formData))
  }

  function blockedByChecks(verb: string): boolean {
    if (proposal) {
      bizflowToast.info("Apply or reject Flow's suggestion first.")
      return true
    }

    if (!quality.summary.isBlocking) {
      return false
    }

    const count = quality.summary.criticalCount
    bizflowToast.error(`Fix ${count} ${count === 1 ? "check" : "checks"} before you ${verb}.`)
    return true
  }

  async function publish(): Promise<void> {
    if (blockedByChecks(isDraft ? "publish" : "update")) {
      return
    }

    const session = live.session

    if (session && live.roomId) {
      // Everything made here is kept, and everything others made is here, before it goes out.
      if (!(await session.flush())) {
        bizflowToast.error("Your latest changes haven't been saved yet. Try again in a moment.")
        return
      }

      await session.catchUp()
      const formData = new FormData()
      formData.set("templateId", template.id)
      formData.set("roomId", live.roomId)
      formData.set("roomRevision", String(session.revision()))
      startTransition(() => publishAction(formData))
      return
    }

    // What isn't saved yet saves first, so Update publishes what is on screen.
    if (await autosave.flush()) {
      submit(publishAction)
    }
  }

  // A published template's changes save to its working copy only when asked.
  // Until then they stay on this device, and a lost connection retries. Live,
  // every change is kept as it is made, so saving keeps a checkpoint instead.
  async function save(): Promise<void> {
    if (live.session) {
      await live.checkpoint("Checkpoint")
      return
    }

    if (validationErrors > 0) {
      bizflowToast.error(`Fix ${validationErrors} ${validationErrors === 1 ? "check" : "checks"} before you save.`)
      return
    }

    await autosave.flush()
  }

  // An old version comes back as an edit: Undo takes it back, Save keeps it,
  // and staff get it only on Update.
  async function restore(revision: number): Promise<boolean> {
    if (proposal) {
      bizflowToast.info("Apply or reject Flow's suggestion first.")
      return false
    }

    const result = await loadVersionAction(template.id, revision)

    if (!result.ok) {
      bizflowToast.error(result.message)
      return false
    }

    history.set((current) => ({
      ...current,
      content: withGeneratedFieldKeys(upgradeV2TemplateContentToV3(result.version.content)),
      description: result.version.description ?? "",
      title: result.version.title,
    }))
    return true
  }

  function stageProposal(next: TemplateFlowProposal): void {
    setProposal(next)
    controller.select(null)
  }

  function applyProposal(next: TemplateFlowProposal, messageId: string): void {
    if (next.status !== "pending" || next.baseDraftFingerprint !== createTemplateFlowDraftFingerprint(state)) {
      setProposal({ ...next, status: "stale" })
      return
    }

    setFlowUndo({ messageId, state })
    // Flow rewrites the title, description and content; the category is the
    // author's filing decision and stays.
    history.set((current) => ({
      ...next.candidateDraft,
      category: current.category,
      content: upgradeV2TemplateContentToV3(next.candidateDraft.content),
    }))
    setProposal(null)
  }

  const tools: DockTool[] = [
    {
      content: () => <PageSetupPanel layout={content.layout} onChange={controller.setLayout} />,
      icon: Files,
      id: "pages",
      label: "Pages",
    },
    {
      content: () => (
        <TemplateBrandingPanel
          branding={content.branding}
          onChange={(branding) => controller.change((current) => ({ ...current, branding }), "branding")}
        />
      ),
      icon: Palette,
      id: "brand",
      label: "Brand",
    },
    {
      badge: quality.summary.criticalCount || undefined,
      content: (close) => (
        <TemplateChecksPanel
          content={content}
          description={state.description}
          onSelectBlock={(blockId: string) => {
            controller.select(blockId)
            close()
          }}
          title={state.title}
        />
      ),
      icon: ListChecks,
      id: "checks",
      label: "Checks",
      wide: true,
    },
    ...(room
      ? [
          {
            content: (close: () => void) => (
              <RoomComments
                blocks={content.blocks}
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
        ]
      : []),
    ...(room || versions.length > 0
      ? [
          {
            content: (close: () => void) => (
              <div className="grid gap-4">
                {room ? (
                  <RoomCheckpoints onRestore={(copy: WorkingCopy) => history.set(() => fromCopy(copy))} onSave={live.checkpoint} room={room} />
                ) : null}
                {versions.length > 0 ? (
                  <section className="grid gap-1">
                    {room ? <h3 className="px-1 pt-1 text-[12.5px] font-medium text-muted-foreground">Published</h3> : null}
                    <TemplateVersions
                      live={template.publishedRevision}
                      onRestore={async (revision) => {
                        if (await restore(revision)) {
                          close()
                        }
                      }}
                      versions={versions}
                    />
                  </section>
                ) : null}
              </div>
            ),
            icon: History,
            id: "versions",
            label: "Versions",
          },
        ]
      : []),
  ]

  return (
    <>
      <EditorFrame
        backHref="/templates"
        backLabel="Back to templates"
        banner={
          recovery.recovery ? (
            <EditorNotice
              actions={[
                {
                  label: "Restore",
                  onClick: () => {
                    const data = recovery.restore()

                    if (data) {
                      history.set(() => ({ ...data, content: upgradeV2TemplateContentToV3(data.content) }))
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
                proposal.status === "stale"
                  ? [{ label: "Dismiss", onClick: () => setProposal(null) }]
                  : [
                      { label: "Apply", onClick: () => applyProposal(proposal, proposal.id) },
                      { label: "Reject", onClick: () => setProposal(null) },
                    ]
              }
            >
              {proposal.status === "stale" ? "Flow's suggestion is out of date" : "Flow's suggestion"}
            </EditorNotice>
          ) : Object.keys(testAnswers).length > 0 ? (
            <EditorNotice actions={[{ label: "Clear", onClick: () => setTestAnswers({}) }]}>Answers typed here are a try-out</EditorNotice>
          ) : null
        }
        canRedo={history.canRedo}
        canUndo={history.canUndo}
        dock={(narrow, orientation) =>
          // Flow has a button of its own, always there.
          !proposal ? (
            <EditorDock
              lead={narrow ? <FormatBar allowFiles controller={controller} narrow /> : undefined}
              narrow={narrow}
              orientation={orientation}
              tools={tools}
              trail={narrow ? <FlowDockSlot /> : undefined}
            />
          ) : null
        }
        layout={editorLayout}
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
              <DropdownMenuItem onClick={() => setDetailsOpen(true)}>
                <FilePenLine />
                Details
              </DropdownMenuItem>
              {template.status === "published" ? (
                <DropdownMenuItem render={<Link href={`/templates/${template.id}/links`} />}>
                  <Link2 />
                  Public links
                </DropdownMenuItem>
              ) : null}
              {/* Whoever can open the editor can edit the template, which is what sharing it takes. */}
              <DropdownMenuItem onClick={() => setSharing(true)}>
                <UserPlus />
                Share…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  const formData = new FormData()
                  formData.set("templateId", template.id)
                  startTransition(() => archiveAction(formData))
                }}
                variant="destructive"
              >
                <Archive />
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        onRedo={history.redo}
        onRetrySave={() => void (live.session ? live.session.flush() : autosave.flush())}
        onSave={() => void save()}
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
                  blocks={content.blocks}
                  canMoveDown={settingsIndex < content.blocks.length - 1}
                  canMoveUp={settingsIndex > 0}
                  onChange={(block) => controller.updateBlock(block, `settings:${block.id}`)}
                  onDelete={() => controller.remove(settingsBlock.id)}
                  onDuplicate={() => controller.duplicate(settingsBlock.id)}
                  onMoveDown={() => controller.move(settingsBlock.id, "down")}
                  onMoveUp={() => controller.move(settingsBlock.id, "up")}
                  pictureSource={{ templateId: template.id }}
                />
              ) : null}
            </EditorSidePanel>
            {/* On a phone Flow's button rests in the tools' row, or above the page without it. */}
            <FlowWindow onOpenChange={setFlowOpen} open={flowOpen} phoneBottom={!proposal ? 84 : 16}>
              <TemplateFlowPanel
                canUndo={flowUndo !== null}
                draft={state}
                initialMessages={initialFlowMessages}
                lastAppliedMessageId={flowUndo?.messageId ?? null}
                onApplyProposal={applyProposal}
                onProposalReceived={stageProposal}
                onProposalStale={setProposal}
                onRejectProposal={() => setProposal(null)}
                onUndo={() => {
                  if (flowUndo) {
                    history.set(() => flowUndo.state)
                    setFlowUndo(null)
                  }
                }}
                autoSend={carried}
                pendingProposal={proposal}
                templateId={template.id}
              />
            </FlowWindow>
          </>
        )}
        primary={
          <Button
            aria-keyshortcuts={needsSave ? "Meta+S Control+S" : undefined}
            className="h-10 px-4"
            disabled={!unpublished && !unsaved}
            onClick={() => void (needsSave ? save() : publish())}
            type="button"
          >
            {isDraft ? "Publish" : needsSave ? "Save" : "Update"}
          </Button>
        }
        saveStatus={
          history.liveStatus
            ? history.liveStatus
            : validationErrors > 0
            ? "blocked"
            : isDraft || ["conflict", "error", "offline", "saving"].includes(autosave.status)
              ? autosave.status
              : unsaved
                ? "unsaved-local"
                : unpublished
                  ? "saved"
                  : null
        }
        title={state.title}
        titleEditable={editable && !proposal}
        toolbar={!proposal ? <FormatBar allowFiles controller={controller} narrow={false} /> : undefined}
      >
        {({ narrow, zoom }) => (
          <EditorCanvas
            allowFiles
            answers={proposal ? undefined : testAnswers}
            controller={proposal ? preview : controller}
            designable={editable && !proposal}
            documentTitle={proposal ? proposal.candidateDraft.title : state.title}
            // The boxes take answers, so the author tries the form as they build it.
            fields={proposal ? "read" : "fill"}
            narrow={narrow}
            onAnswerChange={(fieldKey, value) =>
              setTestAnswers((answers) => applyVisibleTemplateFieldValue(content, answers, fieldKey, value))
            }
            overlay={room && !proposal ? <RoomLayer narrow={narrow} others={live.others} revision={content} room={room} /> : null}
            textEditable={editable && !proposal}
            zoom={zoom}
          />
        )}
      </EditorFrame>
      {sharing ? <ShareDialog name={template.title} onOpenChange={setSharing} open resources={[{ id: template.id, kind: "template" }]} /> : null}
      <Dialog onOpenChange={setDetailsOpen} open={detailsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Details</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="template-category">Category</FieldLabel>
              <SuggestInput
                id="template-category"
                maxLength={40}
                onChange={(category: string) => history.set((current) => ({ ...current, category }), "category")}
                suggestions={categorySuggestions}
                value={state.category}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="template-description">Description</FieldLabel>
              <textarea
                className="min-h-24 w-full resize-y rounded-[8px] border border-input bg-card px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                id="template-description"
                maxLength={2_000}
                onChange={(event) =>
                  history.set((current) => ({ ...current, description: event.target.value }), "description")
                }
                value={state.description}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={() => setDetailsOpen(false)} type="button">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Newest first; the live one is what staff get now.
function TemplateVersions({
  live,
  onRestore,
  versions,
}: {
  live: number | null
  onRestore: (revision: number) => Promise<void>
  versions: readonly DocumentTemplateVersion[]
}): ReactElement {
  return (
    <ul className="grid gap-1" data-slot="template-versions">
      {versions.map((version) => (
        <li className="flex min-h-11 items-center gap-3 rounded-[8px] px-2 hover:bg-muted/60" key={version.revision}>
          <span className="min-w-0 flex-1 truncate text-sm">
            {new Date(version.publishedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </span>
          {version.revision === live ? <span className="text-[12.5px] text-muted-foreground">Live</span> : null}
          <Button onClick={() => void onRestore(version.revision)} size="sm" type="button" variant="outline">
            Restore
          </Button>
        </li>
      ))}
    </ul>
  )
}

function toDraftInput(templateId: string, revision: number, state: TemplateEditorState): TemplateDraftInput {
  return {
    category: state.category,
    content: normalizeContentForSave(state.content as TemplateContentV3),
    description: state.description,
    expectedRevision: revision,
    templateId,
    title: state.title,
  }
}

// The same state reads the same whatever order its keys were written in.
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
      : entry
  )
}
