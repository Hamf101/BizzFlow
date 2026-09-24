/** One measured block, or blocks that move together, in the order they flow. */
export type PaginationUnit = Readonly<{
  height: number
  id: string
  keepWithNext: boolean
  pageBreakBefore: boolean
}>

/**
 * A page in CSS pixels. Margins are asked for per page, because a header or a
 * footer can take room on some pages and not others.
 */
export type PageFrame = Readonly<{
  gap: number
  height: number
  marginBottom: (pageIndex: number) => number
  marginTop: (pageIndex: number) => number
}>

/**
 * Lays measured blocks onto pages the way the paper will hold them: a block
 * that does not fit starts the next page, a page break always does, and a
 * block kept with the next one moves with it. The flow stays one column, and
 * each block that starts a page is pushed down by a spacer to that page's
 * content, so nothing is remounted and the caret never moves.
 *
 * @param units - Blocks in flow order, with their measured heights.
 * @param frame - The page's height, gap, and margins.
 * @returns How many pages are drawn, the page each block starts on, and the
 *   spacer before each block that starts a page, keyed by block id.
 */
export function paginate(
  units: readonly PaginationUnit[],
  frame: PageFrame
): { pageCount: number; pages: Record<string, number>; spacers: Record<string, number> } {
  const origin = (page: number): number => page * (frame.height + frame.gap)
  const top = (page: number): number => origin(page) + frame.marginTop(page)
  const bottom = (page: number): number =>
    origin(page) + frame.height - frame.marginBottom(page)
  const spacers: Record<string, number> = {}
  const pages: Record<string, number> = {}
  let page = 0
  let y = top(0)
  let empty = true

  units.forEach((unit: PaginationUnit, index: number): void => {
    const next = units[index + 1]
    const breaks =
      !empty &&
      (unit.pageBreakBefore ||
        y + unit.height > bottom(page) ||
        (unit.keepWithNext &&
          next !== undefined &&
          y + unit.height + next.height > bottom(page) &&
          unit.height + next.height <= bottom(page + 1) - top(page + 1)))

    if (breaks) {
      spacers[unit.id] = top(page + 1) - y
      page += 1
      y = top(page)
    } else if (y < top(page)) {
      // A block that ran past its page left the flow between two pages.
      spacers[unit.id] = top(page) - y
      y = top(page)
    }

    pages[unit.id] = page
    y += unit.height
    empty = false

    // ponytail: a block taller than a page runs on over the next one; split
    // long blocks by line if people start writing page-long paragraphs.
    while (y > bottom(page)) {
      page += 1
    }
  })

  return { pageCount: page + 1, pages, spacers }
}
