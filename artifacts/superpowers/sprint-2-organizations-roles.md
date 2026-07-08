# Sprint 2 Organizations And Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first multi-tenant organization layer so an owner can create an organization, invite staff, and manage member roles.

**Architecture:** Keep Next.js routes thin and move business rules into focused service modules under `src/services/`. Keep role decisions in a pure permission helper so access checks can be tested without Supabase. Store the tenant foundation in Supabase tables with UUID keys, timestamps, indexes, and RLS policies.

**Tech Stack:** Next.js App Router, TypeScript, Supabase PostgreSQL/Auth, shadcn/ui components, Zod, Vitest.

---

Last updated: 2026-07-08

## Scope

- `organizations`, `profiles`, `organization_memberships`, and `invites` schema.
- Role constants and permission helper for `owner_admin`, `manager`, `staff`, and `external_reviewer`.
- Organization creation flow for authenticated users without a current organization.
- People page with member list, invite form, and role update actions.
- Accept invite flow at `/accept-invite/[token]`.
- Dashboard shell updated for Sprint 2 navigation.

## Acceptance Criteria

- Owner can create an organization from the dashboard.
- Owner can invite staff by email.
- Owner can update member roles without removing the last owner.
- Invited users can accept a valid pending invite.
- Permission helper blocks staff from inviting members or changing roles.
- Schema includes tenant indexes and RLS policies for the Sprint 2 tables.

## Verification Commands

```txt
corepack pnpm test
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

## Task Checklist

- [x] Add Vitest and write failing permission tests.
- [x] Implement role and permission helper.
- [x] Add Supabase migration for organizations, profiles, memberships, invites, indexes, triggers, and RLS.
- [x] Add organization service functions for create, list context, invite, accept invite, and role update.
- [x] Add server actions and pages for organization setup, people management, and invite acceptance.
- [x] Update dashboard shell/status copy for Sprint 2.
- [x] Run fresh verification commands and record results here.

## Verification Performed

- `corepack pnpm test`
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm build`
- Added proxy protection test for `/people` redirect/session refresh coverage.
- `curl -I http://127.0.0.1:3000/people` returns `307` to `/login?next=%2Fpeople`.
- In-app browser smoke check for `/login`.
- In-app browser smoke check for `/dashboard` protected redirect.
- In-app browser smoke check for `/people` protected redirect.
- In-app browser smoke check for invalid `/accept-invite/not-a-real-token`.
- Mobile viewport smoke check for `/login` and invalid invite fallback.

## Pending Live Environment Check

- Apply `supabase/migrations/20260708170500_sprint_2_organizations_roles.sql` to a real Supabase project.
- Add real Supabase admin value to `.env.local`: `SUPABASE_SECRET_KEY`, and either `SUPABASE_DB_URL` or Supabase CLI project linkage for migration apply.
- Verify account signup, organization creation, invite creation, invite acceptance, and role update against Supabase.
