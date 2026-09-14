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

/** A sheet of paper lying on the surface, shared by every page picture. */
export const PAPER_FRAME =
  "relative shrink-0 overflow-hidden rounded-[3px] bg-card shadow-[0_1px_2px_rgba(37,35,41,0.08),0_8px_18px_rgba(37,35,41,0.08)]"

/**
 * Frame widths and the zoom that fits the 736px page into each: the zoom is
 * always the width divided by 736.
 */
export const PAGE_SIZES = {
  // A Templates card: 96px on phones, 150px from `sm` up.
  card: { frame: "w-[96px] sm:w-[150px]", zoom: "[zoom:0.1304] sm:[zoom:0.2038]" },
  // A Files filmstrip frame.
  film: { frame: "w-[46px]", zoom: "[zoom:0.0625]" },
  // A Files icon: 52px on phones, 64px from `sm` up.
  icon: { frame: "w-[52px] sm:w-[64px]", zoom: "[zoom:0.0707] sm:[zoom:0.087]" },
  // The Files Columns preview.
  preview: { frame: "w-[150px]", zoom: "[zoom:0.2038]" },
  // The Files Gallery stage.
  stage: { frame: "w-[230px]", zoom: "[zoom:0.3125]" },
} as const

/** How large a page thumbnail is drawn. */
export type PageThumbnailSize = keyof typeof PAGE_SIZES

/**
 * Draws a template's real first page on paper, shrunk the way a document
 * library shows its files; a generated document passes its template snapshot.
 * A page with nothing on it yet, or whose content could not be read, draws
 * blank.
 *
 * The page lays itself out at the preview's full 736px width and is zoomed to
 * the frame, so the frame's width and the zoom move together.
 *
 * @param props - The page's content and title, its size, and extra frame classes.
 * @returns A decorative page thumbnail.
 */
export function TemplatePageThumbnail({
  className,
  content,
  size = "card",
  title,
}: {
  className?: string
  content: TemplateContent | null
  size?: PageThumbnailSize
  title: string
}): ReactElement {
  const plan = content === null ? null : readFirstPage(content, title)
  const page = plan?.geometry ?? DEFAULT_PAGE

  return (
    // The card's title names the page, so its picture stays out of the
    // accessibility tree.
    <div
      aria-hidden="true"
      className={cn(PAPER_FRAME, PAGE_SIZES[size].frame, className)}
      data-document-surface="paper"
      data-slot="template-page"
      style={{ aspectRatio: `${page.widthPoints} / ${page.heightPoints}` }}
    >
      {plan === null ? null : (
        // The editor's frame and its dashed printable area do not belong on a
        // finished page.
        <div
          className={cn(
            "w-[736px] [&_article]:min-h-0 [&_article]:rounded-none [&_article]:border-0 [&_article]:shadow-none [&_article>div]:border-0",
            PAGE_SIZES[size].zoom
          )}
        >
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
