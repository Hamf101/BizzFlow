import type { CSSProperties, ReactElement } from "react"

import type { TemplateRenderPlan } from "@/services/templates/template-render-plan"
import type { TemplateLayout } from "@/types/template"
import { imageSource } from "@/types/template-images"

/**
 * The gap between one block and the next on a page-shaped surface: the
 * layout's paragraph spacing when it sets one, otherwise its density's.
 */
export const BLOCK_GAP: Readonly<Record<TemplateLayout["density"], string>> = {
  balanced: "gap-[var(--doc-paragraph-gap,0.75rem)]",
  comfortable: "gap-[var(--doc-paragraph-gap,1.25rem)]",
  compact: "gap-[var(--doc-paragraph-gap,0.375rem)]",
}

/**
 * A page-shaped surface's spacing and shape: its line and paragraph spacing,
 * and a page tall, or as many pages as reach its last placed picture.
 *
 * @param plan - The document as it renders.
 * @returns The paper's style.
 */
export function pageStyle(plan: TemplateRenderPlan): CSSProperties {
  const { geometry, layout } = plan
  const pages = Math.max(1, ...plan.blocks.map(({ block }) => (block.type === "image" ? (block.placement?.page ?? 1) : 1)))

  return {
    "--doc-line-height": layout.lineSpacing,
    "--doc-paragraph-gap": layout.paragraphSpacing === undefined ? undefined : `${layout.paragraphSpacing}pt`,
    aspectRatio: `${geometry.widthPoints} / ${geometry.heightPoints * pages}`,
  } as CSSProperties
}

/**
 * The margins around the writing on a page-shaped surface. A CSS percentage
 * margin on any side is a share of the width, so each side's points over the
 * page's width keep it true to the paper.
 *
 * @param plan - The document as it renders.
 * @returns The CSS margin.
 */
export function printableMargin(plan: TemplateRenderPlan): string {
  const { margins, widthPoints } = plan.geometry

  return [margins.top, margins.right, margins.bottom, margins.left].map((points) => `${(points / widthPoints) * 100}%`).join(" ")
}

/**
 * Pictures placed on the pages, drawn over a read-only surface in their
 * saved boxes. Offsets in percentages of the width stay in step with the
 * paper at any size.
 *
 * @param props - The document as it renders.
 * @returns The pictures.
 */
export function PlacedImages({ plan }: { plan: TemplateRenderPlan }): ReactElement {
  const tall = plan.geometry.heightPoints / plan.geometry.widthPoints

  return (
    <>
      {plan.blocks.map(({ block }) => {
        if (block.type !== "image" || !block.placement) {
          return null
        }

        const { height, page, width, x, y } = block.placement

        return (
          <div className="pointer-events-none absolute inset-x-0 top-0" key={block.id} style={{ paddingTop: `${((page - 1) * 100 + y) * tall}%` }}>
            <figure className="absolute m-0 flex flex-col" style={{ aspectRatio: `${width} / ${height * tall}`, left: `${x}%`, width: `${width}%` }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the author's own picture, already authorised */}
              <img alt={block.altText} className="min-h-0 w-full flex-1 object-contain" src={imageSource(block.asset, block.dataUrl) ?? undefined} />
              {block.caption ? <figcaption className="text-center text-xs text-muted-foreground">{block.caption}</figcaption> : null}
            </figure>
          </div>
        )
      })}
    </>
  )
}
