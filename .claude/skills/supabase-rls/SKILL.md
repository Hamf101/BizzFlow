---
name: supabase-rls
description: >-
  BizFlow Supabase multi-tenant security and RLS conventions. Use when writing SQL migrations,
  RLS policies, or database access that must be tenant-isolated — org_id scoping, the
  organization_memberships policy pattern, the four roles, and the credentialed RLS test runner
  (scripts/check-supabase-rls.mjs). Points to the vendored Supabase skills for general
  Postgres/Supabase guidance.
---

# BizFlow Supabase RLS & tenancy

Tenant isolation is enforced in **two layers, both required**:
1. **RLS** on every tenant-owned table (`org_id`) — the database refuses cross-tenant rows.
2. **Application permission checks** in services (`requirePermission` +
   `canPerformOrganizationAction`) — the role/action authorization layer.

Never rely on one alone, and never rely on frontend checks.

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
- **Enable RLS on every such table**; add the membership policy below.
- Index `org_id` and every foreign key. Add `organization_memberships(org_id, user_id)` and
  `(user_id)` indexes — RLS reads them on every query. Partial indexes for hot filtered reads
  (active/pending/non-archived).
- Tenant tables incl.: `organizations`, `profiles`, `organization_memberships`, `invites`,
  `folders`, `documents`, `document_versions`, `document_templates`, `submissions`,
  `submission_files`, `submission_comments`, `submission_activity_events`, `tasks`, `reminders`,
  `public_form_links`, `audit_logs`.

## The membership policy pattern

Active-membership predicate, with `auth.uid()` wrapped in a `select` so Postgres caches it
per-statement:

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
- Scope writes to roles where appropriate, but treat RLS as *tenant* isolation and the service
  layer as *role/action* authorization — don't try to encode the full permission matrix in SQL.
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
don't scatter role string comparisons through the code.

## Migrations & verification

- Create migration files with `supabase migration new <name>` (never hand-name them). Iterate
  schema with `execute_sql` / `supabase db query`, then generate the migration when stable — see
  the vendored Supabase skill for the exact commit flow and `supabase db advisors`.
- **Prove isolation with the credentialed runner:**
  ```bash
  pnpm supabase:check:rls
  ```
  `scripts/check-supabase-rls.mjs` signs in as real fixture users across two orgs (owner,
  manager, staff, reviewer, actor A/B) and asserts: a member reads their org's rows, a member
  **cannot** read another org's rows, staff cannot perform manager/admin actions, and public
  tokens expose only their intended path. It is opt-in — requires the `BIZFLOW_RLS_*` env keys
  and `BIZFLOW_RLS_TEST_CONFIRM` in `.env.local`; it no-ops without them.
- Any new tenant table or policy must be covered by an isolation assertion (the runner, or a
  service test proving cross-org access throws `403/404`).

## Client selection

- `src/lib/supabase/server.ts` — RLS-bound server client for user-context reads/writes.
- `src/lib/supabase/admin.ts` (`createAdminClient`) — service-role client used **inside
  services**, which is why the service layer must do its own `requirePermission` + `org_id`
  filtering: the admin client bypasses RLS, so services are the enforcement point.
- Never put the service-role/secret key in client code or any `NEXT_PUBLIC_` var.
