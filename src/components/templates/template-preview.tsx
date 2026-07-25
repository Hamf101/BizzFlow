import {
  ArrowDown,
  ArrowUp,
  Check,
  Plus,
  Settings2,
  Trash2
} from "lucide-react"
import Image from "next/image"
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  ReactElement
} from "react"

import {
  isStaticTemplateBlock,
  TemplateStaticBlock
} from "@/components/templates/template-static-block"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type {
  TemplateBlock,
  TemplateBranding,
  TemplateContent
} from "@/types/template"

type TemplatePreviewProps = {
  content: TemplateContent
  className?: string
  changedBlockIds?: ReadonlySet<string>
  onBlockSelect?: (blockId: string) => void
  onDeleteBlock?: (blockId: string) => void
  onMoveBlock?: (blockId: string, direction: "up" | "down") => void
  onRequestInsert?: (afterBlockId: string | null) => void
  selectedBlockId?: string | null
}

/**
 * Renders a print-oriented preview of the guided template content.
 *
 * @param props - Canonical template content and optional wrapper classes.
 * @returns A paper-like preview with one bounded, free-form content flow.
 */
export function TemplatePreview({
  content,
  className,
  changedBlockIds = new Set<string>(),
  onBlockSelect,
  onDeleteBlock,
  onMoveBlock,
  onRequestInsert,
  selectedBlockId = null
}: TemplatePreviewProps): ReactElement {
  const paperStyle = {
    "--template-accent": content.branding.accentColor,
    "--template-primary": content.branding.primaryColor
  } as CSSProperties
  const showEditorialGutter =
    onBlockSelect !== undefined || onRequestInsert !== undefined

  return (
    <article
      aria-label="Template preview"
      className={cn(
        "mx-auto flex min-h-[48rem] w-full max-w-[46rem] flex-col rounded-[2px] border border-border bg-card text-foreground shadow-[0_8px_30px_rgba(37,35,41,0.08),0_1px_2px_rgba(37,35,41,0.08)]",
        showEditorialGutter ? "overflow-visible" : "overflow-hidden",
        className
      )}
      style={paperStyle}
    >
      <div className="relative mx-5 my-6 min-h-[43rem] min-w-0 border border-dashed border-border sm:mx-8 sm:my-8">
        {showEditorialGutter && (
          <span className="absolute -top-2.5 right-3 bg-card px-2 font-mono text-[8px] uppercase tracking-[0.16em] text-muted-foreground">
            Printable area
          </span>
        )}
        <TemplateBrandHeader
          branding={content.branding}
          showEditorialGutter={showEditorialGutter}
        />
        <PreviewFlow
          blocks={content.blocks}
          changedBlockIds={changedBlockIds}
          onBlockSelect={onBlockSelect}
          onDeleteBlock={onDeleteBlock}
          onMoveBlock={onMoveBlock}
          onRequestInsert={onRequestInsert}
          selectedBlockId={selectedBlockId}
          showEditorialGutter={showEditorialGutter}
        />
      </div>
    </article>
  )
}

function TemplateBrandHeader({
  branding,
  showEditorialGutter
}: {
  branding: TemplateBranding
  showEditorialGutter: boolean
}): ReactElement | null {
  if (!branding.logoDataUrl && !branding.organizationName) {
    return null
  }

  return (
    <div
      className={cn(
        "grid min-w-0 border-b border-border",
        showEditorialGutter ? "grid-cols-[3.5rem_minmax(0,1fr)]" : "grid-cols-1"
      )}
    >
      {showEditorialGutter && (
        <span aria-hidden="true" className="border-r border-border" />
      )}
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2 overflow-hidden px-5 py-5 sm:px-8",
          branding.logoAlignment === "left" && "items-start text-left",
          branding.logoAlignment === "center" && "items-center text-center",
          branding.logoAlignment === "right" && "items-end text-right"
        )}
      >
        {branding.logoDataUrl && (
          <Image
            alt={`${branding.organizationName || "Organization"} logo`}
            className="h-auto max-h-16 object-contain"
            height={96}
            src={branding.logoDataUrl}
            style={{ width: `${branding.logoWidthPercent}%` }}
            unoptimized
            width={480}
          />
        )}
        {branding.organizationName && (
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--template-primary)" }}
          >
            {branding.organizationName}
          </span>
        )}
      </div>
    </div>
  )
}

function PreviewFlow({
  blocks,
  changedBlockIds,
  onBlockSelect,
  onDeleteBlock,
  onMoveBlock,
  onRequestInsert,
  selectedBlockId,
  showEditorialGutter
}: {
  blocks: TemplateBlock[]
  changedBlockIds: ReadonlySet<string>
  onBlockSelect?: (blockId: string) => void
  onDeleteBlock?: (blockId: string) => void
  onMoveBlock?: (blockId: string, direction: "up" | "down") => void
  onRequestInsert?: (afterBlockId: string | null) => void
  selectedBlockId: string | null
  showEditorialGutter: boolean
}): ReactElement {
  const contentPadding = showEditorialGutter
    ? "min-w-0 overflow-hidden pr-5 pl-3 sm:pr-8 sm:pl-5"
    : "min-w-0 overflow-hidden px-5 sm:px-8"

  return (
    <section
      aria-label="Document content preview"
      className="relative min-h-[34rem] min-w-0 py-7"
    >
      {blocks.length === 0 ? (
        <div
          className={cn(
            "grid",
            showEditorialGutter
              ? "grid-cols-[3.5rem_minmax(0,1fr)]"
              : "grid-cols-1"
          )}
        >
          {showEditorialGutter && (
            <EditorialGutterMarker
              blockId={null}
              changed={false}
              index={0}
              onRequestInsert={onRequestInsert}
            />
          )}
          <div className={contentPadding}>
            <div className="rounded-[6px] border border-dashed border-border px-4 py-12 text-center text-xs text-muted-foreground">
              Add an element or ask Flow to create the document
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {blocks.map((block: TemplateBlock, index: number) => (
            <div
              className={cn(
                "grid",
                showEditorialGutter
                  ? "grid-cols-[3.5rem_minmax(0,1fr)]"
                  : "grid-cols-1"
              )}
              key={block.id}
            >
              {showEditorialGutter && (
                <EditorialGutterMarker
                  blockId={block.id}
                  changed={changedBlockIds.has(block.id)}
                  index={index}
                  onBlockSelect={onBlockSelect}
                  onRequestInsert={onRequestInsert}
                  selected={selectedBlockId === block.id}
                />
              )}
              <div className={contentPadding}>
                <EditablePreviewBlock
                  block={block}
                  canMoveDown={index < blocks.length - 1}
                  canMoveUp={index > 0}
                  changed={changedBlockIds.has(block.id)}
                  onBlockSelect={onBlockSelect}
                  onDeleteBlock={onDeleteBlock}
                  onMoveBlock={onMoveBlock}
                  selected={selectedBlockId === block.id}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function EditorialGutterMarker({
  blockId,
  changed,
  index,
  onBlockSelect,
  onRequestInsert,
  selected = false
}: {
  blockId: string | null
  changed: boolean
  index: number
  onBlockSelect?: (blockId: string) => void
  onRequestInsert?: (afterBlockId: string | null) => void
  selected?: boolean
}): ReactElement {
  return (
    <div className="relative flex min-h-12 flex-col items-center border-r border-border">
      <span className="font-editorial text-xs text-muted-foreground">
        §{index + 1}
      </span>
      {blockId && (
        <button
          aria-label={`Select element ${index + 1}`}
          className={cn(
            "mt-1.5 grid size-5 place-items-center rounded-full border border-border bg-card text-[9px] text-muted-foreground transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
            selected && "border-primary bg-primary text-primary-foreground",
            changed && !selected && "border-ring text-primary"
          )}
          onClick={(): void => onBlockSelect?.(blockId)}
          type="button"
        >
          {changed ? (
            <Check className="size-3" />
          ) : (
            <span aria-hidden="true">·</span>
          )}
        </button>
      )}
      <span
        aria-hidden="true"
        className={cn(
          "my-1 min-h-4 flex-1 border-l border-dashed border-border",
          changed && "border-solid border-ring"
        )}
      />
      {onRequestInsert && (
        <button
          aria-label={`Add an element after element ${index + 1}`}
          className="grid size-5 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-ring hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
          onClick={(): void => onRequestInsert(blockId)}
          type="button"
        >
          <Plus className="size-3" />
        </button>
      )}
    </div>
  )
}

function EditablePreviewBlock({
  block,
  canMoveDown,
  canMoveUp,
  changed,
  onBlockSelect,
  onDeleteBlock,
  onMoveBlock,
  selected
}: {
  block: TemplateBlock
  canMoveDown: boolean
  canMoveUp: boolean
  changed: boolean
  onBlockSelect?: (blockId: string) => void
  onDeleteBlock?: (blockId: string) => void
  onMoveBlock?: (blockId: string, direction: "up" | "down") => void
  selected: boolean
}): ReactElement {
  function selectBlock(): void {
    onBlockSelect?.(block.id)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      selectBlock()
    }
  }

  function stopToolbarEvent(event: MouseEvent<HTMLDivElement>): void {
    event.stopPropagation()
  }

  return (
    <div
      aria-label={`Edit ${formatPreviewBlockType(block.type)}`}
      className={cn(
        "relative rounded-[4px] border border-transparent px-2 py-1.5 transition-colors",
        onBlockSelect &&
          "cursor-pointer hover:border-primary/40 hover:bg-secondary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
        selected && "border-ring bg-secondary/35",
        changed && !selected && "border-l-ring"
      )}
      onClick={selectBlock}
      onKeyDown={handleKeyDown}
      role={onBlockSelect ? "button" : undefined}
      tabIndex={onBlockSelect ? 0 : undefined}
    >
      {selected && (
        <div
          className="absolute -top-10 right-0 z-10 flex items-center gap-0.5 rounded-[7px] border border-border bg-card p-1 text-secondary-foreground shadow-[0_4px_14px_rgba(37,35,41,0.09)]"
          onClick={stopToolbarEvent}
        >
          <Button
            aria-label="Edit block settings"
            onClick={selectBlock}
            size="icon-xs"
            title="Edit settings"
            type="button"
            variant="ghost"
          >
            <Settings2 />
          </Button>
          <Button
            aria-label="Move block up"
            disabled={!canMoveUp}
            onClick={(): void => onMoveBlock?.(block.id, "up")}
            size="icon-xs"
            title="Move up"
            type="button"
            variant="ghost"
          >
            <ArrowUp />
          </Button>
          <Button
            aria-label="Move block down"
            disabled={!canMoveDown}
            onClick={(): void => onMoveBlock?.(block.id, "down")}
            size="icon-xs"
            title="Move down"
            type="button"
            variant="ghost"
          >
            <ArrowDown />
          </Button>
          <Button
            aria-label="Delete block"
            onClick={(): void => onDeleteBlock?.(block.id)}
            size="icon-xs"
            title="Delete"
            type="button"
            variant="destructive"
          >
            <Trash2 />
          </Button>
        </div>
      )}
      <PreviewBlock block={block} />
    </div>
  )
}

function formatPreviewBlockType(type: TemplateBlock["type"]): string {
  return type.replaceAll("_", " ")
}

function PreviewBlock({ block }: { block: TemplateBlock }): ReactElement {
  if (isStaticTemplateBlock(block)) {
    return (
      <TemplateStaticBlock
        accentColorVariable="var(--template-accent)"
        block={block}
        primaryColorVariable="var(--template-primary)"
      />
    )
  }

  switch (block.type) {
    case "checkbox_field":
      return (
        <PreviewField
          helpText={block.helpText}
          label={block.label}
          required={block.required}
        >
          <span className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className="flex size-4 items-center justify-center rounded-sm border border-muted-foreground/40 text-[10px]"
            >
              {block.checkedByDefault ? "✓" : ""}
            </span>
            {block.label}
          </span>
        </PreviewField>
      )
    case "dropdown_field":
      return (
        <PreviewField
          helpText={block.helpText}
          label={block.label}
          required={block.required}
        >
          <div className="rounded-sm border border-border px-3 py-2 text-sm text-muted-foreground">
            {block.placeholder || block.options[0] || "Select an option"}
          </div>
        </PreviewField>
      )
    case "text_field":
      return (
        <PreviewField
          helpText={block.helpText}
          label={block.label}
          required={block.required}
        >
          <div
            className={cn(
              "rounded-sm border border-border px-3 py-2 text-sm text-muted-foreground",
              block.multiline && "min-h-20"
            )}
          >
            {block.placeholder || (block.multiline ? "Enter text" : "Text")}
          </div>
        </PreviewField>
      )
    case "date_field":
      return (
        <PreviewField
          helpText={block.helpText}
          label={block.label}
          required={block.required}
        >
          <div className="rounded-sm border border-border px-3 py-2 text-sm text-muted-foreground">
            MM / DD / YYYY
          </div>
        </PreviewField>
      )
    case "initials_field":
      return (
        <PreviewField
          helpText={block.helpText}
          label={block.label}
          required={block.required}
        >
          <div className="flex h-14 w-28 items-end rounded-sm border border-dashed border-muted-foreground/40 px-3 py-2 text-xs text-muted-foreground">
            Initials
          </div>
        </PreviewField>
      )
    case "signature_field":
      return (
        <PreviewField
          helpText={block.helpText}
          label={block.label}
          required={block.required}
        >
          <div className="flex h-24 items-end rounded-sm border border-dashed border-muted-foreground/40 px-3 py-2 text-xs text-muted-foreground">
            Drawn signature
          </div>
        </PreviewField>
      )
    case "file_field":
      return (
        <PreviewField
          helpText={block.helpText}
          label={block.label}
          required={block.required}
        >
          <div className="rounded-sm border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
            Choose a file
          </div>
        </PreviewField>
      )
  }
}

function PreviewField({
  children,
  helpText,
  label,
  required
}: {
  children: ReactElement
  helpText: string | null
  label: string
  required: boolean
}): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-foreground">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </span>
      {children}
      {helpText && <span className="text-xs text-muted-foreground">{helpText}</span>}
    </div>
  )
}
