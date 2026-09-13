import type { z } from "zod"

/** Awaited Next.js `searchParams`: one value, repeated values, or absent. */
export type RawSearchParams = Record<string, string | string[] | undefined>

/** Direction a list is ordered in. */
export type SortDirection = "asc" | "desc"

/** A list's ordering: one public sort key and its direction. */
export type ListSort<TSortKey extends string> = {
  direction: SortDirection
  key: TSortKey
}

type FilterSchemas = Record<string, z.ZodType>

/** Filter values a list accepts; an absent key means "not filtered". */
export type ListFilters<TFilters extends FilterSchemas> = {
  [TName in keyof TFilters]?: z.output<TFilters[TName]>
}

/** What one list offers in its URL. */
export type ListStateConfig<
  TFilters extends FilterSchemas,
  TSortKey extends string,
> = {
  /** Single-valued filters; a value that fails its schema is ignored. */
  filters: TFilters
  /** Allowed page sizes; the first is the default. */
  pageSizes: readonly [number, ...number[]]
  /** Offers `q`; longer queries are cut at `maxLength` characters. */
  search?: { maxLength: number }
  sort: {
    default: ListSort<TSortKey>
    keys: readonly [TSortKey, ...TSortKey[]]
  }
}

/** A list's complete, validated view. */
export type ListState<TFilters extends FilterSchemas, TSortKey extends string> = {
  filters: ListFilters<TFilters>
  /** One-based page number. */
  page: number
  pageSize: number
  /** Normalized search text; empty when absent or not offered. */
  query: string
  sort: ListSort<TSortKey>
}

/** A change to a list's view; any change other than `page` returns to page one. */
export type ListStatePatch<
  TFilters extends FilterSchemas,
  TSortKey extends string,
> = {
  filters?: ListFilters<TFilters>
  page?: number
  pageSize?: number
  query?: string
  sort?: ListSort<TSortKey>
}

/** Parses, serializes, and links one list's URL state. */
export type ListStateDefinition<
  TFilters extends FilterSchemas,
  TSortKey extends string,
> = {
  href: (
    pathname: string,
    state: ListState<TFilters, TSortKey>,
    patch?: ListStatePatch<TFilters, TSortKey>
  ) => string
  parse: (params: RawSearchParams) => ListState<TFilters, TSortKey>
  toSearchParams: (state: ListState<TFilters, TSortKey>) => URLSearchParams
}

/** Deepest page a list URL or service accepts; larger offsets are refused. */
export const MAX_LIST_PAGE = 10_000

const LIST_PARAMETERS = new Set(["page", "q", "size", "sort"])
const POSITIVE_INTEGER = /^[1-9]\d*$/

/**
 * Defines the URL state of one resource list.
 *
 * Reading is lenient: an invalid, empty, or unknown parameter falls back to the
 * default view, so a hand-edited or stale link still opens the list. Writing is
 * canonical: parameters appear in a fixed order and defaults are omitted, so an
 * equal view always has one URL and nothing outside the list's own parameters
 * (such as a spent `feedback` code) survives into a link.
 *
 * @param config - Filters, search, sort keys, and page sizes the list offers.
 * @returns Functions that parse, serialize, and link the list's state.
 * @throws Error when a filter name collides with a list parameter.
 */
export function defineListState<
  TFilters extends FilterSchemas,
  const TSortKey extends string,
>(
  config: ListStateConfig<TFilters, TSortKey>
): ListStateDefinition<TFilters, TSortKey> {
  const filterNames = Object.keys(config.filters) as Array<
    keyof TFilters & string
  >
  const collision = filterNames.find((name: string): boolean =>
    LIST_PARAMETERS.has(name)
  )

  if (collision) {
    throw new Error(`List filter "${collision}" collides with a list parameter.`)
  }

  const [defaultPageSize] = config.pageSizes
  const isSortKey = (key: string): key is TSortKey =>
    (config.sort.keys as readonly string[]).includes(key)

  function parseSort(value: string): ListSort<TSortKey> {
    const direction: SortDirection = value.startsWith("-") ? "desc" : "asc"
    const key = direction === "desc" ? value.slice(1) : value

    return isSortKey(key) ? { direction, key } : config.sort.default
  }

  function parse(params: RawSearchParams): ListState<TFilters, TSortKey> {
    const filters: ListFilters<TFilters> = {}

    for (const name of filterNames) {
      const value = firstValue(params[name])
      const result = value ? config.filters[name].safeParse(value) : null

      if (result?.success) {
        filters[name] = result.data as ListFilters<TFilters>[typeof name]
      }
    }

    const page = firstValue(params.page)
    const pageSize = firstValue(params.size)

    return {
      filters,
      page:
        POSITIVE_INTEGER.test(page) && Number(page) <= MAX_LIST_PAGE
          ? Number(page)
          : 1,
      pageSize:
        POSITIVE_INTEGER.test(pageSize) &&
        config.pageSizes.includes(Number(pageSize))
          ? Number(pageSize)
          : defaultPageSize,
      query: config.search
        ? normalizeQuery(firstValue(params.q), config.search.maxLength)
        : "",
      sort: parseSort(firstValue(params.sort)),
    }
  }

  function toSearchParams(
    state: ListState<TFilters, TSortKey>
  ): URLSearchParams {
    const params = new URLSearchParams()

    for (const name of filterNames) {
      const value: unknown = state.filters[name]

      if (value !== undefined && value !== null && value !== "") {
        params.set(name, String(value))
      }
    }

    if (config.search && state.query) {
      params.set("q", state.query)
    }

    if (
      state.sort.key !== config.sort.default.key ||
      state.sort.direction !== config.sort.default.direction
    ) {
      params.set("sort", formatListSort(state.sort))
    }

    if (state.pageSize !== defaultPageSize) {
      params.set("size", String(state.pageSize))
    }

    if (state.page > 1) {
      params.set("page", String(state.page))
    }

    return params
  }

  function href(
    pathname: string,
    state: ListState<TFilters, TSortKey>,
    patch: ListStatePatch<TFilters, TSortKey> = {}
  ): string {
    const changesView =
      patch.filters !== undefined ||
      patch.query !== undefined ||
      patch.sort !== undefined ||
      patch.pageSize !== undefined
    const search = toSearchParams({
      filters: patch.filters
        ? { ...state.filters, ...patch.filters }
        : state.filters,
      page: patch.page ?? (changesView ? 1 : state.page),
      pageSize: patch.pageSize ?? state.pageSize,
      query: patch.query ?? state.query,
      sort: patch.sort ?? state.sort,
    }).toString()

    return search ? `${pathname}?${search}` : pathname
  }

  return { href, parse, toSearchParams }
}

/**
 * Writes a sort as its URL value: the key, prefixed with `-` when descending.
 *
 * @param sort - Sort to write.
 * @returns URL value such as `due` or `-created`.
 */
export function formatListSort(sort: ListSort<string>): string {
  return `${sort.direction === "desc" ? "-" : ""}${sort.key}`
}

/**
 * Finds the last page that holds any item; an empty list still has page one.
 *
 * @param total - Items that match the list's filters.
 * @param pageSize - Items per page.
 * @returns One-based number of the last page.
 */
export function getLastPage(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""
}

// Control characters become spaces so words they separated stay apart, and the
// cap counts characters rather than UTF-16 units so an emoji is never split.
function normalizeQuery(value: string, maxLength: number): string {
  const collapsed = value
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()

  return Array.from(collapsed).slice(0, maxLength).join("").trimEnd()
}
