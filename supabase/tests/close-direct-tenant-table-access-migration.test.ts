import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { getMigrationPath, normalizeSql } from "./migration-contract-helpers"

const MIGRATION_FILE = "20260912194858_close_direct_tenant_table_access.sql"
const migrationsDirectory = join(process.cwd(), "supabase/migrations")
const sql = normalizeSql(readFileSync(getMigrationPath(MIGRATION_FILE), "utf8"))

describe("close direct tenant table access migration", () => {
  it("revokes every table privilege any migration granted to signed-in users", () => {
    const granted = getTablesGrantedToSignedInUsers(getMigrationFileNames())
    const revoked = getRevokedTables()

    expect(granted.size).toBeGreaterThan(20)
    expect([...granted].filter((table) => !revoked.includes(table))).toEqual([])
  })

  it("keeps later migrations from granting signed-in table access again", () => {
    const laterMigrations = getMigrationFileNames().filter(
      (fileName) => fileName > MIGRATION_FILE
    )

    expect([...getTablesGrantedToSignedInUsers(laterMigrations)]).toEqual([])
  })

  it("starts future tables closed and leaves the policy helpers no signed-in caller", () => {
    expect(sql).toContain(
      "alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated"
    )

    for (const helper of [
      "is_organization_member",
      "organization_role_for",
      "shares_organization_with_profile",
    ]) {
      expect(sql).toContain(
        `revoke execute on function public.${helper}(uuid) from anon, authenticated`
      )
    }

    expect(sql).not.toContain("disable row level security")
  })
})

function getMigrationFileNames(): string[] {
  return readdirSync(migrationsDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort()
}

function getRevokedTables(): string[] {
  const match = sql.match(
    /revoke all privileges on table (.+?) from anon, authenticated;/
  )

  return match
    ? match[1].split(",").map((table) => table.trim().replace(/^public\./, ""))
    : []
}

// Blanket grants are recorded as "*" so they can never pass as covered.
function getTablesGrantedToSignedInUsers(
  fileNames: readonly string[]
): Set<string> {
  const tables = new Set<string>()

  for (const fileName of fileNames) {
    const statements = normalizeSql(
      readFileSync(join(migrationsDirectory, fileName), "utf8")
    ).split(";")

    for (const statement of statements) {
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
