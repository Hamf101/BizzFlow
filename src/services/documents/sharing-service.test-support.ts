/**
 * A small in-memory Supabase stand-in for the sharing service's tests: it
 * answers the filters and writes the service uses, and access questions the
 * service asks the database (rpc) from a table the test fills in.
 */
export type FakeRow = Record<string, unknown>
type Filter = (row: FakeRow) => boolean
type Result = { data: unknown; error: null | { code?: string; message: string } }

class FakeQuery implements PromiseLike<Result> {
  private readonly filters: Filter[] = []
  private mode: "delete" | "insert" | "select" | "update" = "select"
  private values: FakeRow | FakeRow[] = {}

  constructor(
    private readonly rows: FakeRow[],
    private readonly seenWrites: string[],
    private readonly table: string
  ) {}

  select(): this {
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value)
    return this
  }

  in(column: string, values: readonly unknown[]): this {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }

  is(column: string, value: null): this {
    this.filters.push((row) => (row[column] ?? null) === value)
    return this
  }

  order(): this {
    return this
  }

  insert(values: FakeRow | FakeRow[]): this {
    this.mode = "insert"
    this.values = values
    return this
  }

  update(values: FakeRow): this {
    this.mode = "update"
    this.values = values
    return this
  }

  delete(): this {
    this.mode = "delete"
    return this
  }

  async maybeSingle(): Promise<Result> {
    const result = this.run()
    const rows = result.data as FakeRow[]

    return { data: rows[0] ?? null, error: result.error }
  }

  async single(): Promise<Result> {
    return this.maybeSingle()
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected)
  }

  private run(): Result {
    const matches = this.rows.filter((row) => this.filters.every((filter) => filter(row)))

    if (this.mode === "insert") {
      const inserted = (Array.isArray(this.values) ? this.values : [this.values]).map((row) => ({ ...row }))
      const clash = inserted.find((row) =>
        this.rows.some(
          (existing) =>
            existing.org_id === row.org_id &&
            (existing.document_id ?? existing.folder_id) === (row.document_id ?? row.folder_id) &&
            existing.user_id === row.user_id &&
            existing.organization_role === row.organization_role
        )
      )

      if (clash && "access_level" in clash) {
        return { data: null, error: { code: "23505", message: "duplicate key" } }
      }

      this.rows.push(...inserted)
      this.seenWrites.push(`insert ${this.table}`)
      return { data: inserted, error: null }
    }

    if (this.mode === "update") {
      for (const row of matches) Object.assign(row, this.values)
      this.seenWrites.push(`update ${this.table}`)
      return { data: matches, error: null }
    }

    if (this.mode === "delete") {
      for (const row of matches) this.rows.splice(this.rows.indexOf(row), 1)
      this.seenWrites.push(`delete ${this.table}`)
      return { data: matches, error: null }
    }

    return { data: matches.map((row) => ({ ...row })), error: null }
  }
}

export class SharingFakeClient {
  readonly writes: string[] = []

  /**
   * @param tables - Rows by table name.
   * @param access - What the database would answer for "can this person open
   *   this?", keyed `<person>:<item>`; anything missing is no access.
   */
  constructor(
    readonly tables: Record<string, FakeRow[]>,
    private readonly access: Record<string, "contributor" | "viewer"> = {}
  ) {}

  from(table: string): FakeQuery {
    this.tables[table] ??= []
    return new FakeQuery(this.tables[table], this.writes, table)
  }

  async rpc(_name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: null }> {
    const item = args.target_document_id ?? args.target_folder_id

    return { data: this.access[`${String(args.target_actor_user_id)}:${String(item)}`] ?? null, error: null }
  }
}
