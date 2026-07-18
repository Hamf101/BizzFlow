# BizFlow Docs

BizFlow Docs is a mobile-first, multi-tenant workflow portal for reusable forms, generated documents, signing, document collection, submissions, tasks, reminders, and public form links. The MVP is focused on proving that two pilot businesses can run repeatable document workflows in the same system without custom code.

## Current Status

- Project phase: implementation.
- Sprint: Sprint 8 submission assignment and review are implemented and migrated; Sprint 9 tasks and reminders are next.
- Application scaffold: Next.js App Router foundation with versioned documents, organization templates, guided signing/PDF workflows, creator-owned submission drafts, private verified files, and a tenant-scoped review inbox.
- Delivery direction: cloud-first. Offline/PWA work and related packages are deferred until explicitly reprioritized.
- Canonical project guide: `.agent/AGENT.md`.

## MVP Scope

The cloud MVP includes organizations, members, reusable templates, document storage, internal submissions, public submissions, review workflows, comments, tasks, reminders, activity history, audit logs, and email/SMS notifications. Offline drafts are deferred.

MVP non-goals:

- Billing and subscriptions.
- OCR/import conversion, AI extraction, and qualified or regulated e-signatures. Proposal-only AI block design and basic drawn acknowledgements are included.
- Native mobile apps.
- Advanced workflow builders or custom role builders.
- Public developer APIs.

## Planned Stack

- Frontend: Next.js App Router, React, TypeScript.
- UI: Tailwind CSS and shadcn/ui.
- Forms: React Hook Form and Zod.
- Backend: Next.js route handlers, server actions, and service functions.
- Database and auth: Supabase PostgreSQL, Supabase Auth, and Postgres RLS.
- Storage: Cloudflare R2 private buckets with signed URLs.
- Background jobs: Inngest.
- Notifications: Resend for email and Termii for initial SMS support.
- Offline: deferred; no PWA, service-worker, IndexedDB/Dexie, or desktop-runtime dependency is part of the current cloud build.
- Monitoring and analytics: Sentry plus PostHog or an internal event table.
- Hosting: Vercel, Supabase, Cloudflare R2, and Inngest.

## Local Development

This repository uses `pnpm` as the package manager. After the Next.js application is scaffolded, use:

```bash
pnpm install
pnpm dev
```

The local app is expected to run at `http://localhost:3000` unless the scaffold changes the default port.

Example API calls after the app is scaffolded:

```bash
curl -X POST http://localhost:3000/api/documents/upload-url \
  -H "Content-Type: application/json" \
  -H "Cookie: <authenticated Supabase cookies>" \
  -d '{
    "organizationId": "00000000-0000-0000-0000-000000000000",
    "folderId": null,
    "title": "Client Intake",
    "description": "Signed onboarding packet",
    "originalFilename": "client-intake.pdf",
    "contentType": "application/pdf",
    "byteSize": 1024
  }'

curl -X POST http://localhost:3000/api/documents/00000000-0000-0000-0000-000000000001/replace-upload-url \
  -H "Content-Type: application/json" \
  -H "Cookie: <authenticated Supabase cookies>" \
  -d '{
    "organizationId": "00000000-0000-0000-0000-000000000000",
    "originalFilename": "client-intake-v2.pdf",
    "contentType": "application/pdf",
    "byteSize": 2048
  }'

curl -X POST http://localhost:3000/api/submissions/00000000-0000-4000-8000-000000000010/files/upload-url \
  -H "Content-Type: application/json" \
  -H "Cookie: <authenticated Supabase cookies>" \
  -d '{
    "organizationId": "00000000-0000-4000-8000-000000000000",
    "expectedRevision": 1,
    "fieldKey": "supporting_document",
    "originalFilename": "evidence.pdf",
    "contentType": "application/pdf",
    "byteSize": 4096,
    "checksumSha256": "<lowercase SHA-256 of the exact file bytes>"
  }'
```

## Environment Variables

Use `.env.example` as the source of truth for required local variables. Copy it to `.env.local` after it exists:

```bash
cp .env.example .env.local
```

Expected variable groups:

- App: `NEXT_PUBLIC_APP_URL`.
- Scheduled maintenance: server-only `CRON_SECRET` (at least 16 random characters in Vercel).
- Supabase: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_URL`, and `SUPABASE_POOLER_URL`.
- Cloudflare R2: `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`, `CLOUDFLARE_R2_ENDPOINT`, `CLOUDFLARE_R2_REGION`, and `CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS`.
- File uploads: `FILE_UPLOAD_MAX_BYTES` and `FILE_UPLOAD_ALLOWED_MIME_TYPES`.
- Inngest: event key and signing key.
- Resend: `RESEND_API_KEY`, a verified `RESEND_FROM_EMAIL`, optional `RESEND_REPLY_TO_EMAIL`, and `RESEND_TIMEOUT_MS` for invitations and document signing links.
- OpenRouter: server-only `OPENROUTER_API_KEY`, optional `OPENROUTER_MODEL`, and `OPENROUTER_TIMEOUT_MS` for proposal-only template block suggestions.
- SMS: Termii credentials, with Africa's Talking placeholders reserved for a later provider switch.
- Observability: Sentry DSN and PostHog key or internal analytics settings.

Do not commit real secrets. Keep local secrets in `.env.local` and deployment secrets in the target hosting provider.

## Invite email setup

Inviting a person sends a Resend email containing a one-time BizFlow invite URL. The same Resend configuration delivers private, seven-day document signing links. Configure `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL` before using the People page or sending a document. Optionally set `RESEND_REPLY_TO_EMAIL` for recipient replies.

Recipients can create an account from the invite URL or sign in with an existing account. For account-confirmation links to return the recipient to their invite, add the deployed callback URL (for example, `https://app.example.com/auth/callback`) to Supabase Auth's Redirect URLs. The Supabase Site URL should be the deployed application origin.

For browser-based signed uploads and downloads, configure the private R2 bucket CORS policy to allow the deployed app origin, `PUT`, `GET`, and `HEAD` methods, plus the `content-type` and `if-none-match` request headers. Keep the bucket private; the app signs create-only object uploads server-side so a completed version cannot be overwritten by reusing its URL.

The server-side R2 token must permit private object reads, writes, and deletes. Submission upload URLs are capped at 15 minutes. `vercel.json` runs a protected daily cleanup for superseded objects after every issued URL and a safety buffer have elapsed; configure the same `CRON_SECRET` in the production Vercel environment before deployment.

## Supabase Migrations

Apply the Supabase migrations before using the dashboard pages:

```bash
npx supabase login
npx supabase link --project-ref tmciougnqzbopuqyuacu
npx supabase db push
```

If the CLI cannot be linked, open the Supabase SQL Editor and run the migration files in order:

```text
supabase/migrations/20260708170500_sprint_2_organizations_roles.sql
supabase/migrations/20260708174500_sprint_3_rls_permissions.sql
supabase/migrations/20260708190000_sprint_4_documents.sql
supabase/migrations/20260717190016_sprint_5_document_versioning_comments.sql
supabase/migrations/20260717193648_sprint_5_atomic_document_comments.sql
supabase/migrations/20260717194631_sprint_5_completion_archive_hardening.sql
supabase/migrations/20260717205037_document_templates_signing_recents.sql
supabase/migrations/20260718002902_audit_security_hardening.sql
supabase/migrations/20260718070000_generated_document_finalizations.sql
supabase/migrations/20260718171349_sprint_7_internal_submissions.sql
supabase/migrations/20260718175458_sprint_7_submission_function_hardening.sql
supabase/migrations/20260718180607_sprint_7_submission_drawing_values.sql
supabase/migrations/20260718181552_sprint_7_submission_upload_hardening.sql
supabase/migrations/20260718184631_sprint_7_submission_storage_cleanup.sql
supabase/migrations/20260718190946_sprint_8_submission_review_workflow.sql
supabase/migrations/20260718194429_sprint_8_submission_function_lint.sql
```

The Sprint 3 through Sprint 8 migrations include explicit Data API grants for `authenticated` and `service_role`, plus PostgREST schema-cache reloads. The guided-document migration adds organization-wide template revisions, immutable per-document snapshots, shared answers, unordered all-party signer state, per-user recent access, and tenant-scoped RLS. The audit hardening migration closes profile-email claiming and moves high-integrity mutations into transactional service-role RPCs. The finalization migration promotes one deterministic, create-only R2 PDF to an exact immutable document version. Sprint 7 adds role-aware submissions, immutable template snapshots, optimistic draft revisions, checksum-bound create-only file allocations, recoverable file tombstones, expiry-safe object cleanup, and atomic create/save/submit RPCs with audit evidence. Sprint 8 adds assignment, requested-change resubmission, binding manager decisions, immutable comments/activity, and assigned-only external-reviewer access.

## API Endpoints Summary

Implemented document routes:

- `POST /api/documents/upload-url`
- `POST /api/documents/:id/replace-upload-url`
- `POST /api/documents/:id/complete-upload`
- `POST /api/documents/:id/download-url` (JSON body with `organizationId` and optional `versionId`)
- `POST /api/documents/:id/opened`
- `GET /api/documents/:id/pdf` (no-store preview while editable; signed redirect to the exact finalized version after completion)
- `POST /api/templates/suggest-blocks`

Implemented internal-submission file routes:

- `POST /api/submissions/:id/files/upload-url`
- `POST /api/submissions/:id/files/:fileId/complete`
- `POST /api/submissions/:id/files/:fileId/download-url`
- `POST /api/submissions/:id/files/:fileId/supersede`

Internal scheduled maintenance:

- `GET /api/cron/submission-file-cleanup` (Vercel Cron only; requires `Authorization: Bearer $CRON_SECRET`)

Implemented guided-document pages:

- `/documents` for per-user recents, nested folder navigation, and folder-scoped creation.
- `/documents/new` for upload, published-template, or blank guided documents.
- `/documents/:id/edit` for shared answers, signing recipients, status, and PDF export.
- `/templates`, `/templates/new`, and `/templates/:id/edit` for organization template management.
- `/sign/:token` for private recipient review, field completion, and drawn acknowledgement.
- `/submissions` for creator lists, assigned external reviews, and the manager review inbox.
- `/submissions/new` for starting a draft from a published template.
- `/submissions/:id` for draft/resubmission editing, verified files, assignment, review decisions, comments, and activity history.

Planned routes may be adjusted during implementation.

Organizations and access:

- `POST /api/organizations`
- `GET /api/organizations/current`
- `POST /api/invites`
- `GET /api/invites/:token`
- `POST /api/invites/:token/accept`
- `GET /api/members`
- `PATCH /api/members/:id/role`
- `PATCH /api/members/:id/disable`

Documents and folders:

- `GET /api/folders`
- `POST /api/folders`
- `PATCH /api/folders/:id`
- `DELETE /api/folders/:id`
- `GET /api/documents`
- `POST /api/documents`
- `GET /api/documents/:id`
- `POST /api/documents/:id/replace-upload-url`
- `POST /api/documents/:id/replace`
- `POST /api/documents/:id/archive`

Templates and submissions:

- `GET /api/templates`
- `POST /api/templates`
- `GET /api/templates/:id`
- `PATCH /api/templates/:id`
- `POST /api/templates/:id/duplicate`
- `POST /api/templates/:id/archive`
- `GET /api/submissions`
- `POST /api/submissions`
- `GET /api/submissions/:id`
- `PATCH /api/submissions/:id`
- `POST /api/submissions/:id/submit`
- `POST /api/submissions/:id/assign`
- `POST /api/submissions/:id/status`
- `POST /api/submissions/:id/file-upload-url`

Public forms:

- `POST /api/public-forms`
- `GET /api/public-forms/:token`
- `POST /api/public-forms/:token/submit`
- `POST /api/public-forms/:token/file-upload-url`
- `POST /api/public-forms/:id/disable`

Comments, tasks, and reminders:

- `GET /api/comments?target_type=submission&target_id=...`
- `POST /api/comments`
- `GET /api/tasks`
- `POST /api/tasks`
- `GET /api/tasks/:id`
- `PATCH /api/tasks/:id`
- `POST /api/tasks/:id/complete`
- `POST /api/reminders`
- `PATCH /api/reminders/:id`

Activity, audit, and background jobs:

- `POST /api/inngest`

## Verification Commands

Run the aggregate local quality gate before submitting changes:

```bash
pnpm check
```

The aggregate gate runs lint, strict TypeScript, unit/integration tests, production-code duplication detection, a production build, and a production dependency audit. When configured with local secrets, also run `pnpm supabase:check`.

The valid-RPC smoke test creates isolated synthetic rows inside one database statement, exercises the submission/file lifecycle plus assignment, review, comments, and resubmission, and removes the fixtures before returning:

```bash
set -a
source .env.local
npx supabase db query --db-url "$SUPABASE_DB_URL" --file supabase/tests/internal-submissions-live-rpc.sql
```

For effective submission RLS verification, provision the isolated owner, manager, staff, external-reviewer, and other-tenant synthetic fixtures documented by the fail-closed runner:

```bash
pnpm supabase:check:rls --help
pnpm supabase:check:rls
```

This runner uses ordinary publishable-key user sessions for tenant reads. It does not treat the service-role smoke test as authorization proof, create fixtures, or print credentials, tokens, fixture IDs, or returned row bodies. See `.env.example` and `pnpm supabase:check:rls --help` for the exact synthetic-only fixture keys.
