import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import type { ReactElement } from "react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const PAGE_LINK_CLASS = cn(
  buttonVariants({ size: "icon", variant: "ghost" }),
  "rounded-[10px]"
)

/**
 * States which items a page shows and links to its neighbouring pages.
 *
 * Renders nothing when every item fits on the first page. The links are plain
 * navigations to canonical list URLs, so paging works before hydration and any
 * page can be shared.
 *
 * @param props - Current page, page size, total, and neighbouring page links.
 * @returns Pagination navigation, or null for a single page.
 */
export function ListPagination({
  nextHref,
  page,
  pageSize,
  previousHref,
  total,
}: {
  nextHref: string | null
  page: number
  pageSize: number
  previousHref: string | null
  total: number
}): ReactElement | null {
  if (page === 1 && total <= pageSize) {
    return null
  }

  const first = Math.min((page - 1) * pageSize + 1, total)
  const last = Math.min(page * pageSize, total)

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3"
      data-slot="list-pagination"
    >
      <p className="text-sm text-muted-foreground tabular-nums">
        {first}–{last} of {total}
      </p>
      <div className="flex gap-1">
        {previousHref ? (
          <Link
            aria-label="Previous page"
            className={PAGE_LINK_CLASS}
            href={previousHref}
            rel="prev"
          >
            <ChevronLeft aria-hidden="true" />
          </Link>
        ) : null}
        {nextHref ? (
          <Link
            aria-label="Next page"
            className={PAGE_LINK_CLASS}
            href={nextHref}
            rel="next"
          >
            <ChevronRight aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </nav>
  )
}
