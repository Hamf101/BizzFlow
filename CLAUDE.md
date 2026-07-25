# BizFlow Docs

Mobile-first, multi-tenant business workflow portal: reusable forms/templates, generated
documents, file collection, signing, submission review, and audit trails. Two pilot
businesses share one system with **no per-tenant code**.

**Stack:** Next.js 16 (App Router, RSC) · React 19 · TypeScript (strict) · Tailwind v4 +
shadcn/ui (`base-nova`) · Zod v4 · Supabase (Postgres + Auth) · Cloudflare R2 (S3 API) ·
pdf-lib · Vitest · pnpm. Node ≥ 22.

## Commands

```bash
pnpm dev                      # local dev server
pnpm test                     # vitest run (whole suite)
pnpm vitest run <path>        # one test file (fast inner loop)
pnpm typecheck                # tsc --noEmit
pnpm lint                     # eslint
pnpm check:duplication        # jscpd — the 3% duplication budget
pnpm check                    # FULL gate: lint + typecheck + test + duplication + build + audit
pnpm supabase:check:rls       # credentialed RLS fixture (needs .env.local opt-in)
```

Run `pnpm check` before claiming a change is done. CI runs the same gate.

## Architecture — the golden rules

1. **Thin edges, fat services.** Route handlers and server actions only parse input, call a
   service, and translate the result. **All** business logic, permission checks, status
   transitions, and audit/activity events live in `src/services/`.
2. **Every tenant table carries `org_id` and has RLS.** Server code additionally enforces
   role/action permissions via `src/lib/permissions.ts`. Never rely on frontend checks alone.
3. **Files: bytes in R2 (private), metadata in Postgres.** Never expose a raw R2 URL; always
   go through a signed URL minted after a permission check.
4. **Deterministic + injectable.** Services take a `deps` object (`client`, `createId`, `now`,
   signers…) so tests inject fakes. Don't call `new Date()`/`randomUUID()` directly in logic.
5. **Zod validates at the boundary.** Parse untrusted input into typed values before use.

## Repo map

```
src/
  app/            # App Router: (auth), (dashboard), api/, sign/[token]
  components/     # ui/ (shadcn base-nova), + feature folders (documents, templates, submissions…)
  lib/            # supabase/{client,server,admin}, r2/, permissions, env, auth, utils(cn)
  services/       # domain logic. Each domain = a folder: contracts.ts, errors.ts, shared.ts,
                  # <feature>-service.ts, + a barrel <domain>-service.ts that re-exports it.
  types/          # Zod schemas + domain types (template.ts, submission.ts, signing.ts…)
```

## Domain quick facts

- **Roles** (`src/lib/permissions.ts`): `owner_admin`, `manager`, `staff`, `external_reviewer`.
  Permissions are `<resource>:<view|manage>` actions checked with `canPerformOrganizationAction`.
- **Submission state machine:** `draft → submitted → in_review → {needs_changes→submitted |
  approved→completed | rejected}`. Rejection/changes require a comment. Enforce transitions in
  the service, never ad hoc.
- Completed generated documents are immutable (create-only R2 object + atomically promoted
  version). Draft/awaiting-signature PDFs are `no-store` previews.

## Skills — load these for the deep "how", they don't sit in context until needed

| When you're… | Skill |
|---|---|
| adding/editing anything in `src/services/**` | `writing-services` |
| writing a `*.test.ts` (esp. faking Supabase) | `writing-tests` |
| committing / a check failed / DRYing code | `passing-checks` |
| editing components (`.tsx`, Tailwind, shadcn) | `ui-conventions` |
| touching uploads, signed URLs, object keys | `r2-storage` |
| SQL, RLS policies, tenant isolation | `supabase-rls` |

## Also

`.agent/AGENT.md` is the fuller product spec, sprint plan, and completion checklist (written for
Codex; still the source of truth for *what* to build). This file is the source of truth for
*how* the code is written. When they disagree on mechanics, this file wins.
