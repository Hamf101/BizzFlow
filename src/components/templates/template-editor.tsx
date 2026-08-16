"use client"

import {
  Archive,
  Eye,
  FilePenLine,
  FlaskConical,
  Hammer,
  ListChecks,
  Palette,
  Plus,
  Save,
  Send,
  SlidersHorizontal,
  Sparkles,
  Settings2,
  X
} from "lucide-react"
import Image from "next/image"
import {
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useState
} from "react"

import { GeneratedDocumentContent } from "@/components/documents/generated-document-content"
import { TemplateBlockEditor } from "@/components/templates/template-block-editor"
import { TemplateChecksPanel } from "@/components/templates/template-checks-panel"
import { TemplateFlowPanel } from "@/components/templates/template-flow-panel"
import { TemplateOutline } from "@/components/templates/template-outline"
import { TemplatePreview } from "@/components/templates/template-preview"
import { TemplatePropertiesPanel } from "@/components/templates/template-properties-panel"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  clearLocalDraft,
  loadLocalDraft,
  saveLocalDraft,
  type SavedDraft
} from "@/lib/draft-autosave"
import { TemplateStatusBadge } from "@/lib/page-status-badges"
import { createTemplateFlowDraftFingerprint } from "@/services/template-flow-proposal-state"
import { createTemplateRenderPlan } from "@/services/templates/template-render-plan"
import {
  evaluateTemplateQuality,
  isTemplateQualityIssueSaveBlocking
} from "@/services/templates/template-quality-service"
import { templateContentSchema } from "@/types/template"
import type {
  DocumentTemplate,
  TemplateBlock,
  TemplateBranding
} from "@/types/template"
import {
  evaluateTemplateBlockDeletion,
  evaluateTemplateBlockMove
} from "@/types/template-structure"
import type {
  TemplateFlowDraft,
  TemplateFlowMessage,
  TemplateFlowProposal
} from "@/types/template-flow"

import {
  createTemplateBlock,
  templateEditorReducer,
  type TemplateEditorAction,
  type TemplateEditorState
} from "./template-editor-state"
import { readTemplateImage } from "./template-image"

const BLOCK_OPTIONS: ReadonlyArray<{
  type: TemplateBlock["type"]
  label: string
  description: string
}> = [
  {
    type: "heading",
    label: "Heading",
    description: "Create document hierarchy"
  },
  {
    type: "paragraph",
    label: "Paragraph",
    description: "Add explanatory copy"
  },
  {
    type: "bullet_list",
    label: "Bullet list",
    description: "List related items"
  },
  {
    type: "numbered_list",
    label: "Numbered list",
    description: "Show ordered steps"
  },
  {
    type: "image",
    label: "Image or logo",
    description: "Place a visual asset"
  },
  { type: "table", label: "Table", description: "Organize structured data" },
  { type: "divider", label: "Divider", description: "Separate content" },
  {
    type: "text_field",
    label: "Text field",
    description: "Collect written input"
  },
  { type: "date_field", label: "Date field", description: "Collect a date" },
  {
    type: "checkbox_field",
    label: "Checkbox",
    description: "Record an acknowledgement"
  },
  {
    type: "dropdown_field",
    label: "Dropdown",
    description: "Offer fixed choices"
  },
  {
    type: "initials_field",
    label: "Initials field",
    description: "Collect initials"
  },
  {
    type: "signature_field",
    label: "Signature field",
    description: "Collect a signature"
  },
  {
    type: "file_field",
    label: "File upload",
    description: "Collect one supporting file"
  }
]

type EditorPanel = "details" | "branding" | "block" | "insert"
type EditorMode = "build" | "preview" | "test"
type StudioRail = "properties" | "flow" | "checks"

type TemplateLocalDraft = {
  baseRevision: number
  state: TemplateEditorState
}

type LocalDraftStatus =
  | "checking"
  | "synced"
  | "saving"
  | "saved"
  | "failed"
  | "recovery"

type UndoSnapshot = {
  state: TemplateEditorState
  changedBlockIds: string[]
  messageId: string
}

type StructureIntegrityNotice = {
  message: string
  affectedFieldLabels: string[]
}

type TemplateEditorProps = {
  archiveAction: (formData: FormData) => Promise<void>
  initialFlowMessages: TemplateFlowMessage[]
  publishAction: (formData: FormData) => Promise<void>
  saveAction: (formData: FormData) => Promise<void>
  template: DocumentTemplate
}

/**
 * Provides the canvas-first template studio with contextual editing and Flow.
 *
 * @param props - Persisted template, shared Flow history, and server actions.
 * @returns A reducer-backed document canvas with floating controls and chat ledger.
 */
export function TemplateEditor({
  archiveAction,
  initialFlowMessages,
  publishAction,
  saveAction,
  template
}: TemplateEditorProps): ReactElement {
  const initialState = useMemo(
    (): TemplateEditorState => ({
      title: template.title,
      description: template.description ?? "",
      content: template.content
    }),
    [template.content, template.description, template.title]
  )
  const [state, dispatch] = useReducer(templateEditorReducer, initialState)
  const localDraftKey = `template:${template.id}`
  const initialStateSignature = useMemo(
    (): string => JSON.stringify(initialState),
    [initialState]
  )
  const stateSignature = useMemo((): string => JSON.stringify(state), [state])
  const [editorMode, setEditorMode] = useState<EditorMode>("build")
  const [activeRail, setActiveRail] = useState<StudioRail>("flow")
  const [localDraftReady, setLocalDraftReady] = useState<boolean>(false)
  const [localDraftStatus, setLocalDraftStatus] =
    useState<LocalDraftStatus>("checking")
  const [localDraftSavedAt, setLocalDraftSavedAt] = useState<string | null>(null)
  const [localDraftRecovery, setLocalDraftRecovery] =
    useState<SavedDraft<TemplateLocalDraft> | null>(null)
  const [activePanel, setActivePanel] = useState<EditorPanel | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [insertAfterBlockId, setInsertAfterBlockId] = useState<string | null>(
    template.content.blocks.at(-1)?.id ?? null
  )
  const [changedBlockIds, setChangedBlockIds] = useState<ReadonlySet<string>>(
    new Set<string>()
  )
  const [pendingFlowProposal, setPendingFlowProposal] =
    useState<TemplateFlowProposal | null>(null)
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null)
  const [structureIntegrityNotice, setStructureIntegrityNotice] =
    useState<StructureIntegrityNotice | null>(null)
  const displayState = pendingFlowProposal?.candidateDraft ?? state
  const displayChangedBlockIds = useMemo(
    (): ReadonlySet<string> =>
      pendingFlowProposal
        ? new Set(pendingFlowProposal.changedBlockIds)
        : changedBlockIds,
    [changedBlockIds, pendingFlowProposal]
  )
  const canvasIsEditable =
    editorMode === "build" && pendingFlowProposal === null
  const renderPlan = useMemo(
    () =>
      createTemplateRenderPlan({
        title: displayState.title,
        content: displayState.content,
        mode: editorMode === "build" ? "build" : "preview"
      }),
    [displayState.content, displayState.title, editorMode]
  )
  const qualityEvaluation = useMemo(
    () =>
      evaluateTemplateQuality({
        title: state.title,
        description: state.description,
        content: state.content
      }),
    [state.content, state.description, state.title]
  )
  const validationErrorCount = qualityEvaluation.issues.filter(
    isTemplateQualityIssueSaveBlocking
  ).length
  const saveIsBlocking =
    template.status === "published"
      ? qualityEvaluation.summary.isBlocking
      : validationErrorCount > 0
  const saveBlockingIssueCount =
    template.status === "published"
      ? qualityEvaluation.summary.criticalCount
      : validationErrorCount
  const selectedBlockValue = useMemo((): TemplateBlock | null => {
    if (!selectedBlockId) {
      return null
    }

    return (
      state.content.blocks.find(
        (block: TemplateBlock): boolean => block.id === selectedBlockId
      ) ?? null
    )
  }, [selectedBlockId, state.content.blocks])

  useEffect(() => {
    const timeoutId = window.setTimeout((): void => {
      const savedDraft = loadLocalDraft<TemplateLocalDraft>(localDraftKey)

      if (
        savedDraft &&
        isTemplateLocalDraft(savedDraft.data) &&
        JSON.stringify(savedDraft.data.state) !== initialStateSignature
      ) {
        setLocalDraftRecovery(savedDraft)
        setLocalDraftSavedAt(savedDraft.savedAt)
        setLocalDraftStatus("recovery")
      } else {
        if (savedDraft) {
          clearLocalDraft(localDraftKey)
        }

        setLocalDraftStatus("synced")
      }

      setLocalDraftReady(true)
    }, 0)

    return (): void => window.clearTimeout(timeoutId)
  }, [initialStateSignature, localDraftKey])

  useEffect(() => {
    if (!localDraftReady || localDraftRecovery) {
      return
    }

    if (stateSignature === initialStateSignature) {
      const timeoutId = window.setTimeout((): void => {
        clearLocalDraft(localDraftKey)
        setLocalDraftSavedAt(null)
        setLocalDraftStatus("synced")
      }, 0)

      return (): void => window.clearTimeout(timeoutId)
    }

    const savingStatusTimeoutId = window.setTimeout(
      (): void => setLocalDraftStatus("saving"),
      0
    )
    const timeoutId = window.setTimeout((): void => {
      const result = saveLocalDraft<TemplateLocalDraft>(localDraftKey, {
        baseRevision: template.revision,
        state
      })

      if (result.status === "saved") {
        setLocalDraftSavedAt(result.savedAt)
        setLocalDraftStatus("saved")
        return
      }

      setLocalDraftStatus("failed")
    }, 1_000)

    return (): void => {
      window.clearTimeout(savingStatusTimeoutId)
      window.clearTimeout(timeoutId)
    }
  }, [
    initialStateSignature,
    localDraftKey,
    localDraftReady,
    localDraftRecovery,
    state,
    stateSignature,
    template.revision
  ])

  function applyManualAction(action: TemplateEditorAction): void {
    setStructureIntegrityNotice(null)
    dispatch(action)
    setUndoSnapshot(null)
    markPendingFlowProposalStale()
  }

  function markPendingFlowProposalStale(): void {
    setPendingFlowProposal(
      (proposal: TemplateFlowProposal | null): TemplateFlowProposal | null =>
        proposal && proposal.status !== "stale"
          ? { ...proposal, status: "stale" }
          : proposal
    )
  }

  function selectEditorMode(mode: EditorMode): void {
    setEditorMode(mode)

    if (mode !== "build") {
      setActivePanel(null)
      setSelectedBlockId(null)
    }
  }

  function restoreLocalRecoveryDraft(): void {
    if (!localDraftRecovery) {
      return
    }

    dispatch({ type: "replace_state", value: localDraftRecovery.data.state })
    setChangedBlockIds(new Set<string>())
    setUndoSnapshot(null)
    setSelectedBlockId(null)
    setActivePanel(null)
    setEditorMode("build")
    markPendingFlowProposalStale()
    setLocalDraftRecovery(null)
    setLocalDraftStatus("saving")
  }

  function discardLocalRecoveryDraft(): void {
    clearLocalDraft(localDraftKey)
    setLocalDraftRecovery(null)
    setLocalDraftSavedAt(null)
    setLocalDraftStatus("synced")
  }

  function selectBlock(blockId: string): void {
    setEditorMode("build")
    setSelectedBlockId(blockId)
    setActivePanel("block")
  }

  function requestInsert(afterBlockId: string | null): void {
    setInsertAfterBlockId(afterBlockId)
    setActivePanel("insert")
  }

  function insertBlock(blockType: TemplateBlock["type"]): void {
    const block = createTemplateBlock(blockType, state.content.blocks)
    applyManualAction({
      type: "insert_block",
      afterBlockId: insertAfterBlockId,
      block
    })
    setSelectedBlockId(block.id)
    setActivePanel("block")
  }

  function moveBlock(blockId: string, direction: "up" | "down"): void {
    const moveEvaluation = evaluateTemplateBlockMove(
      state.content.blocks,
      blockId,
      direction
    )

    if (!moveEvaluation.success) {
      setStructureIntegrityNotice({
        message: moveEvaluation.message,
        affectedFieldLabels: getAffectedFieldLabels(
          state.content.blocks,
          moveEvaluation.dependentBlockIds
        )
      })
      return
    }

    applyManualAction({
      type: "move_block",
      blockId,
      direction
    })
  }

  function deleteBlock(blockId: string): void {
    const deleteEvaluation = evaluateTemplateBlockDeletion(
      state.content.blocks,
      blockId
    )

    if (!deleteEvaluation.success) {
      setStructureIntegrityNotice({
        message: deleteEvaluation.message,
        affectedFieldLabels: getAffectedFieldLabels(
          state.content.blocks,
          deleteEvaluation.dependentBlockIds
        )
      })
      return
    }

    applyManualAction({
      type: "delete_block",
      blockId
    })
    setSelectedBlockId(null)
    setActivePanel(null)
  }

  function applyFlowDraft(
    nextDraft: TemplateFlowDraft,
    nextChangedBlockIds: string[],
    messageId: string
  ): void {
    setUndoSnapshot({
      state,
      changedBlockIds: [...changedBlockIds],
      messageId
    })
    dispatch({ type: "replace_state", value: nextDraft })
    setChangedBlockIds(new Set(nextChangedBlockIds))
    setSelectedBlockId(null)
    setActivePanel(null)
  }

  function stageFlowProposal(
    proposal: TemplateFlowProposal,
    messageId: string
  ): void {
    setPendingFlowProposal(proposal)
    setSelectedBlockId(null)
    setActivePanel(null)
    setActiveRail("flow")
    setEditorMode("preview")
    console.info("template_flow_proposal_staged", {
      messageId,
      proposalId: proposal.id,
      templateId: template.id
    })
  }

  function acceptFlowProposal(
    proposal: TemplateFlowProposal,
    messageId: string
  ): void {
    if (
      proposal.status !== "pending" ||
      proposal.baseDraftFingerprint !== createTemplateFlowDraftFingerprint(state)
    ) {
      setPendingFlowProposal({ ...proposal, status: "stale" })
      return
    }

    applyFlowDraft(
      proposal.candidateDraft,
      proposal.changedBlockIds,
      messageId
    )
    setPendingFlowProposal(null)
    setEditorMode("build")
  }

  function rejectFlowProposal(): void {
    setPendingFlowProposal(null)
  }

  function undoLastFlowChange(): void {
    if (!undoSnapshot) {
      return
    }

    dispatch({ type: "replace_state", value: undoSnapshot.state })
    setChangedBlockIds(new Set(undoSnapshot.changedBlockIds))
    setUndoSnapshot(null)
  }

  return (
    <div className="flex flex-col gap-5">
      <form action={saveAction} id="template-editor-save-form">
        <input name="templateId" type="hidden" value={template.id} />
        <input
          name="expectedRevision"
          type="hidden"
          value={template.revision}
        />
        <input name="title" type="hidden" value={state.title} />
        <input name="description" type="hidden" value={state.description} />
        <input
          name="content"
          type="hidden"
          value={JSON.stringify(state.content)}
        />
      </form>

      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/80 pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="editorial-kicker text-primary">
              Template studio
            </span>
            <TemplateStatusBadge status={template.status} />
            <Badge variant="outline">Revision {template.revision}</Badge>
          </div>
          <h1 className="mt-1.5 truncate text-3xl font-semibold leading-tight">
            {state.title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {state.description ||
              "Shape the document directly, or ask Flow to create and organize it."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {template.status !== "archived" && (
            <Button
              disabled={
                pendingFlowProposal !== null || saveIsBlocking
              }
              form="template-editor-save-form"
              title={
                pendingFlowProposal !== null
                  ? "Apply or reject the Flow proposal before saving"
                  : saveIsBlocking
                  ? template.status === "published"
                    ? "Resolve critical checks before updating the published template"
                    : "Resolve invalid controls before saving"
                  : undefined
              }
              type="submit"
              variant="outline"
            >
              <Save />
              {template.status === "draft" ? "Save draft" : "Save changes"}
            </Button>
          )}
          {template.status === "draft" && (
            <Button
              disabled={
                pendingFlowProposal !== null ||
                qualityEvaluation.summary.isBlocking
              }
              form="template-editor-save-form"
              formAction={publishAction}
              title={
                pendingFlowProposal !== null
                  ? "Apply or reject the Flow proposal before publishing"
                  : qualityEvaluation.summary.isBlocking
                  ? "Resolve critical checks before publishing"
                  : undefined
              }
              type="submit"
            >
              <Send />
              Save &amp; publish
            </Button>
          )}
          {template.status !== "archived" && (
            <Button
              disabled={pendingFlowProposal !== null}
              formAction={archiveAction}
              form="template-editor-save-form"
              type="submit"
              variant="destructive"
            >
              <Archive />
              Archive
            </Button>
          )}
        </div>
      </header>

      {template.status === "published" && (
        <Alert>
          <AlertTitle>Changes affect the published template</AlertTitle>
          <AlertDescription>
            Existing documents keep their original snapshot. Save when the
            current canvas is ready for future documents.
          </AlertDescription>
        </Alert>
      )}

      {template.status !== "archived" &&
        saveIsBlocking && (
          <Alert variant="destructive">
            <AlertTitle>
              {template.status === "published"
                ? "Resolve critical checks before saving"
                : "Resolve validation errors before saving"}
            </AlertTitle>
            <AlertDescription>
              <span className="block">
                {saveBlockingIssueCount} blocking{" "}
                {saveBlockingIssueCount === 1
                  ? "check must"
                  : "checks must"} be resolved before saving or publishing.
                Review each visible control called out in Checks.
              </span>
              <Button
                className="mt-3"
                onClick={(): void => setActiveRail("checks")}
                size="sm"
                type="button"
                variant="outline"
              >
                Open Checks
              </Button>
            </AlertDescription>
          </Alert>
        )}

      {localDraftRecovery && (
        <Alert>
          <AlertTitle>Local recovery draft available</AlertTitle>
          <AlertDescription>
            <span className="block">
              Saved {formatLocalDraftTimestamp(localDraftRecovery.savedAt)} from
              revision {localDraftRecovery.data.baseRevision}. Restoring it
              creates an unsaved working copy; the cloud template stays unchanged
              until you save.
            </span>
            <span className="mt-3 flex flex-wrap gap-2">
              <Button
                onClick={restoreLocalRecoveryDraft}
                size="sm"
                type="button"
              >
                Restore local draft
              </Button>
              <Button
                onClick={discardLocalRecoveryDraft}
                size="sm"
                type="button"
                variant="outline"
              >
                Discard local draft
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      {structureIntegrityNotice && (
        <Alert variant="destructive">
          <AlertTitle>Conditional visibility protects this change</AlertTitle>
          <AlertDescription>
            <span className="block">{structureIntegrityNotice.message}</span>
            {structureIntegrityNotice.affectedFieldLabels.length > 0 && (
              <span className="mt-1 block">
                Affected fields:{" "}
                {structureIntegrityNotice.affectedFieldLabels.join(", ")}.
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <StudioModeToolbar
        activeMode={editorMode}
        criticalCount={qualityEvaluation.summary.criticalCount}
        localDraftSavedAt={localDraftSavedAt}
        localDraftStatus={localDraftStatus}
        onSelectMode={selectEditorMode}
        warningCount={qualityEvaluation.summary.warningCount}
      />

      {pendingFlowProposal && (
        <Alert
          variant={
            pendingFlowProposal.status === "stale" ? "destructive" : "default"
          }
        >
          <AlertTitle>
            {pendingFlowProposal.status === "stale"
              ? "Flow proposal is stale"
              : "Previewing a Flow proposal"}
          </AlertTitle>
          <AlertDescription>
            {pendingFlowProposal.status === "stale"
              ? "The accepted draft changed after Flow started. Reject this proposal and ask Flow to create a fresh one."
              : "The canvas shows Flow’s candidate, while Save still targets the accepted draft. Review the coherent batch in the Flow rail, then apply all or reject all."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid min-w-0 items-start gap-5 2xl:grid-cols-[220px_minmax(0,1fr)_360px]">
        <aside className="min-w-0 rounded-[10px] border border-border/80 bg-card p-3 2xl:sticky 2xl:top-5 2xl:max-h-[calc(100vh-2.5rem)] 2xl:overflow-y-auto">
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-border/80 px-1 pb-3">
            <div>
              <span className="editorial-kicker text-primary">Navigate</span>
              <h2 className="font-editorial text-lg font-semibold">Outline</h2>
            </div>
            <Badge variant="outline">{displayState.content.blocks.length}</Badge>
          </div>
          <TemplateOutline
            content={displayState.content}
            onSelectBlock={
              pendingFlowProposal
                ? (): void => setActiveRail("flow")
                : selectBlock
            }
            selectedBlockId={selectedBlockId}
            title={displayState.title}
          />
        </aside>

        <section
          aria-label="Template canvas"
          className="relative min-w-0 overflow-hidden rounded-[10px] border border-border/80 bg-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        >
          {canvasIsEditable ? (
            <EditorCanvasToolbar
              activePanel={activePanel}
              onAdd={(): void => {
                requestInsert(state.content.blocks.at(-1)?.id ?? null)
              }}
              onOpenPanel={(panel: EditorPanel): void =>
                setActivePanel(activePanel === panel ? null : panel)
              }
            />
          ) : (
            <div className="flex items-center justify-between gap-3 border-b border-border/80 bg-card/70 px-4 py-3">
              <div>
                <span className="editorial-kicker text-primary">
                  {pendingFlowProposal
                    ? "Proposal preview"
                    : editorMode === "preview"
                      ? "Reader view"
                      : "Interactive view"}
                </span>
                <p className="text-xs text-muted-foreground">
                  {pendingFlowProposal
                    ? "Authoring controls stay locked until this batch is applied or rejected."
                    : editorMode === "preview"
                    ? "Authoring controls are hidden so you can review the first impression."
                    : "Try the fields and verify that conditional questions appear at the right time."}
                </p>
              </div>
              <Badge variant="outline">
                {pendingFlowProposal
                  ? "Not applied"
                  : editorMode === "preview"
                    ? "Preview"
                    : "Local test"}
              </Badge>
            </div>
          )}

          {canvasIsEditable && activePanel && (
            <EditorFloatingPanel
              onClose={(): void => setActivePanel(null)}
              title={getPanelTitle(activePanel)}
            >
              {activePanel === "details" && (
                <TemplateDetailsPanel
                  description={state.description}
                  onDescriptionChange={(value: string): void =>
                    applyManualAction({ type: "set_description", value })
                  }
                  onTitleChange={(value: string): void =>
                    applyManualAction({ type: "set_title", value })
                  }
                  title={state.title}
                />
              )}

              {activePanel === "branding" && (
                <BrandingPanel
                  branding={state.content.branding}
                  onChange={(value: TemplateBranding): void =>
                    applyManualAction({ type: "set_branding", value })
                  }
                />
              )}

              {activePanel === "insert" && (
                <ElementPalette onInsert={insertBlock} />
              )}

              {activePanel === "block" &&
                selectedBlockId &&
                selectedBlockValue && (
                  <SelectedBlockInspector
                    block={selectedBlockValue}
                    blocks={state.content.blocks}
                    onChange={(block: TemplateBlock): void =>
                      applyManualAction({
                        type: "update_block",
                        block
                      })
                    }
                    onDelete={(): void => deleteBlock(selectedBlockId)}
                    onMove={(direction: "up" | "down"): void =>
                      moveBlock(selectedBlockId, direction)
                    }
                  />
                )}

              {activePanel === "block" && !selectedBlockValue && (
                <p className="text-sm text-muted-foreground">
                  Select an element on the page to edit its settings.
                </p>
              )}
            </EditorFloatingPanel>
          )}

          <div className="overflow-auto px-3 py-8 sm:px-6 lg:px-10 lg:py-12">
            {editorMode === "test" ? (
              <GeneratedDocumentContent
                answers={{}}
                content={displayState.content}
                editable
                title={displayState.title}
              />
            ) : (
              <TemplatePreview
                changedBlockIds={displayChangedBlockIds}
                onBlockSelect={
                  canvasIsEditable ? selectBlock : undefined
                }
                onDeleteBlock={
                  canvasIsEditable ? deleteBlock : undefined
                }
                onMoveBlock={canvasIsEditable ? moveBlock : undefined}
                onRequestInsert={
                  canvasIsEditable ? requestInsert : undefined
                }
                renderPlan={renderPlan}
                selectedBlockId={canvasIsEditable ? selectedBlockId : null}
              />
            )}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/80 bg-card/65 px-4 py-2.5">
            <span className="text-xs text-muted-foreground">
              {pendingFlowProposal
                ? "Review the candidate as one batch; it is not included in the save form."
                : editorMode === "build"
                ? "Click any element to edit. Use the margin controls to add content."
                : editorMode === "preview"
                  ? "Preview uses the same semantic render plan as generated output."
                  : "Test answers stay in this browser view and are never saved to the template."}
            </span>
            <span className="editorial-kicker text-muted-foreground">
              {pendingFlowProposal
                ? "Proposal preview"
                : editorMode === "build"
                ? "Unsaved working draft"
                : editorMode === "preview"
                  ? "Preview only"
                  : "Local answers only"}
            </span>
          </footer>
        </section>

        <aside className="min-w-0">
          <StudioRailTabs
            activeRail={activeRail}
            criticalCount={qualityEvaluation.summary.criticalCount}
            onSelectRail={setActiveRail}
          />

          {activeRail === "properties" && (
            <StudioRailPanel
              description="Page setup and repeated regions"
              title="Properties"
            >
              {pendingFlowProposal || editorMode !== "build" ? (
                <div className="grid gap-4">
                  <Alert>
                    <AlertTitle>
                      {pendingFlowProposal
                        ? "Resolve the Flow proposal first"
                        : `Properties are read-only in ${
                            editorMode === "preview" ? "Preview" : "Test"
                          }`}
                    </AlertTitle>
                    <AlertDescription>
                      {pendingFlowProposal
                        ? "Properties are locked while the canvas shows an unapplied candidate."
                        : "Return to Build to change page setup or repeated regions. The active values remain visible below."}
                    </AlertDescription>
                  </Alert>
                  <fieldset
                    aria-label="Read-only template properties"
                    className="opacity-70"
                    disabled
                  >
                    <TemplatePropertiesPanel
                      layout={renderPlan.layout}
                      onChange={(value): void =>
                        applyManualAction({ type: "set_layout", value })
                      }
                    />
                  </fieldset>
                </div>
              ) : (
                <TemplatePropertiesPanel
                  layout={renderPlan.layout}
                  onChange={(value): void =>
                    applyManualAction({ type: "set_layout", value })
                  }
                />
              )}
            </StudioRailPanel>
          )}

          {activeRail === "flow" && (
            <div className="grid gap-3">
              <Alert>
                <AlertTitle>Review generated wording</AlertTitle>
                <AlertDescription>
                  Flow creates a working first draft, not legal advice. Confirm
                  obligations, dates, and jurisdiction-specific language before
                  publishing.
                </AlertDescription>
              </Alert>
              <TemplateFlowPanel
                canUndo={undoSnapshot !== null}
                draft={state}
                initialMessages={initialFlowMessages}
                lastAppliedMessageId={undoSnapshot?.messageId ?? null}
                onApplyProposal={acceptFlowProposal}
                onProposalReceived={stageFlowProposal}
                onProposalStale={setPendingFlowProposal}
                onRejectProposal={rejectFlowProposal}
                onUndo={undoLastFlowChange}
                pendingProposal={pendingFlowProposal}
                templateId={template.id}
              />
            </div>
          )}

          {activeRail === "checks" && (
            <StudioRailPanel
              description="Deterministic first-draft checks"
              title="Checks"
            >
              <TemplateChecksPanel
                content={displayState.content}
                description={displayState.description}
                onSelectBlock={
                  pendingFlowProposal
                    ? (): void => setActiveRail("flow")
                    : selectBlock
                }
                title={displayState.title}
              />
            </StudioRailPanel>
          )}
        </aside>
      </div>
    </div>
  )
}

function StudioModeToolbar({
  activeMode,
  criticalCount,
  localDraftSavedAt,
  localDraftStatus,
  onSelectMode,
  warningCount
}: {
  activeMode: EditorMode
  criticalCount: number
  localDraftSavedAt: string | null
  localDraftStatus: LocalDraftStatus
  onSelectMode: (mode: EditorMode) => void
  warningCount: number
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-border/80 bg-card px-3 py-2.5">
      <div aria-label="Studio mode" className="flex flex-wrap gap-1">
        <Button
          aria-pressed={activeMode === "build"}
          onClick={(): void => onSelectMode("build")}
          size="sm"
          type="button"
          variant={activeMode === "build" ? "secondary" : "ghost"}
        >
          <Hammer />
          Build
        </Button>
        <Button
          aria-pressed={activeMode === "preview"}
          onClick={(): void => onSelectMode("preview")}
          size="sm"
          type="button"
          variant={activeMode === "preview" ? "secondary" : "ghost"}
        >
          <Eye />
          Preview
        </Button>
        <Button
          aria-pressed={activeMode === "test"}
          onClick={(): void => onSelectMode("test")}
          size="sm"
          type="button"
          variant={activeMode === "test" ? "secondary" : "ghost"}
        >
          <FlaskConical />
          Test
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{formatLocalDraftStatus(localDraftStatus, localDraftSavedAt)}</span>
        {criticalCount > 0 && (
          <Badge variant="destructive">{criticalCount} critical</Badge>
        )}
        {warningCount > 0 && (
          <Badge variant="outline">{warningCount} warnings</Badge>
        )}
      </div>
    </div>
  )
}

function StudioRailTabs({
  activeRail,
  criticalCount,
  onSelectRail
}: {
  activeRail: StudioRail
  criticalCount: number
  onSelectRail: (rail: StudioRail) => void
}): ReactElement {
  return (
    <div
      aria-label="Studio tools"
      className="mb-3 grid grid-cols-3 gap-1 rounded-[10px] border border-border/80 bg-card p-1"
    >
      <Button
        aria-pressed={activeRail === "properties"}
        onClick={(): void => onSelectRail("properties")}
        size="sm"
        type="button"
        variant={activeRail === "properties" ? "secondary" : "ghost"}
      >
        <SlidersHorizontal />
        Properties
      </Button>
      <Button
        aria-pressed={activeRail === "flow"}
        onClick={(): void => onSelectRail("flow")}
        size="sm"
        type="button"
        variant={activeRail === "flow" ? "secondary" : "ghost"}
      >
        <Sparkles />
        Flow
      </Button>
      <Button
        aria-pressed={activeRail === "checks"}
        className="relative"
        onClick={(): void => onSelectRail("checks")}
        size="sm"
        type="button"
        variant={activeRail === "checks" ? "secondary" : "ghost"}
      >
        <ListChecks />
        Checks
        {criticalCount > 0 && (
          <span
            aria-label={`${criticalCount} critical checks`}
            className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] leading-4 text-destructive-foreground"
          >
            {criticalCount}
          </span>
        )}
      </Button>
    </div>
  )
}

function StudioRailPanel({
  children,
  description,
  title
}: {
  children: ReactNode
  description: string
  title: string
}): ReactElement {
  return (
    <section className="overflow-hidden rounded-[10px] border border-border/80 bg-secondary/35">
      <header className="border-b border-border/80 bg-card/75 px-4 py-3.5">
        <span className="editorial-kicker text-primary">Studio tool</span>
        <h2 className="font-editorial text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

function EditorCanvasToolbar({
  activePanel,
  onAdd,
  onOpenPanel
}: {
  activePanel: EditorPanel | null
  onAdd: () => void
  onOpenPanel: (panel: EditorPanel) => void
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 bg-card/70 px-3 py-2.5">
      <div className="flex flex-wrap gap-1">
        <Button
          aria-pressed={activePanel === "details"}
          onClick={(): void => onOpenPanel("details")}
          size="sm"
          type="button"
          variant={activePanel === "details" ? "secondary" : "ghost"}
        >
          <FilePenLine />
          Details
        </Button>
        <Button
          aria-pressed={activePanel === "branding"}
          onClick={(): void => onOpenPanel("branding")}
          size="sm"
          type="button"
          variant={activePanel === "branding" ? "secondary" : "ghost"}
        >
          <Palette />
          Brand
        </Button>
        <Button
          aria-pressed={activePanel === "block"}
          onClick={(): void => onOpenPanel("block")}
          size="sm"
          type="button"
          variant={activePanel === "block" ? "secondary" : "ghost"}
        >
          <Settings2 />
          Element
        </Button>
      </div>
      <Button onClick={onAdd} size="sm" type="button" variant="outline">
        <Plus />
        Add element
      </Button>
    </div>
  )
}

function EditorFloatingPanel({
  children,
  onClose,
  title
}: {
  children: ReactNode
  onClose: () => void
  title: string
}): ReactElement {
  return (
    <div className="absolute top-14 left-3 z-20 max-h-[calc(100%-7rem)] w-[min(25rem,calc(100%-1.5rem))] overflow-y-auto rounded-[10px] border border-primary/15 bg-card shadow-[0_12px_35px_rgba(37,35,41,0.13)] sm:left-6">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-card px-4 py-3">
        <div>
          <span className="editorial-kicker text-primary">Inspector</span>
          <h2 className="font-editorial text-xl font-semibold">{title}</h2>
        </div>
        <Button
          aria-label="Close inspector"
          onClick={onClose}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <X />
        </Button>
      </header>
      <div className="p-4">{children}</div>
    </div>
  )
}

function TemplateDetailsPanel({
  description,
  onDescriptionChange,
  onTitleChange,
  title
}: {
  description: string
  onDescriptionChange: (value: string) => void
  onTitleChange: (value: string) => void
  title: string
}): ReactElement {
  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel htmlFor="template-title">Template title</FieldLabel>
        <Input
          id="template-title"
          maxLength={180}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onTitleChange(event.target.value)
          }
          required
          value={title}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="template-description">Description</FieldLabel>
        <textarea
          className="min-h-24 w-full resize-y rounded-[8px] border border-input bg-card px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          id="template-description"
          maxLength={2_000}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
            onDescriptionChange(event.target.value)
          }
          value={description}
        />
      </Field>
      <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
        Elements follow one continuous document flow. The printable border on
        the canvas defines the safe area used for generated pages.
      </p>
    </div>
  )
}

function BrandingPanel({
  branding,
  onChange
}: {
  branding: TemplateBranding
  onChange: (branding: TemplateBranding) => void
}): ReactElement {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleLogoChange(
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    setErrorMessage(null)

    try {
      const logoDataUrl = await readTemplateImage(file)
      onChange({ ...branding, logoDataUrl })
    } catch (error: unknown) {
      const reason =
        error instanceof Error ? error.message : "Unable to read logo."

      console.warn("template_branding_logo_read_failed", {
        fileName: file.name,
        reason
      })
      setErrorMessage(reason)
    } finally {
      event.target.value = ""
    }
  }

  return (
    <div className="grid gap-4">
      {branding.logoDataUrl && (
        <div className="flex items-center justify-between gap-3 rounded-[8px] border bg-muted/30 p-3">
          <Image
            alt="Current organization logo"
            className="h-auto max-h-10 w-auto max-w-28 object-contain"
            height={40}
            src={branding.logoDataUrl}
            unoptimized
            width={112}
          />
          <Button
            onClick={(): void => onChange({ ...branding, logoDataUrl: null })}
            size="sm"
            type="button"
            variant="ghost"
          >
            Remove logo
          </Button>
        </div>
      )}
      <Field>
        <FieldLabel htmlFor="branding-organization-name">
          Organization name
        </FieldLabel>
        <Input
          id="branding-organization-name"
          maxLength={160}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange({ ...branding, organizationName: event.target.value })
          }
          value={branding.organizationName}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <ColorControl
          id="branding-primary-color"
          label="Primary"
          onChange={(primaryColor: string): void =>
            onChange({ ...branding, primaryColor })
          }
          value={branding.primaryColor}
        />
        <ColorControl
          id="branding-accent-color"
          label="Accent"
          onChange={(accentColor: string): void =>
            onChange({ ...branding, accentColor })
          }
          value={branding.accentColor}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="branding-logo-alignment">
            Logo position
          </FieldLabel>
          <select
            className="h-9 w-full rounded-[8px] border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            id="branding-logo-alignment"
            onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
              onChange({
                ...branding,
                logoAlignment: event.target.value as "left" | "center" | "right"
              })
            }
            value={branding.logoAlignment}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="branding-logo-width">
            Logo size · {branding.logoWidthPercent}%
          </FieldLabel>
          <input
            className="h-9 w-full accent-primary"
            id="branding-logo-width"
            max={60}
            min={10}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              onChange({
                ...branding,
                logoWidthPercent: Number(event.target.value)
              })
            }
            type="range"
            value={branding.logoWidthPercent}
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="branding-logo">PNG or JPEG logo</FieldLabel>
        <Input
          accept="image/png,image/jpeg"
          aria-describedby={errorMessage ? "branding-logo-error" : undefined}
          id="branding-logo"
          onChange={handleLogoChange}
          type="file"
        />
        {errorMessage && (
          <p className="text-sm text-destructive" id="branding-logo-error">
            {errorMessage}
          </p>
        )}
      </Field>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Flow can reposition and resize an existing logo, but it preserves the
        image unless you explicitly ask to remove it.
      </p>
    </div>
  )
}

function ColorControl({
  id,
  label,
  onChange,
  value
}: {
  id: string
  label: string
  onChange: (value: string) => void
  value: string
}): ReactElement {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <label
        className="flex h-9 cursor-pointer items-center gap-2 rounded-[8px] border bg-card px-2 text-xs"
        htmlFor={id}
      >
        <span
          aria-hidden="true"
          className="size-5 rounded-[5px] border"
          style={{ backgroundColor: value }}
        />
        <span className="font-mono">{value.toUpperCase()}</span>
        <input
          className="sr-only"
          id={id}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange(event.target.value)
          }
          type="color"
          value={value}
        />
      </label>
    </Field>
  )
}

function ElementPalette({
  onInsert
}: {
  onInsert: (blockType: TemplateBlock["type"]) => void
}): ReactElement {
  return (
    <div>
      <p className="text-sm text-muted-foreground">
        Add to the document flow. The new element will open in the inspector.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {BLOCK_OPTIONS.map((option) => (
          <button
            className="rounded-[8px] border bg-card p-3 text-left transition-colors hover:border-primary/30 hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            key={option.type}
            onClick={(): void => onInsert(option.type)}
            type="button"
          >
            <span className="text-sm font-medium">{option.label}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
              {option.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SelectedBlockInspector({
  block,
  blocks,
  onChange,
  onDelete,
  onMove
}: {
  block: TemplateBlock
  blocks: TemplateBlock[]
  onChange: (block: TemplateBlock) => void
  onDelete: () => void
  onMove: (direction: "up" | "down") => void
}): ReactElement {
  const index = blocks.findIndex(
    (candidate: TemplateBlock): boolean => candidate.id === block.id
  )

  return (
    <TemplateBlockEditor
      block={block}
      blocks={blocks}
      canMoveDown={index >= 0 && index < blocks.length - 1}
      canMoveUp={index > 0}
      onChange={onChange}
      onDelete={onDelete}
      onMoveDown={(): void => onMove("down")}
      onMoveUp={(): void => onMove("up")}
    />
  )
}

function getAffectedFieldLabels(
  blocks: readonly TemplateBlock[],
  blockIds: readonly string[]
): string[] {
  return blockIds.flatMap((blockId: string): string[] => {
    const block = blocks.find(
      (candidate: TemplateBlock): boolean => candidate.id === blockId
    )

    return block && "label" in block ? [block.label] : []
  })
}

function getPanelTitle(panel: EditorPanel): string {
  if (panel === "details") {
    return "Document details"
  }

  if (panel === "branding") {
    return "Document brand"
  }

  if (panel === "insert") {
    return "Add an element"
  }

  return "Element settings"
}

function isTemplateLocalDraft(value: unknown): value is TemplateLocalDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>
  const state = candidate.state

  if (
    !Number.isInteger(candidate.baseRevision) ||
    Number(candidate.baseRevision) < 1 ||
    !state ||
    typeof state !== "object" ||
    Array.isArray(state)
  ) {
    return false
  }

  const stateCandidate = state as Record<string, unknown>

  return (
    typeof stateCandidate.title === "string" &&
    typeof stateCandidate.description === "string" &&
    templateContentSchema.safeParse(stateCandidate.content).success
  )
}

function formatLocalDraftStatus(
  status: LocalDraftStatus,
  savedAt: string | null
): string {
  switch (status) {
    case "checking":
      return "Checking local recovery…"
    case "synced":
      return "Cloud version loaded · no local changes"
    case "saving":
      return "Saving a local recovery copy…"
    case "saved":
      return savedAt
        ? `Local recovery saved ${formatLocalDraftTimestamp(savedAt)}`
        : "Local recovery saved"
    case "failed":
      return "Local recovery unavailable · use Save draft"
    case "recovery":
      return "Local recovery needs review"
  }
}

function formatLocalDraftTimestamp(value: string): string {
  const timestamp = new Date(value)

  if (Number.isNaN(timestamp.getTime())) {
    return "at an unknown time"
  }

  return timestamp.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  })
}
