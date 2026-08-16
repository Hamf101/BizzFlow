import { EyeOff } from "lucide-react"
import type { ReactElement } from "react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { createTemplateRenderPlan } from "@/services/templates/template-render-plan"
import type { TemplateBlock, TemplateContent } from "@/types/template"

type TemplateOutlineProps = {
  content: TemplateContent
  selectedBlockId: string | null
  title: string
  onSelectBlock: (blockId: string) => void
}

/**
 * Renders canonical sections and blocks as the Studio navigation outline.
 *
 * @param props - Current content, title, selection, and selection callback.
 * @returns An accessible outline that includes conditionally hidden authoring blocks.
 */
export function TemplateOutline({
  content,
  selectedBlockId,
  title,
  onSelectBlock
}: TemplateOutlineProps): ReactElement {
  const plan = createTemplateRenderPlan({ title, content, mode: "build" })

  return (
    <nav aria-label="Template outline" className="grid gap-4">
      {plan.sections.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          Add an element to begin the outline.
        </p>
      ) : (
        plan.sections.map((section, sectionIndex: number) => (
          <section className="grid gap-1.5" key={section.id ?? "legacy"}>
            <div className="flex items-center justify-between gap-2 px-2">
              <h3 className="truncate text-xs font-semibold">
                {section.label ?? `Section ${sectionIndex + 1}`}
              </h3>
              <Badge variant="outline">{section.blocks.length}</Badge>
            </div>
            <ol className="grid gap-1">
              {section.blocks.map((renderBlock) => (
                <li key={renderBlock.block.id}>
                  <button
                    aria-current={
                      selectedBlockId === renderBlock.block.id
                        ? "location"
                        : undefined
                    }
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left text-xs transition-colors",
                      "hover:border-primary/20 hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
                      selectedBlockId === renderBlock.block.id &&
                        "border-primary/25 bg-secondary text-secondary-foreground"
                    )}
                    onClick={(): void =>
                      onSelectBlock(renderBlock.block.id)
                    }
                    type="button"
                  >
                    <span className="w-5 shrink-0 font-mono text-[9px] text-muted-foreground">
                      {renderBlock.canonicalIndex + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {getOutlineBlockLabel(renderBlock.block)}
                    </span>
                    {"visibleWhen" in renderBlock.block &&
                      renderBlock.block.visibleWhen && (
                        <EyeOff aria-label="Conditionally visible" />
                      )}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
    </nav>
  )
}

function getOutlineBlockLabel(block: TemplateBlock): string {
  if (block.type === "heading" || block.type === "paragraph") {
    return block.text.trim() || formatBlockType(block.type)
  }

  if (block.type === "bullet_list" || block.type === "numbered_list") {
    return block.items[0] ?? formatBlockType(block.type)
  }

  if ("label" in block) {
    return block.label
  }

  if (block.type === "image") {
    return block.altText
  }

  return formatBlockType(block.type)
}

function formatBlockType(type: TemplateBlock["type"]): string {
  const words = type.replaceAll("_", " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}
