import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getMigrationPath,
  normalizeSql,
  type MigrationFileName,
} from "./migration-contract-helpers"

const RECONCILE: MigrationFileName =
  "20260912202419_reconcile_template_visibility_and_role_protection.sql"
const EXPIRY: MigrationFileName =
  "20260913105307_expire_abandoned_submission_files.sql"
const FILE_GUARD = "public.enforce_submission_file_update()"

const expiryRaw = readFileSync(getMigrationPath(EXPIRY), "utf8")
const expirySql = normalizeSql(expiryRaw)

// The only lines the expiry migration may add to the reconciled file guard.
const FILE_GUARD_EXPIRY_LINES = [
  "actorless_expiry_cleanup boolean := false;",
  "-- Expiry needs no caller context: an upload window that has elapsed can",
  "-- never complete, and a public draft whose handle was cleared can never be",
  "-- resumed or submitted.",
  "actorless_expiry_cleanup :=",
  "(old.status = 'upload_pending' and old.cleanup_after <= now())",
  "or exists (",
  "select 1",
  "from public.submissions submission",
  "where submission.id = old.submission_id",
  "and submission.org_id = old.org_id",
  "and submission.status = 'draft'",
  "and submission.public_form_link_id is not null",
  "and submission.created_by is null",
  "and submission.public_draft_token is null",
  ");",
  "and not actorless_expiry_cleanup",
]

describe("abandoned submission file expiry migration", () => {
  it("re-creates the file guard unchanged except for the expiry path", () => {
    const reconciled = getRawFunction(
      readFileSync(getMigrationPath(RECONCILE), "utf8"),
      FILE_GUARD
    )
    const recreated = getRawFunction(expiryRaw, FILE_GUARD)

    expect(getAddedLines(reconciled, recreated)).toEqual(FILE_GUARD_EXPIRY_LINES)
  })

  it("expires only public drafts nobody saved or uploaded to for a day, skipping locked ones", () => {
    const expiry = getFunction("public.expire_abandoned_submission_files(")

    expect(expiry).toContain("and submission.public_form_link_id is not null")
    expect(expiry).toContain("and submission.created_by is null")
    expect(expiry).toContain("and submission.public_draft_token is not null")
    expect(expiry).toContain(
      "and submission.updated_at <= now() - interval '24 hours'"
    )
    expect(expiry).toContain("and submission_file.cleanup_after > now()")
    expect(expiry).toContain("for update of submission skip locked")
  })

  it("clears a draft's handle before superseding its files, then releases dead uploads", () => {
    const expiry = getFunction("public.expire_abandoned_submission_files(")
    const clearHandle = expiry.indexOf("set public_draft_token = null")
    const supersede = expiry.indexOf("set status = 'superseded'")

    expect(clearHandle).toBeGreaterThan(-1)
    expect(supersede).toBeGreaterThan(clearHandle)
    expect(expiry).toContain(
      "where submission_file.status = 'upload_pending' and submission_file.cleanup_after <= now()"
    )
    expect(expiry).toContain("for update skip locked")
    expect(expiry).not.toContain("set cleanup_after")
    expect(expiry).not.toContain("delete from")
  })

  it("bounds each pass and refuses a missing batch size", () => {
    const expiry = getFunction("public.expire_abandoned_submission_files(")

    expect(expiry).toContain(
      "if target_batch_size is null or target_batch_size not between 1 and 1000 then"
    )
    expect(expiry.indexOf("using errcode = '22023'")).toBeLessThan(
      expiry.indexOf("for update")
    )
    expect(expiry.match(/limit target_batch_size/g)).toHaveLength(2)
  })

  it("runs with the caller's privileges and is executable only by service_role", () => {
    const signature = "function public.expire_abandoned_submission_files( integer )"

    expect(expirySql).toContain(
      "returns jsonb language plpgsql security invoker set search_path = ''"
    )
    expect(expirySql).toContain(
      `revoke all on ${signature} from public, anon, authenticated, service_role`
    )
    expect(expirySql).toContain(`grant execute on ${signature} to service_role`)
    expect(expirySql).toContain(
      "revoke all on function public.enforce_submission_file_update() from public, anon, authenticated, service_role"
    )
    expect(expirySql).not.toMatch(/grant [^;]* to (public|anon|authenticated)\b/)
    expect(expirySql).toContain("notify pgrst, 'reload schema'")
  })
})

function getFunction(signatureStart: string): string {
  const start = expirySql.indexOf(`create or replace function ${signatureStart}`)

  if (start < 0) {
    throw new Error(`The migration does not define ${signatureStart}.`)
  }

  return expirySql.slice(start, expirySql.indexOf("$$;", start))
}

function getRawFunction(sql: string, signature: string): string {
  const start = sql.lastIndexOf(`create or replace function ${signature}`)

  if (start < 0) {
    throw new Error(`Missing definition of ${signature}.`)
  }

  return sql.slice(start, sql.indexOf("\n$$;", start))
}

// Walks the changed body against the original: every original line must be
// kept, in order; whatever else appears is an addition.
function getAddedLines(original: string, changed: string): string[] {
  const originalLines = toTrimmedLines(original)
  const added: string[] = []
  let kept = 0

  for (const line of toTrimmedLines(changed)) {
    if (kept < originalLines.length && line === originalLines[kept]) {
      kept += 1
    } else {
      added.push(line)
    }
  }

  if (kept !== originalLines.length) {
    throw new Error(`Original line ${kept + 1} was changed or removed.`)
  }

  return added
}

function toTrimmedLines(sql: string): string[] {
  return sql
    .split("\n")
    .map((line: string): string => line.trim())
    .filter((line: string): boolean => line.length > 0)
}
