"use client"

import {
  Archive,
  FilePenLine,
  Files,
  Link2,
  ListChecks,
  MoreHorizontal,
  Palette,
  Plus,
  TextCursorInput,
} from "lucide-react"
import Link from "next/link"
import { type ReactElement, useMemo, useRef, useState, useTransition } from "react"

import type { TemplateDraftInput } from "@/app/(dashboard)/templates/actions"
import { FlowMark } from "@/components/brand/flow-mark"
import { useFlowHandoff } from "@/components/flow/flow-handoff"
import { findInsertChoices } from "@/components/editor/block-catalog"
import { EditorCanvas } from "@/components/editor/editor-canvas"
import { normalizeContentForSave } from "@/components/editor/editor-content"
import { type DockTool, EditorDock, InsertTiles } from "@/components/editor/editor-dock"
import { EditorFrame, type EditorLayoutStore, EditorNotice, EditorSidePanel } from "@/components/editor/editor-frame"
import { PageSetupPanel } from "@/components/editor/page-setup-panel"
import { type SaveResult, useAutosave } from "@/components/editor/use-autosave"
import { useEditorController } from "@/components/editor/use-editor-controller"
import { useEditorHistory } from "@/components/editor/use-editor-history"
import { useLocalRecovery } from "@/components/editor/use-local-recovery"
import { TemplateBlockEditor } from "@/components/templates/template-block-editor"
import { TemplateBrandingPanel } from "@/components/templates/template-branding-panel"
import { TemplateChecksPanel } from "@/components/templates/template-checks-panel"
import type { TemplateEditorState } from "@/components/templates/template-editor-state"
import { TemplateFlowPanel } from "@/components/templates/template-flow-panel"
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
import { createTemplateFlowDraftFingerprint } from "@/services/template-flow-proposal-state"
import { resolvePageGeometry } from "@/services/templates/template-render-plan"
import {
  evaluateTemplateQuality,
  isTemplateQualityIssueSaveBlocking,
} from "@/services/templates/template-quality-service"
import {
  type DocumentTemplate,
  type TemplateContentV3,
  upgradeV2TemplateContentToV3,
} from "@/types/template"
import type { TemplateFlowMessage, TemplateFlowProposal } from "@/types/template-flow"
import { withGeneratedFieldKeys } from "@/types/template-structure"
import { applyVisibleTemplateFieldValue } from "@/types/template-visibility"

type Mode = "edit" | "preview" | "test"

const MODES = [
  { label: "Edit", value: "edit" },
  { label: "Preview", value: "preview" },
  { label: "Test", value: "test" },
] as const

type TemplateEditorProps = {
  archiveAction: (formData: FormData) => Promise<void>
  /** Categories already in use in this tenant, offered as suggestions. */
  categorySuggestions?: readonly string[]
  /** Where this person keeps the dock and zoom. */
  editorLayout?: EditorLayoutStore
  initialFlowMessages: TemplateFlowMessage[]
  publishAction: (formData: FormData) => Promise<void>
  saveDraftAction: (input: TemplateDraftInput) => Promise<SaveResult>
  template: DocumentTemplate
}

/**
 * The template studio in the editor canvas: pages to type on, the dock with
 * everything that can be added, Flow and Checks, and Edit, Preview and Test.
 * A draft saves as it changes; a published template changes on Update.
 *
 * @param props - The template, its Flow history, and the server actions.
 * @returns The full-screen template editor.
 */
export function TemplateEditor({
  archiveAction,
  categorySuggestions = [],
  editorLayout,
  initialFlowMessages,
  publishAction,
  saveDraftAction,
  template,
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
  const history = useEditorHistory<TemplateEditorState>(initial)
  const state = history.state
  const content = state.content as TemplateContentV3
  const [mode, setMode] = useState<Mode>("edit")
  // Test answers belong to the editor, so switching modes keeps a trial run.
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
  const candidate = useMemo(
    () => (proposal ? upgradeV2TemplateContentToV3(proposal.candidateDraft.content) : content),
    [content, proposal]
  )
  const preview = useEditorController({ change: () => undefined, content: candidate, undo: () => undefined })
  const autosave = useAutosave<TemplateEditorState>({
    enabled: isDraft && validationErrors === 0,
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
  const recovery = useLocalRecovery({ key: `template:${template.id}`, saved: savedState, value: state })
  const settingsBlock = content.blocks.find((block) => block.id === controller.settingsBlockId) ?? null
  const settingsIndex = settingsBlock ? content.blocks.indexOf(settingsBlock) : -1
  const unsaved = JSON.stringify(state) !== JSON.stringify(savedState)
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
    if (blockedByChecks("publish")) {
      return
    }

    await autosave.flush()

    if (autosave.status !== "conflict") {
      submit(publishAction)
    }
  }

  async function update(): Promise<void> {
    if (blockedByChecks("update")) {
      return
    }

    const result = await saveDraftAction(toDraftInput(template.id, revisionRef.current, state))

    if (result.ok) {
      revisionRef.current = Number(result.version)
      setSavedState(state)
      bizflowToast.success("Template updated")
    } else {
      bizflowToast.error(result.message)
    }
  }

  function changeMode(next: Mode): void {
    setMode(next)
    controller.select(null)
  }

  function stageProposal(next: TemplateFlowProposal): void {
    setProposal(next)
    controller.select(null)
    setMode("preview")
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
    setMode("edit")
  }

  const tools: DockTool[] = [
    {
      content: (close) => (
        <InsertTiles
          choices={findInsertChoices({ allowFiles: true }).filter((choice) => choice.group === "page")}
          onChoose={(choice) => {
            controller.insert(choice)
            close()
          }}
        />
      ),
      icon: Plus,
      id: "add",
      label: "Add",
    },
    {
      content: (close) => (
        <InsertTiles
          choices={findInsertChoices({ allowFiles: true }).filter((choice) => choice.group === "fields")}
          onChoose={(choice) => {
            controller.insert(choice)
            close()
          }}
        />
      ),
      icon: TextCursorInput,
      id: "fields",
      label: "Fields",
    },
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
      icon: FlowMark,
      id: "flow",
      label: "Flow",
      onOpen: () => setFlowOpen((open) => !open),
    },
    {
      badge: quality.summary.criticalCount || undefined,
      content: (close) => (
        <TemplateChecksPanel
          content={content}
          description={state.description}
          onSelectBlock={(blockId: string) => {
            changeMode("edit")
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
          ) : null
        }
        canRedo={history.canRedo}
        canUndo={history.canUndo}
        dock={(narrow, orientation) => (
          // Flow stays within reach in every mode; the other tools need Edit.
          <EditorDock
            narrow={narrow}
            orientation={orientation}
            tools={mode === "edit" && !proposal ? tools : tools.filter((tool) => tool.id === "flow")}
          />
        )}
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
        mode={mode}
        modes={MODES}
        onModeChange={changeMode}
        onRedo={history.redo}
        onRetrySave={() => void autosave.flush()}
        onTitleChange={(title) => history.set((current) => ({ ...current, title }), "title")}
        onUndo={history.undo}
        pageWidthPoints={geometry.widthPoints * geometry.scale}
        panel={(narrow) => (
          <>
            <EditorSidePanel
              narrow={narrow}
              onClose={controller.closeSettings}
              open={settingsBlock !== null}
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
                />
              ) : null}
            </EditorSidePanel>
            <EditorSidePanel keepMounted narrow={narrow} onClose={() => setFlowOpen(false)} open={flowOpen} title="Flow">
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
            </EditorSidePanel>
          </>
        )}
        primary={
          <Button
            className="h-10 px-4"
            disabled={!isDraft && !unsaved}
            onClick={() => void (isDraft ? publish() : update())}
            type="button"
          >
            {isDraft ? "Publish" : "Update"}
          </Button>
        }
        saveStatus={isDraft ? (validationErrors > 0 ? "blocked" : autosave.status) : unsaved ? "unsaved-local" : null}
        title={state.title}
        titleEditable={mode === "edit" && !proposal}
      >
        {({ narrow, zoom }) => (
          <EditorCanvas
            allowFiles
            answers={mode === "test" ? testAnswers : undefined}
            controller={proposal ? preview : controller}
            designable={mode === "edit" && !proposal}
            documentTitle={proposal ? proposal.candidateDraft.title : state.title}
            fields={proposal || mode === "preview" ? "read" : mode === "test" ? "fill" : "design"}
            narrow={narrow}
            onAnswerChange={(fieldKey, value) =>
              setTestAnswers((answers) => applyVisibleTemplateFieldValue(content, answers, fieldKey, value))
            }
            surface={proposal || mode === "preview" ? "paper" : "screen"}
            textEditable={mode === "edit" && !proposal}
            zoom={zoom}
          />
        )}
      </EditorFrame>
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
