import { MAX_LIST_PAGE, type ListSort } from "@/lib/list-state"

/** What one paged list accepts, and how its service refuses anything else. */
type ListInputRules<TSortKey extends string> = {
  /** Names the list in messages, such as "Task" or "Audit log". */
  label: string
  maxPageSize: number
  /** Longest search, in characters; a list without search accepts none. */
  maxSearchLength?: number
  sortKeys: readonly TSortKey[]
  /** Builds the service's own 400 error from a user-safe message. */
  reject: (message: string) => Error
}

/** Validators for one list's untrusted page, page size, order, and search. */
type ListInputValidators<TSortKey extends string> = {
  page: (value: number) => number
  pageSize: (value: number) => number
  search: (value: string | undefined) => string | null
  sort: (value: ListSort<string>) => ListSort<TSortKey>
}

/**
 * Builds the checks every paged list applies to its untrusted input, so each
 * service states only what differs: its name, largest page, search length,
 * orders, and error type.
 *
 * @param rules - The list's limits, orders, and error builder.
 * @returns Validators that return the value or throw the service's 400.
 */
export function createListInputValidators<TSortKey extends string>(
  rules: ListInputRules<TSortKey>
): ListInputValidators<TSortKey> {
  return {
    page: (value: number): number => {
      if (!Number.isInteger(value) || value < 1 || value > MAX_LIST_PAGE) {
        throw rules.reject(
          `${rules.label} page must be a whole number from 1 to ${MAX_LIST_PAGE}.`
        )
      }

      return value
    },
    pageSize: (value: number): number => {
      if (!Number.isInteger(value) || value < 1 || value > rules.maxPageSize) {
        throw rules.reject(
          `${rules.label} page size must be between 1 and ${rules.maxPageSize}.`
        )
      }

      return value
    },
    search: (value: string | undefined): string | null => {
      const search = value?.trim() ?? ""

      if (search === "") {
        return null
      }

      if (rules.maxSearchLength === undefined) {
        throw rules.reject(`${rules.label} list has no search.`)
      }

      // Counted in characters, so an emoji is one, not two UTF-16 units.
      if (Array.from(search).length > rules.maxSearchLength) {
        throw rules.reject(
          `${rules.label} search must be ${rules.maxSearchLength} characters or fewer.`
        )
      }

      return search
    },
    sort: (value: ListSort<string>): ListSort<TSortKey> => {
      const key = rules.sortKeys.find(
        (candidate: TSortKey): boolean => candidate === value.key
      )

      if (!key || (value.direction !== "asc" && value.direction !== "desc")) {
        throw rules.reject(`${rules.label} list order is not supported.`)
      }

      return { direction: value.direction, key }
    },
  }
}
