/**
 * An in-memory stand-in for PostgREST reads, shared by service test harnesses.
 *
 * It answers the way PostgREST does at the edges services rely on: filters,
 * multi-column order with PostgreSQL's null placement, ranges and limits,
 * exact counts (count-only `head` requests included), at most `max_rows`
 * rows per response, 416 (PGRST103) for a counted range that starts past the
 * last matching row, and PGRST116 when `single` or `maybeSingle` receives the
 * wrong number of rows. Harnesses that also write extend it.
 */

/** Loosely typed in-memory database row. */
export type FakeRow = Record<string, unknown>

/** PostgREST error as supabase-js surfaces it. */
export type PostgrestFakeError = { code?: string; message: string }

/** What an awaited read resolves to. */
export type PostgrestFakeResult = {
  count: number | null
  data: FakeRow[] | null
  error: PostgrestFakeError | null
}

/** Rows PostgREST returns per response here (`max_rows` in supabase/config.toml). */
export const POSTGREST_MAX_ROWS = 1_000

type FakeOrder = { ascending: boolean; column: string; nullsFirst: boolean }
type RowFilter = (row: FakeRow) => boolean

const RANGE_NOT_SATISFIABLE: PostgrestFakeError = {
  code: "PGRST103",
  message: "Requested range not satisfiable",
}
const NOT_ONE_ROW: PostgrestFakeError = {
  code: "PGRST116",
  message: "JSON object requested, multiple (or no) rows returned",
}

/** A PostgREST-shaped read over in-memory rows. */
export class PostgrestReadQuery implements PromiseLike<PostgrestFakeResult> {
  protected readonly filters: RowFilter[] = []
  protected readonly orders: FakeOrder[] = []
  protected countRequested = false
  protected headOnly = false
  protected rangeBounds: { from: number; to: number } | null = null
  protected limitCount: number | null = null

  /**
   * @param rows - The table's rows; read when the query runs, so later
   *   inserts into the same array are seen.
   * @param maxRows - Largest response the fake server returns.
   */
  constructor(
    protected readonly rows: readonly FakeRow[],
    protected readonly maxRows: number = POSTGREST_MAX_ROWS
  ) {}

  select(
    ...args: [columns?: string, options?: { count?: "exact"; head?: boolean }]
  ): this {
    this.countRequested = args[1]?.count === "exact"
    this.headOnly = args[1]?.head === true
    return this
  }

  eq(column: string, value: unknown): this {
    return this.where((row: FakeRow): boolean => row[column] === value)
  }

  // SQL `<>` is unknown for a null cell, so nulls never match.
  neq(column: string, value: unknown): this {
    return this.where(
      (row: FakeRow): boolean => !isNull(row[column]) && row[column] !== value
    )
  }

  in(column: string, values: readonly unknown[]): this {
    return this.where((row: FakeRow): boolean => values.includes(row[column]))
  }

  is(column: string, value: boolean | null): this {
    return this.where((row: FakeRow): boolean => (row[column] ?? null) === value)
  }

  lt(column: string, value: unknown): this {
    return this.where((row: FakeRow): boolean => compareCell(row[column], value) < 0)
  }

  lte(column: string, value: unknown): this {
    return this.where((row: FakeRow): boolean => compareCell(row[column], value) <= 0)
  }

  gt(column: string, value: unknown): this {
    return this.where((row: FakeRow): boolean => compareCell(row[column], value) > 0)
  }

  gte(column: string, value: unknown): this {
    return this.where((row: FakeRow): boolean => compareCell(row[column], value) >= 0)
  }

  ilike(column: string, pattern: string): this {
    const matcher = likePatternToRegExp(pattern)

    return this.where((row: FakeRow): boolean => {
      const cell = row[column]
      return typeof cell === "string" && matcher.test(cell)
    })
  }

  /**
   * Keeps rows matching any `column.operator.value` clause. Only flat lists
   * are supported, which is all the services send.
   */
  or(clauses: string): this {
    const tests = clauses.split(",").map(parseOrClause)

    return this.where((row: FakeRow): boolean =>
      tests.some((test: RowFilter): boolean => test(row))
    )
  }

  order(
    column: string,
    options: { ascending?: boolean; nullsFirst?: boolean } = {}
  ): this {
    const ascending = options.ascending ?? true
    // PostgreSQL puts nulls last when ascending and first when descending.
    this.orders.push({ ascending, column, nullsFirst: options.nullsFirst ?? !ascending })
    return this
  }

  range(from: number, to: number): this {
    this.rangeBounds = { from, to }
    return this
  }

  limit(count: number): this {
    this.limitCount = count
    return this
  }

  async single(): Promise<{ data: FakeRow | null; error: PostgrestFakeError | null }> {
    const result = this.execute()

    if (result.error) {
      return { data: null, error: result.error }
    }

    const rows = result.data ?? []

    return rows.length === 1
      ? { data: rows[0] ?? null, error: null }
      : { data: null, error: NOT_ONE_ROW }
  }

  async maybeSingle(): Promise<{
    data: FakeRow | null
    error: PostgrestFakeError | null
  }> {
    const result = this.execute()

    if (result.error) {
      return { data: null, error: result.error }
    }

    const rows = result.data ?? []

    return rows.length > 1
      ? { data: null, error: NOT_ONE_ROW }
      : { data: rows[0] ?? null, error: null }
  }

  then<TResult1 = PostgrestFakeResult, TResult2 = never>(
    onfulfilled?:
      | ((value: PostgrestFakeResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  /** Rows that pass every filter, in table order. */
  protected matchingRows(): FakeRow[] {
    return this.rows.filter((row: FakeRow): boolean =>
      this.filters.every((filter: RowFilter): boolean => filter(row))
    )
  }

  /** Runs the read; harnesses that also write override this. */
  protected execute(): PostgrestFakeResult {
    const matching = this.matchingRows()

    if (
      this.countRequested &&
      this.rangeBounds !== null &&
      this.rangeBounds.from > matching.length
    ) {
      return { count: null, data: null, error: RANGE_NOT_SATISFIABLE }
    }

    const ordered = [...matching].sort((left: FakeRow, right: FakeRow): number =>
      this.compareRows(left, right)
    )
    const ranged =
      this.rangeBounds === null
        ? ordered
        : ordered.slice(this.rangeBounds.from, this.rangeBounds.to + 1)

    return {
      // PostgREST counts every match, before the page is cut.
      count: this.countRequested ? matching.length : null,
      data: this.headOnly
        ? null
        : ranged.slice(0, Math.min(this.limitCount ?? this.maxRows, this.maxRows)),
      error: null,
    }
  }

  private where(filter: RowFilter): this {
    this.filters.push(filter)
    return this
  }

  private compareRows(left: FakeRow, right: FakeRow): number {
    for (const order of this.orders) {
      const comparison = compareOrdered(left[order.column], right[order.column], order)

      if (comparison !== 0) {
        return comparison
      }
    }

    return 0
  }
}

/**
 * Converts an ILIKE pattern as PostgREST applies it: `%` (and PostgREST's
 * `*` alias) match any run, `_` matches one character, and a backslash makes
 * the next character literal.
 *
 * @param pattern - ILIKE pattern.
 * @returns A case-insensitive, fully anchored expression.
 */
export function likePatternToRegExp(pattern: string): RegExp {
  const escapeLiteral = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  let source = ""

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] ?? ""

    if (character === "\\" && index + 1 < pattern.length) {
      index += 1
      source += escapeLiteral(pattern[index] ?? "")
    } else if (character === "%" || character === "*") {
      source += ".*"
    } else if (character === "_") {
      source += "."
    } else {
      source += escapeLiteral(character)
    }
  }

  return new RegExp(`^${source}$`, "is")
}

function isNull(value: unknown): boolean {
  return value === null || value === undefined
}

// A comparison with a null cell is unknown in SQL, so it never matches;
// NaN keeps every comparison with it false.
function compareCell(cell: unknown, value: unknown): number {
  if (isNull(cell) || isNull(value)) {
    return Number.NaN
  }

  return typeof cell === "number" && typeof value === "number"
    ? cell - value
    : String(cell).localeCompare(String(value))
}

function compareOrdered(left: unknown, right: unknown, order: FakeOrder): number {
  if (isNull(left) || isNull(right)) {
    if (isNull(left) && isNull(right)) {
      return 0
    }

    return (isNull(left) ? -1 : 1) * (order.nullsFirst ? 1 : -1)
  }

  const comparison =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right))

  return order.ascending ? comparison : -comparison
}

function parseOrClause(clause: string): RowFilter {
  const [column = "", operator = "", ...rest] = clause.split(".")
  const value = rest.join(".")
  const text = (row: FakeRow): string | null =>
    isNull(row[column]) ? null : String(row[column])

  switch (operator) {
    case "eq":
      return (row: FakeRow): boolean => text(row) === value
    case "neq":
      return (row: FakeRow): boolean => {
        const cell = text(row)
        return cell !== null && cell !== value
      }
    case "lt":
      return (row: FakeRow): boolean => compareCell(text(row), value) < 0
    case "lte":
      return (row: FakeRow): boolean => compareCell(text(row), value) <= 0
    case "gt":
      return (row: FakeRow): boolean => compareCell(text(row), value) > 0
    case "gte":
      return (row: FakeRow): boolean => compareCell(text(row), value) >= 0
    case "is":
      return (row: FakeRow): boolean =>
        value === "null" ? isNull(row[column]) : text(row) === value
    default:
      throw new Error(`The fake does not support or() operator "${operator}".`)
  }
}
