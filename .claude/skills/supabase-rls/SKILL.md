---
name: supabase-rls
description: >-
  BizFlow Supabase multi-tenant security and RLS conventions. Use when writing SQL migrations,
  RLS policies, or database access that must be tenant-isolated — org_id scoping, the
  closed direct-access posture for signed-in users, the organization_memberships policy
  pattern, the four roles, and the migration security test
  (supabase/tests/migration-security.test.ts). Points to the vendored Supabase skills for
  general Postgres/Supabase guidance.
---

# BizFlow Supabase RLS & tenancy

Tenant data is protected in **two layers**:
1. **RLS enabled and forced** on every tenant-owned table (`org_id`) — a fail-closed backstop.
   Signed-in users (`authenticated`) hold **no** privileges on tenant tables, so the Data API
   answers them with `42501`; policies only matter if a privilege is ever granted.
2. **Application permission checks** in services (`requirePermission` +
   `canPerformOrganizationAction`) — the only path tenant data takes to signed-in users, through
   the service-role client, checked against the member's current role-definition permissions.

Never rely on frontend checks.

## Also read the vendored Supabase skills

General Supabase/Postgres mechanics (auth, JWT, storage grants, views, `SECURITY DEFINER`,
indexing, migrations, CLI) are already documented and **still authoritative**:

- `.agents/skills/supabase/SKILL.md` — auth/RLS/security checklist, CLI, MCP, migrations.
- `.agents/skills/supabase-postgres-best-practices/` — indexing, pagination, locks, RLS perf
  (see `references/security-rls-basics.md`, `security-rls-performance.md`).

This skill only adds **BizFlow-specific** rules on top. When they conflict on a general Postgres
point, the vendored skill wins; on BizFlow tenancy/roles, this file wins.

## Tenancy rules

- Every tenant-owned table has a non-null `org_id` and a UUID primary key.
- **Enable and force RLS on every such table.** Grant `service_role` only what the services
  need, and grant `anon`/`authenticated` nothing. New tables in `public` start without
  `anon`/`authenticated` privileges (migration `20260912194858` closed the default ACL).
- Index `org_id` and every foreign key. Add `organization_memberships(org_id, user_id)` and
  `(user_id)` indexes — RLS reads them on every query. Partial indexes for hot filtered reads
  (active/pending/non-archived).
- Tenant tables incl.: `organizations`, `profiles`, `organization_memberships`, `invites`,
  `folders`, `documents`, `document_versions`, `document_templates`, `submissions`,
  `submission_files`, `submission_comments`, `submission_activity_events`, `tasks`, `reminders`,
  `public_form_links`, `audit_logs`.

## If a feature ever needs user-token access

Direct access was closed because membership-only and legacy-role policies ignored editable role
permissions: a member whose role an Owner narrowed kept reading (and, for public links,
writing) through the Data API. Before granting `authenticated` any table privilege, the policy
must check the member's **current role-definition permissions**, and the grant needs its own
denial-after-revocation evidence. The membership predicate below is necessary but not
sufficient. Wrap `auth.uid()` in a `select` so Postgres caches it per statement:

```sql
alter table public.documents enable row level security;

create policy "members read tenant documents" on public.documents
for select to authenticated
using (
  exists (
    select 1 from public.organization_memberships m
    where m.org_id = documents.org_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  )
);
```

- **`for update` needs both `using` AND `with check`** (the check clause stops re-assigning a
  row to another org). An `UPDATE` also needs a matching `SELECT` policy or it silently affects
  0 rows.
- Treat RLS as *tenant* isolation and the service layer as *role/action* authorization — don't
  try to encode the full permission matrix in SQL.
- `TO authenticated` alone is not authorization (IDOR); always pair with the `org_id` predicate.

## Roles & permissions (application layer)

`src/lib/permissions.ts` is the source of truth. Roles: **`owner_admin`, `manager`, `staff`,
`external_reviewer`**. Actions are `<resource>:<view|manage>` (e.g. `templates:manage`,
`submissions:view`). In services:

```ts
const role = await requirePermission(client, orgId, actorUserId, "templates:manage", "You cannot manage document templates.")
if (!canPerformOrganizationAction(role, "templates:manage")) { /* narrower checks */ }
```
Add a new capability by extending `ORGANIZATION_PERMISSION_ACTIONS` and the per-role grant map —
don't scatter role string comparisons through the code. Assigning a role (invites) goes
through `canAssignOrganizationRole`: never Owner, and never beyond the actor's own permissions
or base row scope.

## Migrations & verification

- Create migration files with `supabase migration new <name>` (never hand-name them). Iterate
  schema with `execute_sql` / `supabase db query`, then generate the migration when stable — see
  the vendored Supabase skill for the exact commit flow and `supabase db advisors`.
- `supabase/tests/migration-security.test.ts` reads every migration, old and new, and fails if
  a table is left without enabled and forced RLS, if `authenticated` keeps or regains a table
  privilege, or if any non-trigger function stays executable by `public`, `anon`, or
  `authenticated`. A new migration needs no test of its own for that posture: revoke execute
  on each new function `from public, anon, authenticated` and the test stays green.
- `pnpm supabase:check` smoke-tests the live project with the service-role key after a hosted
  apply: tables, forced RLS on the purge tables, and the service-only functions' grants. It is
  not authorization proof for member sessions; the closed grants are.
- Behavior of individual SQL functions is proven against a real database by the
  `supabase/tests/*-live-rpc.sql` scripts (see README) and end to end by the Playwright suite.
- Any new tenant table needs a service test proving cross-org and permission denial (`403/404`).

## Client selection

- `src/lib/supabase/server.ts` — publishable-key client for **auth calls only** (sign-in,
  sign-up, session, sign-out). Never query tenant tables with it; `authenticated` has no table
  privileges.
- `src/lib/supabase/admin.ts` (`createAdminClient`) — service-role client used **inside
  services**, which is why the service layer must do its own `requirePermission` + `org_id`
  filtering: the admin client bypasses RLS, so services are the enforcement point.
- Never put the service-role/secret key in client code or any `NEXT_PUBLIC_` var.
