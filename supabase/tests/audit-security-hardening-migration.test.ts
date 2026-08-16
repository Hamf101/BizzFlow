import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getMigrationPath,
  normalizeSql,
} from "./migration-contract-helpers"

const auditSecurityHardeningMigrationPath = getMigrationPath(
  "20260718002902_audit_security_hardening.sql"
)

describe("Audit security hardening migration", () => {
  it("removes unsafe profile writes and anonymous legacy table privileges", () => {
    const sql = normalizeSql(
      readFileSync(auditSecurityHardeningMigrationPath, "utf8")
    )
    const legacyTables = [
      "profiles",
      "organizations",
      "organization_memberships",
      "invites",
      "audit_logs",
      "folders",
      "documents",
      "document_versions",
    ] as const

    expect(sql).toContain("drop policy if exists profiles_insert_self on public.profiles")
    expect(sql).toContain("drop policy if exists profiles_update_self on public.profiles")
    expect(sql).toContain(
      "revoke insert, update, delete on table public.profiles from authenticated"
    )
    legacyTables.forEach((tableName: (typeof legacyTables)[number]): void => {
      expect(sql).toContain(
        `revoke all privileges on table public.${tableName} from anon`
      )
    })
  })

  it("aligns template reads and hides private signing-recipient columns", () => {
    const sql = normalizeSql(
      readFileSync(auditSecurityHardeningMigrationPath, "utf8")
    )

    expect(sql).toContain(
      "and (select public.organization_role_for(org_id)) in ( 'owner_admin', 'manager', 'staff' )"
    )
    expect(sql).toContain(
      "revoke select on table public.document_signing_recipients from authenticated"
    )
    expect(sql).toContain(
      "grant select ( id, org_id, document_id, user_id, name, email, requires_signature, status, token_expires_at, invited_at, viewed_at, signed_at ) on table public.document_signing_recipients to authenticated"
    )
    expect(sql).not.toMatch(/grant select \([^;]*(token_hash|signature_data|initials_data)/)
  })

  it("replaces duplicate and mismatched indexes with query-shaped indexes", () => {
    const sql = normalizeSql(
      readFileSync(auditSecurityHardeningMigrationPath, "utf8")
    )

    expect(sql).toContain(
      "drop index if exists public.organization_memberships_org_user_idx"
    )
    expect(sql).toContain(
      "create unique index profiles_email_unique_idx on public.profiles (email) where email is not null"
    )
    expect(sql).toContain(
      "on public.organization_memberships (user_id, created_at, id) where status = 'active'"
    )
    expect(sql).toContain(
      "on public.invites (org_id, created_at desc, id) where status = 'pending'"
    )
    expect(sql).toContain(
      "on public.documents (org_id, created_at desc, id) where archived_at is null"
    )
  })

  it("accepts invites in one locked transaction callable only by service role", () => {
    const sql = normalizeSql(
      readFileSync(auditSecurityHardeningMigrationPath, "utf8")
    )

    expect(sql).toContain(
      "create or replace function public.accept_organization_invite( target_invite_id uuid, target_token text, target_user_id uuid, target_user_email text ) returns uuid language plpgsql security invoker set search_path = ''"
    )
    expect(sql).toContain(
      "where invite.id = target_invite_id and invite.token = target_token for update"
    )
    expect(sql).toContain("insert into public.profiles (id, email)")
    expect(sql).toContain("on conflict (org_id, user_id) do update")
    expect(sql).toContain("set status = 'accepted', accepted_by = target_user_id")
    expect(sql).toContain(
      "revoke execute on function public.accept_organization_invite( uuid, text, uuid, text ) from public, anon, authenticated"
    )
    expect(sql).toContain(
      "grant execute on function public.accept_organization_invite( uuid, text, uuid, text ) to service_role"
    )
  })

  it("serializes role changes and preserves one active owner", () => {
    const sql = normalizeSql(
      readFileSync(auditSecurityHardeningMigrationPath, "utf8")
    )

    expect(sql).toContain(
      "create or replace function public.update_organization_member_role( target_org_id uuid, target_membership_id uuid, target_actor_user_id uuid, target_role public.organization_role ) returns uuid language plpgsql security invoker set search_path = ''"
    )
    expect(sql).toContain(
      "from public.organizations organization where organization.id = target_org_id for update"
    )
    expect(sql).toContain(
      "where membership.id = target_membership_id and membership.org_id = target_org_id for update"
    )
    expect(sql).toContain("if active_owner_count <= 1 then")
    expect(sql).toContain("the organization must keep one owner.")
    expect(sql).toContain(
      "grant execute on function public.update_organization_member_role( uuid, uuid, uuid, public.organization_role ) to service_role"
    )
  })

  it("merges answer patches under lock and rejects completed answers", () => {
    const sql = normalizeSql(
      readFileSync(auditSecurityHardeningMigrationPath, "utf8")
    )

    expect(sql).toContain(
      "create or replace function public.merge_generated_document_answers( target_org_id uuid, target_document_id uuid, target_values jsonb ) returns jsonb language plpgsql security invoker set search_path = ''"
    )
    expect(sql).toContain(
      "from public.document_answers answer where answer.document_id = target_document_id and answer.org_id = target_org_id for update"
    )
    expect(sql).toContain("if existing_workflow_status = 'completed' then")
    expect(sql).toContain("set values = existing_values || target_values")
    expect(sql).toContain(
      "revoke execute on function public.merge_generated_document_answers( uuid, uuid, jsonb ) from public, anon, authenticated"
    )
    expect(sql).toContain(
      "grant execute on function public.merge_generated_document_answers( uuid, uuid, jsonb ) to service_role"
    )
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})
