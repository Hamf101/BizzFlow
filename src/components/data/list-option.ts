import { formatListSort, type ListSort } from "@/lib/list-state"

/** One choice in a list's filters or view menu: where it leads and whether it is current. */
export type ListOption = {
  /** Download the target instead of opening it, such as a CSV export. */
  download?: boolean
  href: string
  label: string
  selected: boolean
}

/** A labelled group of choices in a list's view menu. */
export type ListOptionSection = {
  label: string
  options: ListOption[]
}

/** One order a list offers, named as its view menu shows it. */
export type ListSortOption<TSortKey extends string> = {
  label: string
  sort: ListSort<TSortKey>
}

/** The orders a record list offers when it sorts by update, creation, or title. */
export const RECORD_SORT_OPTIONS: ReadonlyArray<
  ListSortOption<"created" | "title" | "updated">
> = [
  { label: "Recently updated", sort: { direction: "desc", key: "updated" } },
  { label: "Least recently updated", sort: { direction: "asc", key: "updated" } },
  { label: "Newest first", sort: { direction: "desc", key: "created" } },
  { label: "Oldest first", sort: { direction: "asc", key: "created" } },
  { label: "Title, A to Z", sort: { direction: "asc", key: "title" } },
  { label: "Title, Z to A", sort: { direction: "desc", key: "title" } },
]

/**
 * Builds a view menu's Sort section: one link per order, the current one
 * marked.
 *
 * @param options - The orders the list offers.
 * @param current - The view's order.
 * @param hrefFor - Builds the link to the view in another order.
 * @returns The Sort section.
 */
export function createSortSection<TSortKey extends string>(
  options: ReadonlyArray<ListSortOption<TSortKey>>,
  current: ListSort<TSortKey>,
  hrefFor: (sort: ListSort<TSortKey>) => string
): ListOptionSection {
  return {
    label: "Sort",
    options: options.map(
      ({ label, sort }: ListSortOption<TSortKey>): ListOption => ({
        href: hrefFor(sort),
        label,
        selected: formatListSort(current) === formatListSort(sort),
      })
    ),
  }
}
