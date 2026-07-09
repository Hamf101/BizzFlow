# BizFlow Docs

BizFlow Docs is a mobile-first, multi-tenant workflow portal for reusable forms, document collection, submissions, tasks, reminders, public form links, and offline drafts. The MVP is focused on proving that two pilot businesses can run repeatable document workflows in the same system without custom code.

## Current Status

- Project phase: implementation.
- Sprint: Sprint 4 document workflows implemented locally.
- Application scaffold: Next.js App Router foundation with dashboard document storage.
- Canonical project guide: `.agent/AGENT.md`.

## MVP Scope

The MVP includes organizations, members, reusable templates, document storage, internal submissions, public submissions, review workflows, comments, tasks, reminders, activity history, audit logs, email/SMS notifications, and offline draft support.

MVP non-goals:

- Billing and subscriptions.
- OCR, AI extraction, and e-signatures.
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
- Offline: PWA, IndexedDB, and Dexie.js.
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
```

## Environment Variables

Use `.env.example` as the source of truth for required local variables. Copy it to `.env.local` after it exists:

```bash
cp .env.example .env.local
```

Expected variable groups:

- App: `NEXT_PUBLIC_APP_URL`.
- Supabase: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_URL`, and `SUPABASE_POOLER_URL`.
- Cloudflare R2: `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`, `CLOUDFLARE_R2_ENDPOINT`, `CLOUDFLARE_R2_REGION`, and `CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS`.
- File uploads: `FILE_UPLOAD_MAX_BYTES` and `FILE_UPLOAD_ALLOWED_MIME_TYPES`.
- Inngest: event key and signing key.
- Resend: API key and sender address.
- SMS: Termii credentials, with Africa's Talking placeholders reserved for a later provider switch.
- Observability: Sentry DSN and PostHog key or internal analytics settings.

Do not commit real secrets. Keep local secrets in `.env.local` and deployment secrets in the target hosting provider.

For browser-based signed uploads and downloads, configure the private R2 bucket CORS policy to allow the deployed app origin, `PUT`, `GET`, and `HEAD` methods, and the `content-type` request header. Keep the bucket private; the app signs object access server-side.

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
```

The Sprint 3 and Sprint 4 migrations include explicit Data API grants for `authenticated` and `service_role`, plus PostgREST schema-cache reloads.

## API Endpoints Summary

Implemented document routes:

- `POST /api/documents/upload-url`
- `POST /api/documents/:id/complete-upload`
- `GET /api/documents/:id/download-url`

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

After the app is scaffolded and scripts are added to `package.json`, expected verification commands are:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use additional focused commands as features land, such as database migration checks, RLS policy tests, and end-to-end tests for auth, submissions, uploads, and offline drafts.
