# Sprint 3 RLS And Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden tenant isolation and role authorization for the organization foundation.

**Architecture:** Keep database tenant isolation in RLS, keep writes behind server-side services, and centralize role/action decisions in a pure permission matrix. Add UI guards as convenience only; server services and RLS remain the enforcement boundaries.

**Tech Stack:** Next.js App Router, TypeScript, Supabase PostgreSQL/RLS, shadcn/ui components, Vitest.

---

Last updated: 2026-07-08

## Scope

- Role/action permission matrix for organization actions.
- Role-based UI guard primitives.
- RLS hardening migration for existing tenant-owned tables.
- `audit_logs` table with tenant-scoped read policy and service-only writes.
- Audit log service helper and initial audit events for organization/member/invite workflows.
- Audit log page for owner/admin and manager visibility.

## Acceptance Criteria

- Users cannot read audit logs outside organizations where they are active members with an allowed role.
- Authenticated browser clients cannot directly insert/update organization memberships, invites, organizations, or audit logs.
- Staff cannot invite members, update roles, or view audit logs.
- Owner admins and managers can view audit logs.
- Organization, invite, invite acceptance, and role-update service actions write audit events.

## Verification Commands

```txt
corepack pnpm test
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

## Task Checklist

- [x] Add permission matrix tests and RLS migration coverage tests.
- [x] Implement role/action permission matrix.
- [x] Add `RoleGuard` and `PermissionButton`.
- [x] Add Sprint 3 Supabase migration for audit logs and RLS hardening.
- [x] Add audit service helper and audit event types.
- [x] Wire audit events into organization service actions.
- [x] Add audit log dashboard page.
- [x] Run fresh verification commands and record results.

## Verification Performed

- `corepack pnpm test`
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm build`
- `curl -I http://127.0.0.1:3000/audit-log` returns `307` to `/login?next=%2Faudit-log`.

## Pending Live Environment Check

- Add the exact Supabase dashboard server values to `.env.local`: `SUPABASE_SECRET_KEY`, and optionally `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_JWKS_URL` for parity with the dashboard.
- Apply `supabase/migrations/20260708170500_sprint_2_organizations_roles.sql`.
- Apply `supabase/migrations/20260708174500_sprint_3_rls_permissions.sql`.
- Verify signup, organization creation, invite creation, invite acceptance, role updates, and audit log visibility against the live Supabase project.
