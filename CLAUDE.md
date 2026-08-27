# BizFlow Docs

Mobile-first, multi-tenant business workflow portal: reusable forms/templates, generated
documents, file collection, signing, submission review, and audit trails. Two pilot
businesses share one system with **no per-tenant code**.

**Stack:** Next.js 16 (App Router, RSC) · React 19 · TypeScript (strict) · Tailwind v4 +
shadcn/ui (`base-nova`) on Base UI · Zod v4 · Supabase (Postgres + Auth) · Cloudflare R2
(S3 API) · pdf-lib · Vitest · pnpm. Node ≥ 22.

**Forms are server actions, not React Hook Form.** RHF is not installed and should not be
added; progressive-enhancement server actions are the intended pattern here.

**`pdf-lib` is an alias.** `package.json` maps it to `npm:@cantoo/pdf-lib` — the maintained
fork — because upstream `pdf-lib` has had no release since July 2024. Imports still read
`from "pdf-lib"`; do not "fix" them.

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

pnpm e2e:up                   # local Supabase + MinIO, then write .env.e2e (needs Docker)
pnpm test:e2e                 # Playwright: the six pilot journeys
pnpm check:e2e                # build + test:e2e
pnpm e2e:down                 # tear both back down
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
6. **Never state a dependency fact from memory.** Before adding, upgrading, or recommending
   any package, query `https://registry.npmjs.org/<pkg>` and read the vendor's current docs.
   Check latest version, publish date, deprecation flag, and peer deps. Stars are not a
   maintenance signal — `pdf-lib` had 8.5k stars and no release for two years. The verified
   ledger with per-package gotchas lives in `.agent/AGENT.md` under "Dependency Ledger".
7. **Features are test-first.** Add a behavioral test and confirm it fails for the intended
   reason before changing production code. Then implement the smallest change that makes it
   pass and run the relevant negative/permission/tenant cases. A test is not evidence merely
   because it asserts a mock call or repeats implementation logic: it must prove meaningful
   output, persisted state, authorization, failure behavior, or an end-user outcome. When
   reviewing existing tests, strengthen any case that remains green after its claimed behavior
   is deliberately broken.

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

## End-to-end tests (`e2e/`)

Playwright covers the six journeys a pilot actually walks. It runs against a **fully local
stack** — no cloud credentials, in CI or on your machine:

- **Postgres + Auth:** `supabase start`, which applies every migration in `supabase/migrations`.
  `supabase/config.toml` disables Realtime, Studio and Supabase Storage (nothing uses them) and
  raises the sign-in rate limit, which the stock 30-per-5-minutes would otherwise trip mid-suite.
- **Object storage:** MinIO via `docker-compose.e2e.yml`. The R2 client already speaks the S3 API
  with `forcePathStyle`, so only the endpoint and credentials change. The setup project asserts
  the backend honours `IfNoneMatch: "*"` before any spec runs — completed documents depend on
  create-only writes for immutability.
- **Fixture:** `global.setup.ts` seeds one organization with a member per role and caches a
  signed-in browser state for each, so specs switch actors without re-authenticating. Specs share
  that tenant and run in parallel, so **every record a spec creates must use `uniqueName()`**.
- **Template content is seeded, not built through the editor.** The block editor is Phase 3's
  subject; pinning specs to today's markup would guarantee churn. Everything downstream of the
  content — publish, fill, upload, submit, review, sign — goes through the UI.
- Signing tokens are stored as a SHA-256 hash, so a test cannot read one back: `seedSigningDocument`
  chooses the plaintext and writes the hash. Public form tokens *are* plaintext.

`pnpm check` stays Docker-free so the commit loop stays fast; `pnpm check:e2e` and the `e2e` CI
job are where the browser suite is enforced.

PDF output has no committed reference renders any more, so `document-pdf-fingerprint.test.ts`
guards it instead: fixed `metadataTimestamp`, then page count, MediaBox and a SHA-256 per
decompressed content stream. A changed hash is not automatically a bug — render the sample with
`scripts/render-generated-document-sample.tsx`, look at it, then update the constant.

## Skills — load these for the deep "how", they don't sit in context until needed

| When you're… | Skill |
|---|---|
| adding/editing anything in `src/services/**` | `writing-services` |
| writing a `*.test.ts` (esp. faking Supabase) | `writing-tests` |
| committing / a check failed / DRYing code | `passing-checks` |
| editing components (`.tsx`, Tailwind, shadcn) | `ui-conventions` |
| touching uploads, signed URLs, object keys | `r2-storage` |
| SQL, RLS policies, tenant isolation | `supabase-rls` |

## What is deliberately NOT committed

These paths are gitignored and exist only on the maintainer's machine. Never `git add -f`
them, never reference their contents from committed files, and never assume a reader has
them:

`artifacts/` (audits, threat models, verification evidence) · `.planning/` (spikes, debug
notes) · `.agent/`, `.agents/`, `AGENTS.md` (agent guides) · `skills-lock.json`

A consequence worth knowing: the PDF reference renders that used to live in
`artifacts/verification/` are no longer available to CI. Any change to PDF output must be
guarded by a deterministic fingerprint test in the suite instead — render with a fixed
`metadataTimestamp`, then assert page count, MediaBox, and a hash of each decompressed
content stream.

## Also

`.agent/AGENT.md` is the fuller product spec, sprint plan, and completion checklist (written for
Codex; still the source of truth for *what* to build). It is local-only — see above. This file
is the source of truth for *how* the code is written. When they disagree on mechanics, this
file wins.
