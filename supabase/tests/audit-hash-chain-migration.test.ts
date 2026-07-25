import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { getMigrationPath, normalizeSql } from "./migration-contract-helpers"

const migrationSql = readFileSync(
  getMigrationPath("20260725200000_audit_log_hash_chain.sql"),
  "utf8"
)
const normalizedSql = normalizeSql(migrationSql)
// Executable statements only: comments may mention digest() by name.
const executableSql = normalizeSql(migrationSql.replace(/--[^\n]*/g, ""))

describe("audit log hash chain migration", () => {
  it("adds the chain columns with genesis and format constraints", () => {
    expect(normalizedSql).toContain(
      "alter table public.audit_logs add column seq bigint, add column prev_hash text, add column entry_hash text"
    )
    expect(normalizedSql).toContain("alter column seq set not null")
    expect(normalizedSql).toContain("alter column entry_hash set not null")
    expect(normalizedSql).toContain(
      "add constraint audit_logs_genesis_prev_hash check ((seq = 1) = (prev_hash is null))"
    )
    expect(normalizedSql).toContain(
      "add constraint audit_logs_seq_positive check (seq >= 1)"
    )
    expect(normalizedSql).toContain("prev_hash ~ '^[0-9a-f]{64}$'")
    expect(normalizedSql).toContain("entry_hash ~ '^[0-9a-f]{64}$'")
    expect(normalizedSql).toContain(
      "create unique index audit_logs_org_seq_idx on public.audit_logs (org_id, seq)"
    )
  })

  it("digests through the extensions schema with jsonb canonicalization", () => {
    expect(executableSql).toContain("extensions.digest(")
    expect(executableSql).not.toMatch(/[^.a-z_]digest\(/)
    expect(normalizedSql).toContain("jsonb_build_array(")
    expect(normalizedSql).toContain(
      "to_char( entry_created_at at time zone 'utc', 'yyyy-mm-dd\"t\"hh24:mi:ss.us\"z\"' )"
    )
  })

  it("serializes inserts per organization with an advisory lock", () => {
    expect(normalizedSql).toContain(
      "pg_advisory_xact_lock( pg_catalog.hashtextextended('audit_logs:' || new.org_id::text, 0) )"
    )
    expect(normalizedSql).toContain(
      "create trigger audit_logs_chain_link before insert on public.audit_logs"
    )
  })

  it("hardens every function and blocks mutation", () => {
    const invokerCount = (
      normalizedSql.match(/security invoker set search_path = ''/g) ?? []
    ).length

    expect(invokerCount).toBe(4)
    expect(normalizedSql).toContain(
      "create trigger audit_logs_enforce_immutability before update or delete on public.audit_logs"
    )
    expect(normalizedSql).toContain("errcode = '23514'")
    expect(normalizedSql).toContain(
      "revoke all on function public.audit_logs_chain_link() from public, anon, authenticated, service_role"
    )
    expect(normalizedSql).toContain(
      "revoke all on function public.enforce_audit_log_immutability() from public, anon, authenticated, service_role"
    )
  })

  it("orders the backfill before the immutability trigger", () => {
    const backfillPosition = normalizedSql.indexOf(
      "update public.audit_logs audit_log set seq = ordered.position"
    )
    const immutabilityPosition = normalizedSql.indexOf(
      "create trigger audit_logs_enforce_immutability"
    )

    expect(backfillPosition).toBeGreaterThan(-1)
    expect(immutabilityPosition).toBeGreaterThan(backfillPosition)
  })

  it("locks chain verification down to the service role", () => {
    expect(normalizedSql).toContain(
      "create or replace function public.verify_audit_log_chain(target_org_id uuid)"
    )
    expect(normalizedSql).toContain("errcode = '22023'")
    expect(normalizedSql).toContain(
      "revoke all on function public.verify_audit_log_chain(uuid) from public, anon, authenticated"
    )
    expect(normalizedSql).toContain(
      "grant execute on function public.verify_audit_log_chain(uuid) to service_role"
    )
    expect(normalizedSql).toContain("notify pgrst, 'reload schema'")
  })
})
