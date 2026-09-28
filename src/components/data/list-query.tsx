import { X } from "lucide-react"
import Link from "next/link"
import type { ReactElement } from "react"

/**
 * The words a list is narrowed to, from search or a saved view, since the
 * list has no search box of its own to show them in. Pressing it shows the
 * whole list again.
 *
 * @param props - The words, and the list's address without them.
 * @returns A chip that clears the words.
 */
export function ListQuery({ clearHref, query }: { clearHref: string; query: string }): ReactElement {
  return (
    <Link
      className="inline-flex h-9 max-w-full items-center gap-1.5 self-start rounded-full bg-secondary px-3 text-sm text-secondary-foreground outline-none transition-colors hover:bg-secondary/70 focus-visible:ring-2 focus-visible:ring-ring/35"
      data-slot="list-query"
      href={clearHref}
      title="Show everything"
    >
      <span className="truncate">Matching “{query}”</span>
      <X aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only">, show everything</span>
    </Link>
  )
}
