import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getAuthenticatedWriteGrantStatements,
  getMigrationPath,
  getTableDefinition,
  normalizeSql,
} from "./migration-contract-helpers"

const migrationPath = getMigrationPath("20260730090000_sprint_9_tasks_reminders.sql")
const migrationSql = readFileSync(migrationPath, "utf8")
const normalizedSql = normalizeSql(migrationSql)
const taskTables = ["tasks", "task_reminders"] as const

describe("Sprint 9 tasks and reminders migration", () => {
  it("creates tenant-scoped tasks with the contracted columns", () => {
    const sql = normalizeSql(getTableDefinition(migrationSql, "tasks"))

    expect(sql).toContain("id uuid primary key default gen_random_uuid()")
    expect(sql).toContain(
      "org_id uuid not null references public.organizations (id) on delete cascade"
    )
    expect(sql).toContain("title text not null")
    expect(sql).toContain("description text")
    expect(sql).toContain("status text not null default 'open'")
    expect(sql).toContain("due_at timestamptz")
    expect(sql).toContain(
      "assigned_to uuid references public.profiles (id) on delete set null"
    )
    expect(sql).toContain(
      "assigned_by uuid references public.profiles (id) on delete set null"
    )
    expect(sql).toContain("assigned_at timestamptz")
    expect(sql).toContain(
      "submission_id uuid references public.submissions (id) on delete set null"
    )
    expect(sql).toContain("created_by uuid not null references public.profiles (id)")
    expect(sql).toContain("updated_by uuid not null references public.profiles (id)")
    expect(sql).toContain("completed_at timestamptz")
    expect(sql).toContain("revision integer not null default 1")
    expect(sql).toContain("created_at timestamptz not null default now()")
    expect(sql).toContain("updated_at timestamptz not null default now()")
    expect(sql).toContain("unique (id, org_id)")
  })

  it("constrains task text, status, revision, assignment, and completion", () => {
    const sql = normalizeSql(getTableDefinition(migrationSql, "tasks"))

    expect(sql).toContain(
      "check (title = btrim(title) and char_length(title) between 1 and 200)"
    )
    expect(sql).toContain(
      "check ( description is null or char_length(description) between 1 and 5000 )"
    )
    expect(sql).toContain(
      "check (status in ('open', 'in_progress', 'completed', 'cancelled'))"
    )
    expect(sql).toContain("check (revision > 0)")
    expect(sql).toContain(
      "( assigned_to is null and assigned_by is null and assigned_at is null )"
    )
    expect(sql).toContain(
      "( assigned_to is not null and assigned_by is not null and assigned_at is not null )"
    )
    expect(sql).toContain("(status = 'completed' and completed_at is not null)")
    expect(sql).toContain("(status <> 'completed' and completed_at is null)")
  })

  it("creates tenant-scoped reminders with the contracted columns", () => {
    const sql = normalizeSql(getTableDefinition(migrationSql, "task_reminders"))

    expect(sql).toContain("id uuid primary key default gen_random_uuid()")
    expect(sql).toContain(
      "org_id uuid not null references public.organizations (id) on delete cascade"
    )
    expect(sql).toContain("task_id uuid not null")
    expect(sql).toContain(
      "recipient_user_id uuid not null references public.profiles (id)"
    )
    expect(sql).toContain("remind_at timestamptz not null")
    expect(sql).toContain("channel text not null default 'email'")
    expect(sql).toContain("status text not null default 'pending'")
    expect(sql).toContain("attempt_count integer not null default 0")
    expect(sql).toContain("last_error text")
    expect(sql).toContain("sent_at timestamptz")
    expect(sql).toContain("created_by uuid not null references public.profiles (id)")
    expect(sql).toContain("created_at timestamptz not null default now()")
    expect(sql).toContain("updated_at timestamptz not null default now()")
  })

  it("keeps reminder scheduling idempotent and tenant-consistent", () => {
    const sql = normalizeSql(getTableDefinition(migrationSql, "task_reminders"))

    expect(sql).toContain("unique (task_id, recipient_user_id, remind_at)")
    expect(sql).toContain(
      "foreign key (task_id, org_id) references public.tasks (id, org_id) on delete cascade"
    )
    expect(sql).toContain("check (channel in ('email'))")
    expect(sql).toContain(
      "check (status in ('pending', 'sent', 'failed', 'cancelled'))"
    )
    expect(sql).toContain("check (attempt_count >= 0)")
    expect(sql).toContain(
      "check ( last_error is null or char_length(last_error) between 1 and 500 )"
    )
    expect(sql).toContain("(status = 'sent' and sent_at is not null)")
    expect(sql).toContain("(status <> 'sent' and sent_at is null)")
  })

  it("indexes the tenant list, assignee, due-date, and submission lookups", () => {
    expect(normalizedSql).toContain(
      "create index tasks_org_status_idx on public.tasks (org_id, status)"
    )
    expect(normalizedSql).toContain(
      "create index tasks_org_assigned_to_idx on public.tasks (org_id, assigned_to)"
    )
    expect(normalizedSql).toContain(
      "create index tasks_org_due_at_idx on public.tasks (org_id, due_at)"
    )
    expect(normalizedSql).toContain(
      "create index tasks_submission_id_idx on public.tasks (submission_id)"
    )
    expect(normalizedSql).toContain(
      "create index tasks_created_by_idx on public.tasks (created_by)"
    )
    expect(normalizedSql).toContain(
      "create index tasks_updated_by_idx on public.tasks (updated_by)"
    )
  })

  it("indexes the pending due scan and reminder foreign keys", () => {
    expect(normalizedSql).toContain(
      "create index task_reminders_due_pending_idx on public.task_reminders (remind_at) where status = 'pending'"
    )
    expect(normalizedSql).toContain(
      "create index task_reminders_org_idx on public.task_reminders (org_id)"
    )
    expect(normalizedSql).toContain(
      "create index task_reminders_task_id_idx on public.task_reminders (task_id)"
    )
    expect(normalizedSql).toContain(
      "create index task_reminders_recipient_user_id_idx on public.task_reminders (recipient_user_id)"
    )
    expect(normalizedSql).toContain(
      "create index task_reminders_created_by_idx on public.task_reminders (created_by)"
    )
  })

  it("enforces row level security on both tenant tables", () => {
    for (const tableName of taskTables) {
      expect(normalizedSql).toContain(
        `alter table public.${tableName} enable row level security`
      )
      expect(normalizedSql).toContain(
        `alter table public.${tableName} force row level security`
      )
      expect(normalizedSql).toContain(
        `revoke all on table public.${tableName} from public, anon, authenticated, service_role`
      )
      expect(normalizedSql).toContain(
        `grant select on table public.${tableName} to authenticated`
      )
      expect(normalizedSql).toContain(
        `grant select, insert, update on table public.${tableName} to service_role`
      )
    }

    expect(getAuthenticatedWriteGrantStatements(migrationSql, taskTables)).toEqual([])
  })

  it("scopes reads to active internal organization memberships", () => {
    expect(normalizedSql).toContain(
      "create policy tasks_select_internal_member on public.tasks for select to authenticated"
    )
    expect(normalizedSql).toContain(
      "create policy task_reminders_select_internal_member on public.task_reminders for select to authenticated"
    )
    expect(normalizedSql).toContain(
      "where membership.org_id = tasks.org_id and membership.user_id = (select auth.uid()) and membership.status = 'active' and membership.role in ('owner_admin', 'manager', 'staff')"
    )
    expect(normalizedSql).toContain(
      "where membership.org_id = task_reminders.org_id and membership.user_id = (select auth.uid()) and membership.status = 'active' and membership.role in ('owner_admin', 'manager', 'staff')"
    )
    expect(normalizedSql.match(/\(select auth\.uid\(\)\)/g)).toHaveLength(2)
    expect(normalizedSql).toContain("notify pgrst, 'reload schema'")
  })
})
