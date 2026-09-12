import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getMigrationPath,
  normalizeSql,
  type MigrationFileName,
} from "./migration-contract-helpers"

const RECONCILE: MigrationFileName =
  "20260912202419_reconcile_template_visibility_and_role_protection.sql"
const VISIBILITY: MigrationFileName =
  "20260729122927_template_visibility_enforcement.sql"
const ROLES: MigrationFileName =
  "20260903115718_organization_roles_and_member_access.sql"

const reconcileSql = readMigration(RECONCILE)

describe("template visibility and role protection reconciliation migration", () => {
  it("re-applies every template-visibility function verbatim", () => {
    const source = getFunctionBodyHashes(readMigration(VISIBILITY))
    const reconciled = getFunctionBodyHashes(reconcileSql)

    expect(source.size).toBe(14)

    for (const [name, hash] of source) {
      expect(reconciled.get(name), name).toBe(hash)
    }
  })

  it("re-applies the fixed Owner-protection and role-archival functions verbatim", () => {
    const source = getFunctionBodyHashes(readMigration(ROLES))
    const reconciled = getFunctionBodyHashes(reconcileSql)

    for (const name of [
      "public.protect_owner_organization_role",
      "public.archive_organization_role",
    ]) {
      expect(reconciled.get(name), name).toBe(source.get(name))
    }
  })

  it("recreates the four visibility triggers and repeats only the source's one backfill", () => {
    const sql = normalizeSql(reconcileSql)

    for (const trigger of [
      "document_answers_apply_template_visibility",
      "submissions_validate_template_visibility",
      "submissions_cleanup_hidden_files",
      "submission_files_require_visible_field",
    ]) {
      expect(sql).toContain(`create trigger ${trigger}`)
    }

    expect(getTopLevelDataStatements(reconcileSql)).toEqual([
      "update public.submission_files submission_file",
    ])
    expect(getTopLevelDataStatements(readMigration(VISIBILITY))).toEqual(
      getTopLevelDataStatements(reconcileSql)
    )
  })

  it("grants nothing to signed-in or anonymous roles", () => {
    expect(normalizeSql(reconcileSql)).not.toMatch(
      /grant [^;]* to [^;]*\b(authenticated|anon)\b/
    )
  })
})

function readMigration(fileName: MigrationFileName): string {
  return readFileSync(getMigrationPath(fileName), "utf8")
}

function getFunctionBodyHashes(sql: string): Map<string, string> {
  const hashes = new Map<string, string>()
  const header = /create\s+or\s+replace\s+function\s+((?:public|private)\.\w+)\s*\(/gi

  for (const match of sql.matchAll(header)) {
    const rest = sql.slice(match.index)
    const open = rest.match(/\bas\s+(\$[a-z_]*\$)/i)

    if (!open || open.index === undefined) {
      continue
    }

    const start = open.index + open[0].length
    const end = rest.indexOf(open[1], start)

    hashes.set(
      match[1],
      createHash("md5").update(rest.slice(start, end)).digest("hex")
    )
  }

  return hashes
}

function getTopLevelDataStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) =>
      /^(alter table|create table|drop table|insert |update |delete |truncate )/i.test(
        line
      )
    )
}
