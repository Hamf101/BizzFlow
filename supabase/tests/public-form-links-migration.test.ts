import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  getMigrationPath,
  getTableDefinition,
  normalizeSql,
} from "./migration-contract-helpers"

const migrationSql = readFileSync(
  getMigrationPath("20260730120000_sprint_11_public_form_links.sql"),
  "utf8"
)

const normalized = normalizeSql(migrationSql)
const migrationHistory = normalizeSql(
  readdirSync(join(process.cwd(), "supabase/migrations"))
    .filter((fileName: string): boolean => fileName.endsWith(".sql"))
    .sort()
    .map((fileName: string): string =>
      readFileSync(join(process.cwd(), "supabase/migrations", fileName), "utf8")
    )
    .join("\n")
)

describe("sprint 11 public form links migration contract", () => {
  it("defines public_form_links table with constraints and RLS", () => {
    const tableDef = getTableDefinition(migrationSql, "public_form_links")

    expect(tableDef).toContain("id uuid primary key default gen_random_uuid()")
    expect(tableDef).toContain(
      "org_id uuid not null references public.organizations (id) on delete cascade"
    )
    expect(tableDef).toContain("token text not null unique")
    expect(tableDef).toContain("status text not null default 'active'")
    expect(tableDef).toContain("submission_count integer not null default 0")
    expect(tableDef).toContain(
      "check (status in ('active', 'expired', 'disabled'))"
    )

    expect(normalized).toContain(
      "alter table public.public_form_links enable row level security"
    )
    expect(normalized).toContain(
      "create policy public_form_links_owner_admin_all"
    )
  })

  it("references the real templates relation", () => {
    // The templates table is public.document_templates. A foreign key against a
    // non-existent public.templates aborts the whole migration with 42P01.
    const tableDef = getTableDefinition(migrationSql, "public_form_links")

    expect(tableDef).toContain(
      "references public.document_templates (id, org_id)"
    )
    expect(normalized).not.toContain("references public.templates")
  })

  it("never grants anon a blanket read of every tenant's links", () => {
    // Postgres OR-combines permissive SELECT policies, so a policy without an
    // org_id predicate would override the org-scoped policy and expose every
    // organization's link tokens.
    expect(normalized).not.toContain("create policy public_form_links_anon_read")
    expect(normalized).not.toContain(
      "grant select on table public.public_form_links to anon"
    )
    expect(normalized).toContain(
      "revoke all on table public.public_form_links from anon"
    )
  })

  it("defines the atomic submission count increment RPC and keeps it off anon", () => {
    expect(normalized).toContain(
      "create or replace function public.increment_public_form_link_submission_count"
    )
    // The RPC consumes link capacity, so only the service-role client may call it.
    expect(normalized).toContain(
      "revoke all on function public.increment_public_form_link_submission_count(text) from public, anon, authenticated"
    )
    expect(normalized).not.toContain(
      "grant execute on function public.increment_public_form_link_submission_count(text) to anon"
    )
  })

  it("finishes with forced RLS and explicit Data API grants", () => {
    expect(migrationHistory).toContain(
      "alter table public.public_form_links force row level security"
    )
    expect(migrationHistory).toContain(
      "revoke all on table public.public_form_links from public, anon, authenticated, service_role"
    )
    expect(migrationHistory).toContain(
      "grant select, insert, update, delete on table public.public_form_links to authenticated"
    )
    expect(migrationHistory).toContain(
      "grant select, insert, update on table public.public_form_links to service_role"
    )
  })

  it("adds the public draft columns that parent anonymous uploads", () => {
    expect(normalized).toContain("add column public_form_link_id uuid")
    expect(normalized).toContain("add column public_draft_token text")
    expect(normalized).toContain(
      "create unique index submissions_public_draft_token_idx"
    )
    // The handle must look like the 32-byte hex token the service issues.
    expect(normalized).toContain("public_draft_token ~ '^[0-9a-f]{64}$'")
  })

  it("lets an actor-less public submission transition draft to submitted", () => {
    expect(normalized).toContain(
      "create or replace function public.enforce_submission_update()"
    )
    // The member path still requires an actor; only public rows are exempt.
    expect(normalized).toContain(
      "and new.submitted_by is null and new.public_form_link_id is null then"
    )
    expect(normalized).toContain(
      "raise exception 'submission actor is required when submitting.'"
    )
  })

  it("keeps the public draft handle single-use and the link binding immutable", () => {
    expect(normalized).toContain(
      "raise exception 'public draft token cannot be reassigned.'"
    )
    expect(normalized).toContain(
      "or new.public_form_link_id is distinct from old.public_form_link_id"
    )
  })
})
