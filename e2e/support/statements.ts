import { execFileSync } from "node:child_process"

// The local stack's database container, named from supabase/config.toml's project_id.
const DATABASE_CONTAINER = "supabase_db_BizzFlow"

function sql(query: string): string {
  return execFileSync(
    "docker",
    ["exec", DATABASE_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atc", query],
    { encoding: "utf8" }
  ).trim()
}

/** Forgets every statement the database has counted so far. */
export function resetStatements(): void {
  sql("select pg_stat_statements_reset()")
}

/**
 * Counts the requests that reached the database through PostgREST since the
 * last reset; each runs as one statement built around `pgrst_source`.
 *
 * @returns Requests since the last reset.
 */
export function countDatabaseRequests(): number {
  return Number(
    sql("select coalesce(sum(calls), 0) from pg_stat_statements where query ~ 'pgrst_source|pgrst_call'")
  )
}
