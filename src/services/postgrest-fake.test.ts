import { describe, expect, it } from "vitest"

import {
  PostgrestReadQuery,
  type FakeRow,
} from "@/services/postgrest-fake.test-support"

// Four rows with a null, a tie, and titles that exercise LIKE syntax.
const ROWS: FakeRow[] = [
  { due: "2026-09-02", id: "b", status: "open", title: "Chase references" },
  { due: null, id: "a", status: "open", title: "Collect 50% deposit" },
  { due: "2026-09-01", id: "c", status: "done", title: "Rename file_a" },
  { due: "2026-09-02", id: "d", status: "open", title: "Rename fileXa" },
]

function query(maxRows?: number): PostgrestReadQuery {
  return new PostgrestReadQuery(ROWS, maxRows)
}

async function readIds(
  pending: PromiseLike<{ data: FakeRow[] | null }>
): Promise<unknown[]> {
  return ((await pending).data ?? []).map((row: FakeRow): unknown => row.id)
}

describe("PostgrestReadQuery", () => {
  it("orders by several columns and puts nulls last when ascending", async () => {
    expect(
      await readIds(
        query().select().order("due", { ascending: true }).order("id", { ascending: true })
      )
    ).toEqual(["c", "b", "d", "a"])
  })

  it("puts nulls first when descending unless told otherwise", async () => {
    expect(
      await readIds(
        query().select().order("due", { ascending: false }).order("id", { ascending: true })
      )
    ).toEqual(["a", "b", "d", "c"])
    expect(
      await readIds(
        query()
          .select()
          .order("due", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true })
      )
    ).toEqual(["b", "d", "c", "a"])
  })

  it("counts every match before the range, and can answer with the count alone", async () => {
    expect(
      await query()
        .select("*", { count: "exact" })
        .eq("status", "open")
        .order("id", { ascending: true })
        .range(1, 1)
    ).toEqual({ count: 3, data: [ROWS[0]], error: null })
    expect(
      await query().select("id", { count: "exact", head: true }).eq("status", "open")
    ).toEqual({ count: 3, data: null, error: null })
  })

  it("never answers with more rows than its cap", async () => {
    expect((await query(2).select().limit(10)).data).toHaveLength(2)
  })

  it("answers an empty page at the end but refuses a counted range past it", async () => {
    expect(await query().select("*", { count: "exact" }).range(4, 5)).toEqual({
      count: 4,
      data: [],
      error: null,
    })
    expect(await query().select("*", { count: "exact" }).range(5, 6)).toEqual({
      count: null,
      data: null,
      error: { code: "PGRST103", message: "Requested range not satisfiable" },
    })
  })

  it("reads ILIKE patterns like PostgREST, with backslash escapes", async () => {
    expect(await readIds(query().select().ilike("title", "%50\\%%"))).toEqual(["a"])
    expect(await readIds(query().select().ilike("title", "%file\\_a%"))).toEqual(["c"])
    expect(
      await readIds(
        query().select().ilike("title", "%FILE_A%").order("id", { ascending: true })
      )
    ).toEqual(["c", "d"])
  })

  it("matches nothing for eq with null, as SQL's = NULL does, while is() finds nulls", async () => {
    expect(await readIds(query().select().eq("due", null))).toEqual([])
    expect(await readIds(query().select().is("due", null))).toEqual(["a"])
  })

  it("filters by comparisons, sets, and nulls", async () => {
    expect(
      await readIds(query().select().gte("due", "2026-09-02").order("id", { ascending: true }))
    ).toEqual(["b", "d"])
    expect(await readIds(query().select().lt("due", "2026-09-02"))).toEqual(["c"])
    expect(
      await readIds(query().select().in("id", ["a", "d"]).order("id", { ascending: true }))
    ).toEqual(["a", "d"])
    expect(await readIds(query().select().is("due", null))).toEqual(["a"])
    expect(
      await readIds(query().select().neq("status", "open"))
    ).toEqual(["c"])
  })

  it("keeps a row that matches any clause of an or() filter", async () => {
    expect(
      await readIds(
        query().select().or("id.eq.a,due.lte.2026-09-01").order("id", { ascending: true })
      )
    ).toEqual(["a", "c"])
  })

  it("returns one row or none from maybeSingle and refuses several", async () => {
    expect(await query().select().eq("id", "a").maybeSingle()).toEqual({
      data: ROWS[1],
      error: null,
    })
    expect(await query().select().eq("id", "missing").maybeSingle()).toEqual({
      data: null,
      error: null,
    })
    expect(
      (await query().select().eq("status", "open").maybeSingle()).error
    ).toMatchObject({ code: "PGRST116" })
  })

  it("requires exactly one row from single", async () => {
    expect((await query().select().eq("id", "a").single()).data).toEqual(ROWS[1])
    expect(
      (await query().select().eq("id", "missing").single()).error
    ).toMatchObject({ code: "PGRST116" })
  })
})
