"use client"

import {
  Archive,
  FilePenLine,
  Palette,
  Plus,
  Save,
  Send,
  Settings2,
  X
} from "lucide-react"
import Image from "next/image"
import {
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
  useMemo,
  useReducer,
  useState
} from "react"

import { TemplateBlockEditor } from "@/components/templates/template-block-editor"
import { TemplateFlowPanel } from "@/components/templates/template-flow-panel"
import { TemplatePreview } from "@/components/templates/template-preview"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { TemplateStatusBadge } from "@/lib/page-status-badges"
import type {
  DocumentTemplate,
  TemplateBlock,
  TemplateBranding
} from "@/types/template"
import type {
  TemplateFlowDraft,
  TemplateFlowMessage
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

type UndoSnapshot = {
  state: TemplateEditorState
  changedBlockIds: string[]
  messageId: string
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
  const [state, dispatch] = useReducer(templateEditorReducer, {
    title: template.title,
    description: template.description ?? "",
    content: template.content
  })
  const [activePanel, setActivePanel] = useState<EditorPanel | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [insertAfterBlockId, setInsertAfterBlockId] = useState<string | null>(
    template.content.blocks.at(-1)?.id ?? null
  )
  const [changedBlockIds, setChangedBlockIds] = useState<ReadonlySet<string>>(
    new Set<string>()
  )
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null)
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

  function applyManualAction(action: TemplateEditorAction): void {
    dispatch(action)
    setUndoSnapshot(null)
  }

  function selectBlock(blockId: string): void {
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
    applyManualAction({
      type: "move_block",
      blockId,
      direction
    })
  }

  function deleteBlock(blockId: string): void {
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
              form="template-editor-save-form"
              type="submit"
              variant="outline"
            >
              <Save />
              {template.status === "draft" ? "Save draft" : "Save changes"}
            </Button>
          )}
          {template.status === "draft" && (
            <Button
              form="template-editor-save-form"
              formAction={publishAction}
              type="submit"
            >
              <Send />
              Save &amp; publish
            </Button>
          )}
          {template.status !== "archived" && (
            <Button
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

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section
          aria-label="Template canvas"
          className="relative min-w-0 overflow-hidden rounded-[10px] border border-border/80 bg-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        >
          <EditorCanvasToolbar
            activePanel={activePanel}
            onAdd={(): void => {
              requestInsert(state.content.blocks.at(-1)?.id ?? null)
            }}
            onOpenPanel={(panel: EditorPanel): void =>
              setActivePanel(activePanel === panel ? null : panel)
            }
          />

          {activePanel && (
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
            <TemplatePreview
              changedBlockIds={changedBlockIds}
              content={state.content}
              onBlockSelect={selectBlock}
              onDeleteBlock={deleteBlock}
              onMoveBlock={moveBlock}
              onRequestInsert={requestInsert}
              selectedBlockId={selectedBlockId}
            />
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/80 bg-card/65 px-4 py-2.5">
            <span className="text-xs text-muted-foreground">
              Click any element to edit. Use the margin controls to add content.
            </span>
            <span className="editorial-kicker text-muted-foreground">
              Unsaved working draft
            </span>
          </footer>
        </section>

        <TemplateFlowPanel
          canUndo={undoSnapshot !== null}
          draft={state}
          initialMessages={initialFlowMessages}
          lastAppliedMessageId={undoSnapshot?.messageId ?? null}
          onApply={applyFlowDraft}
          onUndo={undoLastFlowChange}
          templateId={template.id}
        />
      </div>
    </div>
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
      canMoveDown={index >= 0 && index < blocks.length - 1}
      canMoveUp={index > 0}
      onChange={onChange}
      onDelete={onDelete}
      onMoveDown={(): void => onMove("down")}
      onMoveUp={(): void => onMove("up")}
    />
  )
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
