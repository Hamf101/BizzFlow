import type { CSSProperties, ReactElement } from "react"

import {
  isStaticTemplateBlock,
  TemplateStaticBlock,
} from "@/components/templates/template-static-block"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { TemplateBlock, TemplateContent } from "@/types/template"

type TemplatePreviewProps = {
  content: TemplateContent
  className?: string
}

/**
 * Renders a print-oriented preview of the guided template content.
 *
 * @param props - Canonical template content and optional wrapper classes.
 * @returns A paper-like preview with header, body, and footer regions.
 */
export function TemplatePreview({
  content,
  className,
}: TemplatePreviewProps): ReactElement {
  const paperStyle = {
    "--template-accent": content.branding.accentColor,
    "--template-primary": content.branding.primaryColor,
  } as CSSProperties

  return (
    <article
      aria-label="Template preview"
      className={cn(
        "mx-auto flex min-h-[48rem] w-full max-w-[46rem] flex-col overflow-hidden rounded-sm border bg-white text-slate-900 shadow-sm",
        className
      )}
      style={paperStyle}
    >
      <PreviewRegion
        blocks={content.sections.header.blocks}
        label="Header"
        repeat={content.repeat.header}
        variant="header"
      />
      <PreviewRegion
        blocks={content.sections.body.blocks}
        label="Body"
        variant="body"
      />
      <PreviewRegion
        blocks={content.sections.footer.blocks}
        label="Footer"
        repeat={content.repeat.footer}
        variant="footer"
      />
    </article>
  )
}

function PreviewRegion({
  blocks,
  label,
  repeat = false,
  variant,
}: {
  blocks: TemplateBlock[]
  label: string
  repeat?: boolean
  variant: "header" | "body" | "footer"
}): ReactElement {
  return (
    <section
      aria-label={`${label} preview`}
      className={cn(
        "relative px-8 py-6 sm:px-12",
        variant === "body" && "min-h-[32rem] flex-1",
        variant === "header" && "border-b border-dashed border-slate-200",
        variant === "footer" && "border-t border-dashed border-slate-200"
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        <span>{label}</span>
        {variant !== "body" && repeat && (
          <Badge className="border-slate-200 text-slate-500" variant="outline">
            Repeats
          </Badge>
        )}
      </div>

      {blocks.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-400">
          No {label.toLowerCase()} blocks
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {blocks.map((block: TemplateBlock) => (
            <PreviewBlock block={block} key={block.id} />
          ))}
        </div>
      )}
    </section>
  )
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
              className="flex size-4 items-center justify-center rounded-sm border border-slate-400 text-[10px]"
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
          <div className="rounded-sm border border-slate-300 px-3 py-2 text-sm text-slate-400">
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
              "rounded-sm border border-slate-300 px-3 py-2 text-sm text-slate-400",
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
          <div className="rounded-sm border border-slate-300 px-3 py-2 text-sm text-slate-400">
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
          <div className="flex h-14 w-28 items-end rounded-sm border border-dashed border-slate-400 px-3 py-2 text-xs text-slate-400">
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
          <div className="flex h-24 items-end rounded-sm border border-dashed border-slate-400 px-3 py-2 text-xs text-slate-400">
            Drawn signature
          </div>
        </PreviewField>
      )
  }
}

function PreviewField({
  children,
  helpText,
  label,
  required,
}: {
  children: ReactElement
  helpText: string | null
  label: string
  required: boolean
}): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-slate-700">
        {label}
        {required && <span className="ml-1 text-red-600">*</span>}
      </span>
      {children}
      {helpText && <span className="text-xs text-slate-500">{helpText}</span>}
    </div>
  )
}
