import type { ReactElement } from "react"

import { TemplatePreview } from "@/components/templates/template-preview"
import { cn } from "@/lib/utils"
import {
  createTemplateRenderPlan,
  type TemplateRenderBlock,
  type TemplateRenderPlan,
  type TemplateRenderSection,
} from "@/services/templates/template-render-plan"
import type { TemplateContent } from "@/types/template"

/** More blocks than any first page holds; the frame clips whatever spills over. */
const FIRST_PAGE_BLOCKS = 16

/** Portrait A4, the templates' default page, when a template's own is unknown. */
const DEFAULT_PAGE = { heightPoints: 842, widthPoints: 595 } as const

/**
 * Draws a template's real first page on paper, shrunk the way a document
 * library shows its files. A template with nothing on it yet, or whose content
 * could not be read, draws a blank page.
 *
 * The page lays itself out at the preview's full 736px width and is zoomed to
 * the frame, so the frame's width and the zoom move together: 96px on phones
 * (a zoom of 0.1304) and 150px from `sm` up (0.2038).
 *
 * @param props - The template's content and title, and extra frame classes.
 * @returns A decorative page thumbnail.
 */
export function TemplatePageThumbnail({
  className,
  content,
  title,
}: {
  className?: string
  content: TemplateContent | null
  title: string
}): ReactElement {
  const plan = content === null ? null : readFirstPage(content, title)
  const page = plan?.geometry ?? DEFAULT_PAGE

  return (
    // The card's title names the template, so its picture stays out of the
    // accessibility tree.
    <div
      aria-hidden="true"
      className={cn(
        "relative w-[96px] shrink-0 overflow-hidden rounded-[3px] bg-card shadow-[0_1px_2px_rgba(37,35,41,0.08),0_8px_18px_rgba(37,35,41,0.08)] sm:w-[150px]",
        className
      )}
      data-document-surface="paper"
      data-slot="template-page"
      style={{ aspectRatio: `${page.widthPoints} / ${page.heightPoints}` }}
    >
      {plan === null ? null : (
        // The editor's frame and its dashed printable area do not belong on a
        // finished page.
        <div className="w-[736px] [zoom:0.1304] sm:[zoom:0.2038] [&_article]:min-h-0 [&_article]:rounded-none [&_article]:border-0 [&_article]:shadow-none [&_article>div]:border-0">
          <TemplatePreview renderPlan={plan} surface="paper" />
        </div>
      )}
    </div>
  )
}

function readFirstPage(
  content: TemplateContent,
  title: string
): TemplateRenderPlan | null {
  try {
    const plan = createTemplateRenderPlan({ content, mode: "preview", title })

    if (plan.blocks.length === 0) {
      return null
    }

    const blocks = plan.blocks.slice(0, FIRST_PAGE_BLOCKS)
    const kept = new Set(
      blocks.map((renderBlock: TemplateRenderBlock): string => renderBlock.block.id)
    )

    return {
      ...plan,
      blocks,
      sections: plan.sections
        .map(
          (section: TemplateRenderSection): TemplateRenderSection => ({
            ...section,
            blocks: section.blocks.filter((renderBlock: TemplateRenderBlock) =>
              kept.has(renderBlock.block.id)
            ),
          })
        )
        .filter((section: TemplateRenderSection): boolean => section.blocks.length > 0),
    }
  } catch {
    // An unreadable page is drawn blank rather than breaking the library.
    return null
  }
}
