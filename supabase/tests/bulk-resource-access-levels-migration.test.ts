import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { getMigrationPath, normalizeSql } from "./migration-contract-helpers"

const sql = normalizeSql(
  readFileSync(
    getMigrationPath("20260914114326_bulk_resource_access_levels.sql"),
    "utf8"
  )
)
const resources = [
  { idColumn: "folder_id", kind: "folder", plural: "folders" },
  { idColumn: "document_id", kind: "document", plural: "documents" },
] as const

describe("bulk resource access levels migration", () => {
  it.each(resources)(
    "answers each $kind through the single-item rule, so the two cannot disagree",
    ({ idColumn, kind, plural }) => {
      const body = getFunctionBody(`get_${kind}_access_levels`)

      expect(sql).toContain(
        `returns table ( ${idColumn} uuid, access_level public.resource_access_level ) language plpgsql stable security invoker set search_path = ''`
      )
      expect(body).toContain(
        `private.effective_${kind}_access_level( target_org_id, requested.id, target_actor_user_id )`
      )
      // The bound comes before any lookup, so an oversized call costs nothing.
      expect(body.indexOf("using errcode = '22023'")).toBeGreaterThan(-1)
      expect(body.indexOf("using errcode = '22023'")).toBeLessThan(
        body.indexOf("return query")
      )
      expect(body).toContain(`if cardinality(target_${kind}_ids) > 1000 then`)
      // normalizeSql lowercases the whole file.
      expect(body).toContain(`'at most 1000 ${plural} per call.'`)
    }
  )

  it.each(resources)(
    "lets only the service role ask about $kind access",
    ({ kind }) => {
      const signature = `function public.get_${kind}_access_levels(uuid, uuid[], uuid)`

      expect(sql).toContain(
        `revoke all on ${signature} from public, anon, authenticated, service_role;`
      )
      expect(sql).toContain(`grant execute on ${signature} to service_role;`)
      expect(sql).not.toMatch(
        new RegExp(`grant [^;]* on ${escapeRegExp(signature)} to [^;]*\\b(anon|authenticated|public)\\b`)
      )
    }
  )
})

function getFunctionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  const end = sql.indexOf("$$;", start)

  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)

  return sql.slice(start, end)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
