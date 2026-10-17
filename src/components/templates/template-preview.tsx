import Image from "next/image"
import type { CSSProperties, ReactElement } from "react"

import {
  isStaticTemplateBlock,
  TemplateStaticBlock
} from "@/components/templates/template-static-block"
import { BLOCK_GAP, pageStyle, paginationStyle, PlacedImages, printableMargin } from "@/components/templates/printed-page"
import {
  groupTemplateRenderBlocks,
  ROW_GRID,
  rowGridStyle,
  type TemplateWebRenderGroup
} from "@/components/templates/template-render-groups"
import {
  resolveDocumentSurfaceInk,
  type DocumentSurface
} from "@/lib/document-surface"
import { PaperGrid, PaperTable } from "@/components/editor/paper-answer-kinds"
import { cn } from "@/lib/utils"
import {
  shouldRenderTemplateFooter,
  numberedSectionTitle,
  shouldRenderTemplateHeader,
  type TemplateRenderBlock,
  type TemplateRenderPlan,
  type TemplateRenderSection
} from "@/services/templates/template-render-plan"
import { describeDateFormat } from "@/lib/date-format"
import { boxNote } from "@/types/box-signers"
import type {
  TemplateBlock,
  TemplateBranding,
  TemplateLayout
} from "@/types/template"
import { imageSource } from "@/types/template-images"

type TemplatePreviewProps = {
  renderPlan: TemplateRenderPlan
  /**
   * `screen` follows the interface theme and is what an author edits against.
   * `paper` reproduces the printed page, brand ink included, and belongs only
   * where the author has asked to see the finished document.
   */
  surface?: DocumentSurface
}

const CONTENT_PADDING = "min-w-0 overflow-hidden px-5 sm:px-8"

/**
 * Renders a print-oriented preview of the guided template content.
 *
 * @param props - Shared render plan and the surface it is drawn on.
 * @returns A paper-like preview with one bounded, free-form content flow.
 */
export function TemplatePreview({
  renderPlan,
  surface = "screen"
}: TemplatePreviewProps): ReactElement {
  const ink = resolveDocumentSurfaceInk(surface, renderPlan.branding)
  const paperStyle = {
    "--template-accent": ink.accent,
    "--template-primary": ink.primary,
    ...pageStyle(renderPlan)
  } as CSSProperties
  const printableAreaStyle = {
    margin: printableMargin(renderPlan)
  } as CSSProperties

  return (
    <article
      aria-label="Template preview"
      className={cn(
        "relative mx-auto flex min-h-[34rem] w-full flex-col rounded-xs border border-border bg-card text-foreground shadow-[0_8px_30px_rgba(37,35,41,0.08),0_1px_2px_rgba(37,35,41,0.08)]",
        renderPlan.layout.orientation === "portrait"
          ? "max-w-[46rem]"
          : "max-w-[64rem]",
        "overflow-hidden"
      )}
      data-document-surface={surface}
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
        {shouldRenderTemplateHeader(renderPlan.layout, 1) && (
          <TemplateBrandHeader branding={renderPlan.branding} />
        )}
        <div className="grid min-w-0 pt-7 grid-cols-1">
          <h1
            className="min-w-0 overflow-hidden font-editorial text-3xl font-semibold leading-tight px-5 sm:px-8"
            data-template-printed-title="true"
            style={{ color: "var(--template-primary)" }}
          >
            {renderPlan.title}
          </h1>
        </div>
        <PreviewFlow
          blocks={renderPlan.blocks}
          density={renderPlan.layout.density}
          sections={renderPlan.sections}
        />
        {shouldRenderTemplateFooter(renderPlan.layout, 1) &&
          renderPlan.layout.pageNumbering === "page_x_of_y" && (
            <footer
              className="grid min-w-0 border-t border-border pt-3 pb-1 grid-cols-1"
              data-template-page-footer="true"
            >
              <p className="text-right font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground px-5 sm:px-8">
                Page 1 of 1
              </p>
            </footer>
          )}
      </div>
      <PlacedImages plan={renderPlan} />
    </article>
  )
}

function TemplateBrandHeader({
  branding
}: {
  branding: TemplateBranding
}): ReactElement | null {
  const logo = imageSource(branding.logoAsset, branding.logoDataUrl)

  if (!logo && !branding.organizationName) {
    return null
  }

  return (
    <div
      className="grid min-w-0 border-b border-border grid-cols-1"
      data-template-brand-header="true"
    >
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2 overflow-hidden px-5 py-5 sm:px-8",
          branding.logoAlignment === "left" && "items-start text-left",
          branding.logoAlignment === "center" && "items-center text-center",
          branding.logoAlignment === "right" && "items-end text-right"
        )}
      >
        {logo && (
          <Image
            alt={`${branding.organizationName || "Organization"} logo`}
            className="h-auto max-h-16 object-contain"
            height={96}
            src={logo}
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
  density,
  sections
}: {
  blocks: readonly TemplateRenderBlock[]
  density: TemplateLayout["density"]
  sections: readonly TemplateRenderSection[]
}): ReactElement {
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
        <div className="grid grid-cols-1">
          <div className={CONTENT_PADDING}>
            <div className="rounded-sm border border-dashed border-border px-4 py-12 text-center text-xs text-muted-foreground">
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
              density={density}
              key={section.id ?? `implicit-section-${index}`}
              section={section}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function PreviewSection({
  density,
  section
}: {
  density: TemplateLayout["density"]
  section: TemplateRenderSection
}): ReactElement {
  const groups = groupTemplateRenderBlocks(section.blocks)

  return (
    <section
      className={cn("flex min-w-0 flex-col", BLOCK_GAP[density])}
      data-keep-together={section.keepTogether ? "true" : undefined}
      data-page-break-before={section.pageBreakBefore ? "true" : undefined}
      data-template-section-id={section.id ?? "implicit"}
      style={paginationStyle({
        keepTogether: section.keepTogether,
        pageBreakBefore: section.pageBreakBefore
      })}
    >
      {section.label && (
        <div className="grid min-w-0 grid-cols-1">
          <h2
            className={cn("font-editorial text-xl font-semibold leading-tight", CONTENT_PADDING)}
            data-template-section-label="true"
            style={{ color: "var(--template-primary)" }}
          >
            {numberedSectionTitle(section) ?? ""}
          </h2>
        </div>
      )}
      {groups.map((group: TemplateWebRenderGroup, groupIndex: number) => (
        <PreviewFieldGroup
          density={density}
          group={group}
          isFirstInSection={groupIndex === 0}
          key={group.id ?? `ungrouped-${group.blocks[0]?.block.id}`}
          sectionBreaksBefore={section.pageBreakBefore}
        />
      ))}
    </section>
  )
}

function PreviewFieldGroup({
  density,
  group,
  isFirstInSection,
  sectionBreaksBefore
}: {
  density: TemplateLayout["density"]
  group: TemplateWebRenderGroup
  isFirstInSection: boolean
  sectionBreaksBefore: boolean
}): ReactElement {
  return (
    <section
      className={cn("flex min-w-0 flex-col", BLOCK_GAP[density])}
      data-keep-together={group.keepTogether ? "true" : undefined}
      data-template-field-group-columns={group.columns}
      data-template-field-group-id={group.id ?? "ungrouped"}
      style={paginationStyle({ keepTogether: group.keepTogether })}
    >
      {group.label && (
        <div className="grid min-w-0 grid-cols-1">
          <h3
            className={cn("text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground", CONTENT_PADDING)}
            data-template-field-group-label="true"
          >
            {group.label}
          </h3>
        </div>
      )}
      <div
        style={rowGridStyle(group)}
        className={cn(
          // Rows stack on a phone and are laid out as they print from sm up.
          ROW_GRID,
          BLOCK_GAP[density],
          group.columns > 1 && "min-w-0 px-5 sm:px-8"
        )}
      >
        {group.blocks.map(
          (renderBlock: TemplateRenderBlock, blockIndex: number) => (
            <div
              className="grid min-w-0 grid-cols-1"
              data-keep-with-next={renderBlock.keepWithNext ? "true" : undefined}
              data-page-break-before={
                renderBlock.pageBreakBefore ? "true" : undefined
              }
              data-template-block-id={renderBlock.block.id}
              key={renderBlock.block.id}
              style={paginationStyle({
                keepWithNext: renderBlock.keepWithNext,
                pageBreakBefore:
                  renderBlock.pageBreakBefore &&
                  !(sectionBreaksBefore && isFirstInSection && blockIndex === 0)
              })}
            >
              <div className={group.columns > 1 ? "min-w-0" : CONTENT_PADDING}>
                {renderBlock.cue ? <p className="mb-1 text-xs text-muted-foreground">{renderBlock.cue}</p> : null}
                <div className="relative rounded-xs border border-transparent transition-colors">
                  <div className="relative z-10 px-2 py-1.5">
                    <PreviewBlock block={renderBlock.block} listMarkers={renderBlock.listMarkers} />
                  </div>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </section>
  )
}

function PreviewBlock({ block, listMarkers }: { block: TemplateBlock; listMarkers?: readonly string[] | null }): ReactElement {
  if (isStaticTemplateBlock(block)) {
    return (
      <TemplateStaticBlock
        accentColorVariable="var(--template-accent)"
        block={block}
        listMarkers={listMarkers}
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
          {block.display === "radios" || block.multiple ? (
            <span className={cn("flex gap-1.5 text-sm", block.across ? "flex-wrap gap-x-5" : "flex-col")}>
              {block.options.map((option: string) => (
                <span className="flex items-center gap-2" key={option}>
                  <span aria-hidden="true" className={cn("size-4 shrink-0 border border-muted-foreground/40", !block.multiple && "rounded-full")} />
                  {option}
                </span>
              ))}
            </span>
          ) : (
            <div className="rounded-sm border border-border px-3 py-2 text-sm text-muted-foreground">
              {block.placeholder || "Select an option"}
            </div>
          )}
        </PreviewField>
      )
    case "choice_grid_field":
    case "table_field":
      return (
        <PreviewField helpText={block.helpText} label={block.label} required={block.required}>
          {block.type === "choice_grid_field" ? (
            <PaperGrid block={block} mode="design" value={undefined} />
          ) : (
            <PaperTable block={block} mode="design" value={undefined} />
          )}
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
            {describeDateFormat(block.dateFormat)}
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
            {boxNote(block, [])}
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
            {boxNote(block, [])}
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
