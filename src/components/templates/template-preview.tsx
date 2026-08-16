import {
  ArrowDown,
  ArrowUp,
  Check,
  Plus,
  Settings2,
  Trash2
} from "lucide-react"
import Image from "next/image"
import type { CSSProperties, ReactElement } from "react"

import {
  isStaticTemplateBlock,
  TemplateStaticBlock
} from "@/components/templates/template-static-block"
import {
  groupTemplateRenderBlocks,
  type TemplateWebRenderGroup
} from "@/components/templates/template-render-groups"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  shouldRenderTemplateFooter,
  shouldRenderTemplateHeader,
  type TemplateRenderBlock,
  type TemplateRenderPlan,
  type TemplateRenderSection
} from "@/services/templates/template-render-plan"
import type {
  TemplateBlock,
  TemplateBranding,
  TemplateLayout
} from "@/types/template"

const EMPTY_CHANGED_BLOCK_IDS: ReadonlySet<string> = new Set<string>()

type TemplatePreviewProps = {
  renderPlan: TemplateRenderPlan
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
 * @param props - Shared render plan and optional editorial interactions.
 * @returns A paper-like preview with one bounded, free-form content flow.
 */
export function TemplatePreview({
  renderPlan,
  className,
  changedBlockIds = EMPTY_CHANGED_BLOCK_IDS,
  onBlockSelect,
  onDeleteBlock,
  onMoveBlock,
  onRequestInsert,
  selectedBlockId = null
}: TemplatePreviewProps): ReactElement {
  // CSS percentage margins on every side resolve against container width.
  // Scaling points by page width therefore preserves one physical margin.
  const marginPercent =
    (renderPlan.geometry.marginPoints / renderPlan.geometry.widthPoints) * 100
  const paperStyle = {
    "--template-accent": renderPlan.branding.accentColor,
    "--template-primary": renderPlan.branding.primaryColor,
    aspectRatio: `${renderPlan.geometry.widthPoints} / ${renderPlan.geometry.heightPoints}`
  } as CSSProperties
  const printableAreaStyle = {
    margin: `${marginPercent}%`
  } as CSSProperties
  const showEditorialGutter =
    onBlockSelect !== undefined || onRequestInsert !== undefined

  return (
    <article
      aria-label="Template preview"
      className={cn(
        "mx-auto flex min-h-[34rem] w-full flex-col rounded-[2px] border border-border bg-card text-foreground shadow-[0_8px_30px_rgba(37,35,41,0.08),0_1px_2px_rgba(37,35,41,0.08)]",
        renderPlan.layout.orientation === "portrait"
          ? "max-w-[46rem]"
          : "max-w-[64rem]",
        showEditorialGutter ? "overflow-visible" : "overflow-hidden",
        className
      )}
      data-template-density={renderPlan.layout.density}
      data-template-footer-policy={renderPlan.layout.footerPolicy}
      data-template-header-policy={renderPlan.layout.headerPolicy}
      data-template-orientation={renderPlan.layout.orientation}
      data-template-page-numbering={renderPlan.layout.pageNumbering}
      data-template-page-size={renderPlan.layout.pageSize}
      style={paperStyle}
    >
      <div
        className="relative min-h-[30rem] min-w-0 border border-dashed border-border"
        style={printableAreaStyle}
      >
        {showEditorialGutter && (
          <span className="absolute -top-2.5 right-3 bg-card px-2 font-mono text-[8px] uppercase tracking-[0.16em] text-muted-foreground">
            Printable area
          </span>
        )}
        {shouldRenderTemplateHeader(renderPlan.layout, 1) && (
          <TemplateBrandHeader
            branding={renderPlan.branding}
            showEditorialGutter={showEditorialGutter}
          />
        )}
        <TemplatePrintedTitle
          showEditorialGutter={showEditorialGutter}
          title={renderPlan.title}
        />
        <PreviewFlow
          blocks={renderPlan.blocks}
          changedBlockIds={changedBlockIds}
          onBlockSelect={onBlockSelect}
          onDeleteBlock={onDeleteBlock}
          onMoveBlock={onMoveBlock}
          onRequestInsert={onRequestInsert}
          selectedBlockId={selectedBlockId}
          showEditorialGutter={showEditorialGutter}
          density={renderPlan.layout.density}
          sections={renderPlan.sections}
        />
        {shouldRenderTemplateFooter(renderPlan.layout, 1) &&
          renderPlan.layout.pageNumbering === "page_x_of_y" && (
            <TemplatePageFooter
              layout={renderPlan.layout}
              showEditorialGutter={showEditorialGutter}
            />
          )}
      </div>
    </article>
  )
}

function TemplatePrintedTitle({
  showEditorialGutter,
  title
}: {
  showEditorialGutter: boolean
  title: string
}): ReactElement {
  return (
    <div
      className={cn(
        "grid min-w-0 pt-7",
        showEditorialGutter
          ? "grid-cols-[3.5rem_minmax(0,1fr)]"
          : "grid-cols-1"
      )}
    >
      {showEditorialGutter && (
        <span aria-hidden="true" className="border-r border-border" />
      )}
      <h1
        className={cn(
          "min-w-0 overflow-hidden font-editorial text-3xl font-semibold leading-tight",
          showEditorialGutter ? "pr-5 pl-5 sm:pr-8" : "px-5 sm:px-8"
        )}
        data-template-printed-title="true"
        style={{ color: "var(--template-primary)" }}
      >
        {title}
      </h1>
    </div>
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
      data-template-brand-header="true"
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

function TemplatePageFooter({
  layout,
  showEditorialGutter
}: {
  layout: TemplateLayout
  showEditorialGutter: boolean
}): ReactElement {
  return (
    <footer
      className={cn(
        "grid min-w-0 border-t border-border pt-3 pb-1",
        showEditorialGutter
          ? "grid-cols-[3.5rem_minmax(0,1fr)]"
          : "grid-cols-1"
      )}
      data-template-page-footer="true"
    >
      {showEditorialGutter && (
        <span aria-hidden="true" className="border-r border-border" />
      )}
      <p
        className={cn(
          "text-right font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground",
          showEditorialGutter ? "pr-5 pl-3 sm:pr-8" : "px-5 sm:px-8"
        )}
      >
        {layout.pageNumbering === "page_x_of_y" ? "Page 1 of 1" : null}
      </p>
    </footer>
  )
}

function PreviewFlow({
  blocks,
  changedBlockIds,
  density,
  onBlockSelect,
  onDeleteBlock,
  onMoveBlock,
  onRequestInsert,
  sections,
  selectedBlockId,
  showEditorialGutter
}: {
  blocks: readonly TemplateRenderBlock[]
  changedBlockIds: ReadonlySet<string>
  density: TemplateLayout["density"]
  onBlockSelect?: (blockId: string) => void
  onDeleteBlock?: (blockId: string) => void
  onMoveBlock?: (blockId: string, direction: "up" | "down") => void
  onRequestInsert?: (afterBlockId: string | null) => void
  sections: readonly TemplateRenderSection[]
  selectedBlockId: string | null
  showEditorialGutter: boolean
}): ReactElement {
  const contentPadding = showEditorialGutter
    ? "min-w-0 overflow-hidden pr-5 pl-3 sm:pr-8 sm:pl-5"
    : "min-w-0 overflow-hidden px-5 sm:px-8"
  const visibleIndexById = new Map<string, number>(
    blocks.map(
      (renderBlock: TemplateRenderBlock, index: number): [string, number] => [
        renderBlock.block.id,
        index
      ]
    )
  )

  return (
    <section
      aria-label="Document content preview"
      className={cn(
        "relative min-h-[24rem] min-w-0",
        density === "compact" && "py-4",
        density === "balanced" && "py-7",
        density === "comfortable" && "py-10"
      )}
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
        <div
          className={cn(
            "flex flex-col",
            density === "compact" && "gap-3",
            density === "balanced" && "gap-5",
            density === "comfortable" && "gap-7"
          )}
        >
          {sections.map((section: TemplateRenderSection, index: number) => (
            <PreviewSection
              blockCount={blocks.length}
              changedBlockIds={changedBlockIds}
              contentPadding={contentPadding}
              density={density}
              key={section.id ?? `implicit-section-${index}`}
              onBlockSelect={onBlockSelect}
              onDeleteBlock={onDeleteBlock}
              onMoveBlock={onMoveBlock}
              onRequestInsert={onRequestInsert}
              section={section}
              selectedBlockId={selectedBlockId}
              showEditorialGutter={showEditorialGutter}
              visibleIndexById={visibleIndexById}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function PreviewSection({
  blockCount,
  changedBlockIds,
  contentPadding,
  density,
  onBlockSelect,
  onDeleteBlock,
  onMoveBlock,
  onRequestInsert,
  section,
  selectedBlockId,
  showEditorialGutter,
  visibleIndexById
}: {
  blockCount: number
  changedBlockIds: ReadonlySet<string>
  contentPadding: string
  density: TemplateLayout["density"]
  onBlockSelect?: (blockId: string) => void
  onDeleteBlock?: (blockId: string) => void
  onMoveBlock?: (blockId: string, direction: "up" | "down") => void
  onRequestInsert?: (afterBlockId: string | null) => void
  section: TemplateRenderSection
  selectedBlockId: string | null
  showEditorialGutter: boolean
  visibleIndexById: ReadonlyMap<string, number>
}): ReactElement {
  const groups = groupTemplateRenderBlocks(section.blocks)

  return (
    <section
      className={cn(
        "flex min-w-0 flex-col",
        density === "compact" && "gap-1.5",
        density === "balanced" && "gap-3",
        density === "comfortable" && "gap-5"
      )}
      data-keep-together={section.keepTogether ? "true" : undefined}
      data-page-break-before={section.pageBreakBefore ? "true" : undefined}
      data-template-section-id={section.id ?? "implicit"}
      style={getPaginationStyle({
        keepTogether: section.keepTogether,
        pageBreakBefore: section.pageBreakBefore
      })}
    >
      {section.label && (
        <StructureLabel
          contentPadding={contentPadding}
          label={section.label}
          showEditorialGutter={showEditorialGutter}
          type="section"
        />
      )}
      {groups.map((group: TemplateWebRenderGroup, groupIndex: number) => (
        <PreviewFieldGroup
          blockCount={blockCount}
          changedBlockIds={changedBlockIds}
          contentPadding={contentPadding}
          density={density}
          group={group}
          isFirstInSection={groupIndex === 0}
          key={group.id ?? `ungrouped-${group.blocks[0]?.block.id}`}
          onBlockSelect={onBlockSelect}
          onDeleteBlock={onDeleteBlock}
          onMoveBlock={onMoveBlock}
          onRequestInsert={onRequestInsert}
          sectionBreaksBefore={section.pageBreakBefore}
          selectedBlockId={selectedBlockId}
          showEditorialGutter={showEditorialGutter}
          visibleIndexById={visibleIndexById}
        />
      ))}
    </section>
  )
}

function PreviewFieldGroup({
  blockCount,
  changedBlockIds,
  contentPadding,
  density,
  group,
  isFirstInSection,
  onBlockSelect,
  onDeleteBlock,
  onMoveBlock,
  onRequestInsert,
  sectionBreaksBefore,
  selectedBlockId,
  showEditorialGutter,
  visibleIndexById
}: {
  blockCount: number
  changedBlockIds: ReadonlySet<string>
  contentPadding: string
  density: TemplateLayout["density"]
  group: TemplateWebRenderGroup
  isFirstInSection: boolean
  onBlockSelect?: (blockId: string) => void
  onDeleteBlock?: (blockId: string) => void
  onMoveBlock?: (blockId: string, direction: "up" | "down") => void
  onRequestInsert?: (afterBlockId: string | null) => void
  sectionBreaksBefore: boolean
  selectedBlockId: string | null
  showEditorialGutter: boolean
  visibleIndexById: ReadonlyMap<string, number>
}): ReactElement {
  const twoColumnContentPadding = showEditorialGutter
    ? "min-w-0"
    : "min-w-0 px-5 sm:px-8"

  return (
    <section
      className={cn(
        "flex min-w-0 flex-col",
        density === "compact" && "gap-1.5",
        density === "balanced" && "gap-3",
        density === "comfortable" && "gap-5"
      )}
      data-keep-together={group.keepTogether ? "true" : undefined}
      data-template-field-group-columns={group.columns}
      data-template-field-group-id={group.id ?? "ungrouped"}
      style={getPaginationStyle({ keepTogether: group.keepTogether })}
    >
      {group.label && (
        <StructureLabel
          contentPadding={contentPadding}
          label={group.label}
          showEditorialGutter={showEditorialGutter}
          type="group"
        />
      )}
      <div
        className={cn(
          "grid min-w-0",
          group.columns === 1
            ? "grid-cols-1"
            : "grid-cols-1 sm:grid-cols-[repeat(2,minmax(0,1fr))]",
          density === "compact" && "gap-1.5",
          density === "balanced" && "gap-3",
          density === "comfortable" && "gap-5",
          group.columns === 2 && twoColumnContentPadding
        )}
      >
        {group.blocks.map(
          (renderBlock: TemplateRenderBlock, blockIndex: number) => {
            const visibleIndex =
              visibleIndexById.get(renderBlock.block.id) ?? 0
            const suppressSectionBreak =
              sectionBreaksBefore && isFirstInSection && blockIndex === 0

            return (
              <PreviewBlockRow
                canMoveDown={visibleIndex < blockCount - 1}
                canMoveUp={visibleIndex > 0}
                changed={changedBlockIds.has(renderBlock.block.id)}
                contentPadding={
                  group.columns === 2 ? "min-w-0" : contentPadding
                }
                key={renderBlock.block.id}
                onBlockSelect={onBlockSelect}
                onDeleteBlock={onDeleteBlock}
                onMoveBlock={onMoveBlock}
                onRequestInsert={onRequestInsert}
                renderBlock={renderBlock}
                selected={selectedBlockId === renderBlock.block.id}
                showEditorialGutter={showEditorialGutter}
                suppressPageBreak={suppressSectionBreak}
              />
            )
          }
        )}
      </div>
    </section>
  )
}

function PreviewBlockRow({
  canMoveDown,
  canMoveUp,
  changed,
  contentPadding,
  onBlockSelect,
  onDeleteBlock,
  onMoveBlock,
  onRequestInsert,
  renderBlock,
  selected,
  showEditorialGutter,
  suppressPageBreak
}: {
  canMoveDown: boolean
  canMoveUp: boolean
  changed: boolean
  contentPadding: string
  onBlockSelect?: (blockId: string) => void
  onDeleteBlock?: (blockId: string) => void
  onMoveBlock?: (blockId: string, direction: "up" | "down") => void
  onRequestInsert?: (afterBlockId: string | null) => void
  renderBlock: TemplateRenderBlock
  selected: boolean
  showEditorialGutter: boolean
  suppressPageBreak: boolean
}): ReactElement {
  const { block } = renderBlock

  return (
    <div
      className={cn(
        "grid min-w-0",
        showEditorialGutter
          ? "grid-cols-[3.5rem_minmax(0,1fr)]"
          : "grid-cols-1"
      )}
      data-keep-with-next={renderBlock.keepWithNext ? "true" : undefined}
      data-page-break-before={
        renderBlock.pageBreakBefore ? "true" : undefined
      }
      data-template-block-id={block.id}
      style={getPaginationStyle({
        keepWithNext: renderBlock.keepWithNext,
        pageBreakBefore: renderBlock.pageBreakBefore && !suppressPageBreak
      })}
    >
      {showEditorialGutter && (
        <EditorialGutterMarker
          blockId={block.id}
          changed={changed}
          index={renderBlock.canonicalIndex}
          onBlockSelect={onBlockSelect}
          onRequestInsert={onRequestInsert}
          selected={selected}
        />
      )}
      <div className={contentPadding}>
        <EditablePreviewBlock
          block={block}
          canMoveDown={canMoveDown}
          canMoveUp={canMoveUp}
          changed={changed}
          onBlockSelect={onBlockSelect}
          onDeleteBlock={onDeleteBlock}
          onMoveBlock={onMoveBlock}
          selected={selected}
        />
      </div>
    </div>
  )
}

function StructureLabel({
  contentPadding,
  label,
  showEditorialGutter,
  type
}: {
  contentPadding: string
  label: string
  showEditorialGutter: boolean
  type: "group" | "section"
}): ReactElement {
  return (
    <div
      className={cn(
        "grid min-w-0",
        showEditorialGutter
          ? "grid-cols-[3.5rem_minmax(0,1fr)]"
          : "grid-cols-1"
      )}
    >
      {showEditorialGutter && (
        <span aria-hidden="true" className="border-r border-border" />
      )}
      {type === "section" ? (
        <h2
          className={cn(
            "font-editorial text-xl font-semibold leading-tight",
            contentPadding
          )}
          data-template-section-label="true"
          style={{ color: "var(--template-primary)" }}
        >
          {label}
        </h2>
      ) : (
        <h3
          className={cn(
            "text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground",
            contentPadding
          )}
          data-template-field-group-label="true"
        >
          {label}
        </h3>
      )}
    </div>
  )
}

function getPaginationStyle({
  keepTogether = false,
  keepWithNext = false,
  pageBreakBefore = false
}: {
  keepTogether?: boolean
  keepWithNext?: boolean
  pageBreakBefore?: boolean
}): CSSProperties {
  return {
    ...(pageBreakBefore
      ? { breakBefore: "page", pageBreakBefore: "always" }
      : {}),
    ...(keepTogether
      ? { breakInside: "avoid-page", pageBreakInside: "avoid" }
      : {}),
    ...(keepWithNext
      ? { breakAfter: "avoid-page", pageBreakAfter: "avoid" }
      : {})
  }
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

  const selectionLabel = `Edit ${formatPreviewBlockType(block.type)}`

  return (
    <div
      className={cn(
        "relative rounded-[4px] border border-transparent transition-colors",
        selected && "border-ring bg-secondary/35",
        changed && !selected && "border-l-ring"
      )}
    >
      {onBlockSelect && (
        <button
          aria-label={selectionLabel}
          aria-pressed={selected}
          className="absolute inset-0 z-0 cursor-pointer rounded-[4px] border border-transparent transition-colors hover:border-primary/40 hover:bg-secondary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          onClick={selectBlock}
          type="button"
        >
          <span className="sr-only">{selectionLabel}</span>
        </button>
      )}
      {selected && (
        <div className="absolute -top-10 right-0 z-20 flex items-center gap-0.5 rounded-[7px] border border-border bg-card p-1 text-secondary-foreground shadow-[0_4px_14px_rgba(37,35,41,0.09)]">
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
      <div
        className={cn(
          "relative z-10 px-2 py-1.5",
          onBlockSelect && "pointer-events-none"
        )}
      >
        <PreviewBlock block={block} />
      </div>
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
            {block.placeholder || "Select an option"}
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
