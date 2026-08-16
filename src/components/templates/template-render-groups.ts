import type { TemplateRenderBlock } from "@/services/templates/template-render-plan"

/** One contiguous field-group projection for web renderers. */
export type TemplateWebRenderGroup = Readonly<{
  id: string | null
  label: string | null
  columns: 1 | 2
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
      keepTogether: block.keepTogether,
      blocks: [block]
    })
  }

  return groups
}
