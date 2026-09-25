/** Where a page may end inside a block: a line, list item or table row, from the block's top. */
export type PaginationRow = Readonly<{ key: string; top: number }>

/** One measured block, or blocks that move together, in the order they flow. */
export type PaginationUnit = Readonly<{
  height: number
  id: string
  keepWithNext: boolean
  pageBreakBefore: boolean
  /** Only needed when the block is taller than a page. */
  rows?: readonly PaginationRow[]
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
 * block kept with the next one moves with it. A block taller than a page
 * breaks at its rows instead, so nothing ever runs past a page's bottom
 * margin. The flow stays one column, and whatever starts a page is pushed down
 * by a spacer to that page's content, so nothing is remounted and the caret
 * never moves.
 *
 * @param units - Blocks in flow order, with their measured heights.
 * @param frame - The page's height, gap, and margins.
 * @returns How many pages are drawn, the page each block starts on, the
 *   spacer before each block that starts a page, keyed by block id, and the
 *   spacer before each row that starts one, keyed by row.
 */
export function paginate(
  units: readonly PaginationUnit[],
  frame: PageFrame
): {
  inside: Record<string, number>
  pageCount: number
  pages: Record<string, number>
  spacers: Record<string, number>
} {
  const origin = (page: number): number => page * (frame.height + frame.gap)
  const top = (page: number): number => origin(page) + frame.marginTop(page)
  const bottom = (page: number): number =>
    origin(page) + frame.height - frame.marginBottom(page)
  const inside: Record<string, number> = {}
  const spacers: Record<string, number> = {}
  const pages: Record<string, number> = {}
  let page = 0
  let y = top(0)
  let empty = true

  units.forEach((unit: PaginationUnit, index: number): void => {
    const next = units[index + 1]
    // Too tall for any page: it breaks where it stands rather than moving whole.
    const splits = Boolean(unit.rows?.length) && unit.height > bottom(page + 1) - top(page + 1)
    const breaks =
      !empty &&
      (unit.pageBreakBefore ||
        (!splits && y + unit.height > bottom(page)) ||
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
    empty = false
    // Where this page's part of the block begins, from the block's top.
    let from = 0

    while (splits && y + unit.height - from > bottom(page)) {
      const last = unit.rows?.filter((row) => row.top > from && y + row.top - from <= bottom(page)).at(-1)

      if (last) {
        inside[last.key] = top(page + 1) - (y + last.top - from)
        from = last.top
      } else if (from === 0 && y > top(page)) {
        // Not even its first row fits here, so the block starts the next page.
        spacers[unit.id] = (spacers[unit.id] ?? 0) + top(page + 1) - y
        pages[unit.id] = page + 1
      } else {
        // ponytail: one row taller than a page (a table row with a page of
        // text in a cell) has nowhere to break and runs on; split cells by
        // line if that ever happens in real documents.
        break
      }

      page += 1
      y = top(page)
    }

    y += unit.height - from

    while (y > bottom(page)) {
      page += 1
    }
  })

  return { inside, pageCount: page + 1, pages, spacers }
}
