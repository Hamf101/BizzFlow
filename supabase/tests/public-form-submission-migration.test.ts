import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { getMigrationPath, normalizeSql } from "./migration-contract-helpers"

const sql = normalizeSql(
  readFileSync(
    getMigrationPath("20260913102656_atomic_public_form_submission.sql"),
    "utf8"
  )
)
const signature =
  "function public.submit_public_form_entry( text, text, integer, uuid, text, uuid, integer, jsonb, jsonb, timestamptz )"

describe("atomic public form submission migration", () => {
  it("counts a submission in the same function that saves it, after the save", () => {
    const body = getFunctionBody()
    const lockLink = body.indexOf(
      "from public.public_form_links public_link where public_link.token = target_public_form_token for update"
    )
    const saveDraft = body.indexOf("update public.submissions submission")
    const saveNew = body.indexOf("insert into public.submissions")
    const count = body.indexOf(
      "set submission_count = public_link.submission_count + 1"
    )

    expect(lockLink).toBeGreaterThan(-1)
    expect(saveDraft).toBeGreaterThan(lockLink)
    expect(saveNew).toBeGreaterThan(lockLink)
    expect(count).toBeGreaterThan(Math.max(saveDraft, saveNew))
  })

  it("re-checks the link's ceiling and the draft revision under the lock", () => {
    const body = getFunctionBody()

    expect(body).toContain(
      "locked_link.submission_count >= locked_link.max_submissions"
    )
    expect(body).toContain("and submission.status = 'draft'")
    expect(body).toContain("and submission.revision = target_expected_revision")
    expect(body).toContain("using errcode = '55000'")
    expect(body).toContain("using errcode = '40001'")
  })

  it("refuses missing details before it locks or writes anything", () => {
    const body = getFunctionBody()

    expect(body.indexOf("using errcode = '22023'")).toBeGreaterThan(-1)
    expect(body.indexOf("using errcode = '22023'")).toBeLessThan(
      body.indexOf("for update")
    )
  })

  it("runs with the caller's privileges and an empty search path", () => {
    expect(sql).toContain(
      "returns public.submissions language plpgsql security invoker set search_path = ''"
    )
  })

  it("leaves the function executable only by service_role", () => {
    const revoke = `revoke all on ${signature} from public, anon, authenticated, service_role`
    const grant = `grant execute on ${signature} to service_role`

    expect(sql).toContain(revoke)
    expect(sql).toContain(grant)
    expect(sql.indexOf(grant)).toBeGreaterThan(sql.indexOf(revoke))
    expect(sql).not.toMatch(/grant [^;]* to (public|anon|authenticated)\b/)
  })

  it("keeps the old counter for builds deployed before this change", () => {
    expect(sql).not.toContain(
      "drop function public.increment_public_form_link_submission_count"
    )
  })

  it("reloads the PostgREST schema cache", () => {
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})

function getFunctionBody(): string {
  const start = sql.indexOf(
    "create or replace function public.submit_public_form_entry("
  )

  if (start < 0) {
    throw new Error("The migration does not define submit_public_form_entry.")
  }

  return sql.slice(start, sql.indexOf("$$;", start))
}
