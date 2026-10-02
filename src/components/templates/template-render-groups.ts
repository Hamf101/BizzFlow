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
 * Hands a row's layout to its grid: its columns as `--row-columns`, the space
 * above it as `--row-space`, and, for a block alone on its line, where it sits
 * across the page as `--row-left` and `--row-width`. `ROW_GRID` reads them, so
 * a phone stacks the row and keeps its own rhythm, and from sm up it is laid
 * out as it prints.
 *
 * @param group - The row.
 * @returns Inline style carrying the row's layout.
 */
export function rowGridStyle(group: Pick<TemplateWebRenderGroup, "blocks" | "columns" | "widths">): CSSProperties {
  const first = group.blocks[0]
  const frame = group.columns === 1 ? first?.frame : null

  return {
    "--row-columns": rowGridColumns(group.columns, group.widths),
    ...(first?.spaceAbove ? { "--row-space": `${first.spaceAbove}pt` } : {}),
    ...(frame ? { "--row-left": `${frame.left}%`, "--row-width": `${frame.width}%` } : {}),
  } as CSSProperties
}

/** The classes that lay a row out by `rowGridStyle`'s properties. */
export const ROW_GRID =
  "grid min-w-0 grid-cols-1 sm:grid-cols-[var(--row-columns)] sm:mt-[var(--row-space,0)] sm:ml-[var(--row-left,0)] sm:w-[var(--row-width,100%)]"
