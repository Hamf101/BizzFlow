import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

type Migration = { fileName: string; sql: string }

const MIGRATIONS_DIRECTORY = join(process.cwd(), "supabase/migrations")
const CLOSE_DIRECT_ACCESS = "20260912194858_close_direct_tenant_table_access.sql"
const CALLERS = ["public", "anon", "authenticated"]

// Postgres makes a new function executable by public, and Supabase's default
// privileges add anon and authenticated; `create or replace` keeps whatever the
// function already had, and `drop` forgets it.
const FUNCTION_PRIVILEGE_EVENTS =
  /drop function (?:if exists )?public\.([a-z0-9_]+)|create (?:or replace )?function public\.([a-z0-9_]+) ?\(.*?\) returns (?:setof )?([a-z_.]+)|(grant|revoke) [a-z ,]+? on function (.+?) (?:to|from) ([a-z_, ]+?)(?: cascade)?;/g

// Every migration, oldest first, lowercased with comments dropped and runs of
// whitespace collapsed. Each check reads the whole history, so it covers a new
// migration the moment it lands.
const migrations: Migration[] = readdirSync(MIGRATIONS_DIRECTORY)
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort()
  .map((fileName) => ({
    fileName,
    sql: readFileSync(join(MIGRATIONS_DIRECTORY, fileName), "utf8")
      .replace(/--[^\n]*/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase(),
  }))
const closeSql =
  migrations.find(({ fileName }) => fileName === CLOSE_DIRECT_ACCESS)?.sql ?? ""
const allSql = migrations.map(({ sql }) => sql).join(" ")

describe("migration security posture", () => {
  it("revokes every table privilege any migration granted to signed-in users", () => {
    const granted = getTablesGrantedToSignedInUsers(migrations)
    const revoked = getRevokedTables()

    expect(granted.size).toBeGreaterThan(20)
    expect([...granted].filter((table) => !revoked.includes(table))).toEqual([])
  })

  it("keeps later migrations from granting signed-in table access again", () => {
    const later = migrations.filter(({ fileName }) => fileName > CLOSE_DIRECT_ACCESS)

    expect([...getTablesGrantedToSignedInUsers(later)]).toEqual([])
  })

  it("starts future tables closed to signed-in users", () => {
    expect(closeSql).toContain(
      "alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated"
    )
  })

  it("enables and forces row-level security on every table", () => {
    const tables = new Set<string>()

    for (const [, created, dropped] of allSql.matchAll(
      /create table (?:if not exists )?public\.([a-z0-9_]+)|drop table (?:if exists )?public\.([a-z0-9_]+)/g
    )) {
      if (created) {
        tables.add(created)
      } else {
        tables.delete(dropped)
      }
    }

    const alterations = [
      ...allSql.matchAll(
        /alter table (?:only )?(?:if exists )?public\.([a-z0-9_]+) ([^;]*);/g
      ),
    ]
    const unprotected = [...tables].filter((table) => {
      const actions = alterations
        .filter(([, name]) => name === table)
        .map(([, , action]) => action)
        .join(", ")

      return (
        !actions.includes("enable row level security") ||
        !/(?:^|, )force row level security/.test(actions)
      )
    })

    expect(tables.size).toBeGreaterThan(30)
    expect(unprotected).toEqual([])
    expect(allSql).not.toMatch(
      /disable row level security|no force row level security/
    )
  })

  it("leaves no function executable by public, anonymous, or signed-in callers", () => {
    const functions = new Map<string, { callers: Set<string>; trigger: boolean }>()

    for (const [, dropped, created, returns, action, targets, grantees] of allSql.matchAll(
      FUNCTION_PRIVILEGE_EVENTS
    )) {
      if (dropped) {
        functions.delete(dropped)
      } else if (created) {
        functions.set(created, {
          callers: functions.get(created)?.callers ?? new Set(CALLERS),
          trigger: returns === "trigger",
        })
      } else {
        for (const [, name] of targets.matchAll(/public\.([a-z0-9_]+) ?\(/g)) {
          for (const role of grantees.split(",").map((grantee) => grantee.trim())) {
            if (action === "revoke") {
              functions.get(name)?.callers.delete(role)
            } else if (CALLERS.includes(role)) {
              functions.get(name)?.callers.add(role)
            }
          }
        }
      }
    }

    // A trigger function cannot be called on its own.
    const callable = [...functions]
      .filter(([, fn]) => !fn.trigger && fn.callers.size > 0)
      .map(([name]) => name)

    expect(functions.size).toBeGreaterThan(50)
    expect(callable).toEqual([])
    expect(allSql).not.toMatch(/on all (?:functions|routines) in schema public to /)
  })
})

function getRevokedTables(): string[] {
  const match = closeSql.match(
    /revoke all privileges on table (.+?) from anon, authenticated;/
  )

  return match
    ? match[1].split(",").map((table) => table.trim().replace(/^public\./, ""))
    : []
}

// Blanket grants are recorded as "*" so they can never pass as covered.
function getTablesGrantedToSignedInUsers(
  sources: readonly Migration[]
): Set<string> {
  const tables = new Set<string>()

  for (const { sql } of sources) {
    for (const statement of sql.split(";")) {
      const grant = statement
        .trim()
        .match(/^grant (.+?) on (?:table )?(.+?) to (.+)$/)

      if (!grant || !/\bauthenticated\b/.test(grant[3])) {
        continue
      }

      if (grant[2].includes("all tables in schema public")) {
        tables.add("*")
        continue
      }

      for (const target of grant[2].split(",")) {
        const table = target.trim()

        if (table.startsWith("public.")) {
          tables.add(table.slice("public.".length))
        }
      }
    }
  }

  return tables
}
