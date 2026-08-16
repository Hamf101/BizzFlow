import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getMigrationPath,
  getTableDefinition,
  normalizeSql,
} from "./migration-contract-helpers"

const migrationSql = readFileSync(
  getMigrationPath("20260801090000_sprint_10_notification_deliveries.sql"),
  "utf8"
)

const normalized = normalizeSql(migrationSql)

describe("sprint 10 notification deliveries migration contract", () => {
  it("adds organization-level notification switches defaulting to on", () => {
    // Defaulting to on keeps every existing tenant's behaviour unchanged.
    expect(normalized).toContain(
      "add column if not exists email_notifications_enabled boolean not null default true"
    )
    expect(normalized).toContain(
      "add column if not exists sms_notifications_enabled boolean not null default true"
    )
  })

  it("creates a tenant-scoped delivery table with RLS forced", () => {
    const tableDef = getTableDefinition(migrationSql, "notification_deliveries")

    expect(tableDef).toContain(
      "org_id uuid not null references public.organizations (id) on delete cascade"
    )
    expect(normalized).toContain(
      "alter table public.notification_deliveries enable row level security"
    )
    expect(normalized).toContain(
      "alter table public.notification_deliveries force row level security"
    )
  })

  it("stores no message content, phone number, or email address", () => {
    // Delivery history is operational evidence, not a copy of what was sent.
    const tableDef = getTableDefinition(
      migrationSql,
      "notification_deliveries"
    ).toLowerCase()

    for (const forbidden of ["body", "message", "phone", "email_address", "subject"]) {
      expect(tableDef).not.toContain(forbidden)
    }
  })

  it("constrains channel, status, and the failure/suppression pairing", () => {
    const tableDef = getTableDefinition(migrationSql, "notification_deliveries")

    expect(tableDef).toContain("check (channel in ('email', 'sms'))")
    expect(tableDef).toContain(
      "check (status in ('sent', 'failed', 'suppressed'))"
    )
    // A failure must say why; a suppression was never attempted so it must not.
    expect(tableDef).toContain("status = 'failed' and last_error is not null")
    expect(tableDef).toContain("status = 'suppressed' and last_error is null")
  })

  it("keeps writes off every client role", () => {
    expect(normalized).toContain(
      "revoke all on table public.notification_deliveries from public, anon, authenticated, service_role"
    )
    expect(normalized).toContain(
      "grant select on table public.notification_deliveries to authenticated"
    )
    // Read access is scoped to the roles that can already read the audit log.
    expect(normalized).toContain(
      "public.organization_role_for(org_id) in ('owner_admin', 'manager')"
    )
  })
})
