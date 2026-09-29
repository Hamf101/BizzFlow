import type { CSSProperties } from "react"

import type { TemplateRenderBlock } from "@/services/templates/template-render-plan"

/** One contiguous field-group projection for web renderers. */
export type TemplateWebRenderGroup = Readonly<{
  id: string | null
  label: string | null
  columns: number
  widths: readonly number[] | null
  keepTogether: boolean
  blocks: readonly TemplateRenderBlock[]
}>

/**
 * Groups adjacent render blocks without changing their canonical order.
 *
 * Ungrouped blocks intentionally remain separate so pagination rules can be
 * applied to each block without introducing an artificial shared container.
 *
 * @param blocks - Visible, structurally decorated blocks from one section.
 * @returns Contiguous groups suitable for web preview and runtime markup.
 */
export function groupTemplateRenderBlocks(
  blocks: readonly TemplateRenderBlock[]
): TemplateWebRenderGroup[] {
  const groups: TemplateWebRenderGroup[] = []

  for (const block of blocks) {
    const priorGroup = groups.at(-1)

    if (
      block.fieldGroupId !== null &&
      priorGroup?.id === block.fieldGroupId
    ) {
      groups[groups.length - 1] = {
        ...priorGroup,
        keepTogether: priorGroup.keepTogether || block.keepTogether,
        blocks: [...priorGroup.blocks, block]
      }
      continue
    }

    groups.push({
      id: block.fieldGroupId,
      label: block.fieldGroupLabel,
      columns: block.fieldGroupColumns,
      widths: block.fieldGroupWidths,
      keepTogether: block.keepTogether,
      blocks: [block]
    })
  }

  return groups
}

/**
 * The CSS grid columns of a row: equal shares, or its widths in twelfths.
 *
 * @param columns - How many blocks the row sets side by side.
 * @param widths - Column widths in twelfths, or null for equal columns.
 * @returns A `grid-template-columns` value.
 */
export function rowGridColumns(columns: number, widths: readonly number[] | null): string {
  return widths
    ? widths.map((width: number): string => `minmax(0, ${width}fr)`).join(" ")
    : `repeat(${columns}, minmax(0, 1fr))`
}

/**
 * Hands a row's columns to its grid as `--row-columns`, so one class can
 * stack the row on a phone and set it side by side from sm up.
 *
 * @param group - The row.
 * @returns Inline style carrying the row's grid columns.
 */
export function rowGridStyle(group: Pick<TemplateWebRenderGroup, "columns" | "widths">): CSSProperties {
  return { "--row-columns": rowGridColumns(group.columns, group.widths) } as CSSProperties
}
