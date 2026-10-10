# BizFlow Docs

BizFlow Docs is a mobile-first, multi-tenant workflow portal for reusable forms, generated documents, signing, document collection, submissions, tasks, reminders, and public form links. The MVP is focused on proving that two pilot businesses can run repeatable document workflows in the same system without custom code.

## Current Status

- Project phase: implementation — nearing MVP completion.
- Built: versioned documents, organization templates, guided signing/PDF workflows, creator-owned submission drafts, private verified files, a tenant-scoped review inbox, tasks with Inngest reminders, public form links, template duplication, notification preferences, the Flow AI editor, and an append-only audit log with CSV export.
- SMS: the Termii adapter sends task notifications when configured (a mock stands in locally). Sending documents by SMS is not built yet.
- PostHog analytics is wired in but stays off unless `NEXT_PUBLIC_POSTHOG_KEY` is set.
- Offline sync is planned but not built: there is no service worker or local store. The app shows an offline banner, and the editors retry saving when the connection returns.

## MVP Scope

The MVP includes organizations, members, reusable templates, document storage, internal submissions, public submissions, review workflows, comments, tasks, reminders, activity history, audit logs, and email/SMS notifications.

MVP non-goals:

- Billing and subscriptions.
- OCR/import conversion, AI extraction, and qualified or regulated e-signatures. Conversational AI document editing and basic drawn acknowledgements are included.
- Native mobile apps.
- Advanced workflow builders or custom role builders.
- Public developer APIs.

## Stack

- Frontend: Next.js App Router, React, TypeScript.
- UI: Tailwind CSS and shadcn/ui.
- Forms: server actions and Zod.
- Backend: Next.js route handlers, server actions, and service functions.
- Database and auth: Supabase PostgreSQL, Supabase Auth, and Postgres RLS.
- Storage: Cloudflare R2 private buckets with signed URLs.
- Background jobs: Inngest.
- Notifications: EmailJS for transactional email and Termii for SMS.
- Monitoring and analytics: Sentry, plus PostHog when its key is set.
- Hosting: Vercel, Supabase, Cloudflare R2, and Inngest.

## Local Development

Install Node.js 24 and the pnpm version specified in `package.json`, then run:

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
# Fill in .env.local with your own service credentials before starting.
pnpm dev
```

The app runs at `http://localhost:3000`. Configure your own Supabase project and private R2 bucket using the sections below, and apply the database migrations before using the app. Optional integrations require their own credentials.

Personal editor/agent settings, local environments, and generated files are excluded from Git. Configure those tools yourself if needed. Shared build/test configuration, the dependency lockfile, and the credential-free `.env.example` stay versioned so fresh clones can be installed and checked. Run `pnpm check` locally before pushing; CI runs the same gate, plus the SQL tests and the end-to-end journeys, on every pull request and push to `main`. Next.js regenerates its type declarations during development, builds, and `pnpm typecheck`.

Example authenticated API calls:

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

Use `.env.example` as the source of truth for required local variables. Copy it to `.env.local`:

```bash
cp .env.example .env.local
```

Expected variable groups:

- App: `NEXT_PUBLIC_APP_URL`.
- Scheduled maintenance: server-only `CRON_SECRET` (at least 16 random characters).
- Supabase: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY`.
- Cloudflare R2: `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`, `CLOUDFLARE_R2_ENDPOINT`, `CLOUDFLARE_R2_REGION`, and `CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS`.
- File uploads: `FILE_UPLOAD_MAX_BYTES` and `FILE_UPLOAD_ALLOWED_MIME_TYPES`.
- Inngest: event key and signing key.
- Email: server-only EmailJS credentials, optional `EMAIL_REPLY_TO_EMAIL`, and `EMAIL_TIMEOUT_MS` for invitations, signing links, task assignments, and reminders.
- AI Flow: server-only `AI_PROVIDER`, `AI_MODEL`, `AI_TIMEOUT_MS`, optional `AI_EFFORT`, and the selected adapter's credential (`GEMINI_API_KEY` or `OPENROUTER_API_KEY`).
- SMS: `SMS_PROVIDER` (`termii` or `mock`; the mock is refused in production), `SMS_TIMEOUT_MS`, and the Termii credentials.
- Rate limiting: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` share one budget across instances; when unset, production counts per process and dev/CI do not limit. `CLIENT_IP_HEADER` and `TRUSTED_PROXY_COUNT` say which header your proxy sets and how many proxies append to it (see [Denial-of-service protection](#denial-of-service-protection)).
- Observability: Sentry DSNs, and the PostHog key and host (analytics stay off without the key).

Do not commit real secrets. Keep local secrets in `.env.local` and deployment secrets in the target hosting provider.

## AI-backed Flow document editor

The template studio includes a persistent Flow chat beside a single free-form document canvas. Blocks remain in one ordered flow inside the visible printable boundary—there are no fixed header, body, or footer regions. Flow can answer questions, create blocks, revise or move existing content, update document details and branding, and explain what it changed. Document actions are returned as compact structured operations, validated against the canonical Zod schemas, applied to the unsaved browser draft, highlighted in the page margin, and grouped into an undoable change receipt inside the conversation.

Gemini is the default AI adapter; OpenRouter is also registered. The Gemini adapter uses the official Google Gen AI SDK and stable Interactions API with provider-side storage disabled (`store: false`). Flow's business contract identifies models by provider plus exact model and never silently switches to another model. The application sends a bounded copy of its own Supabase-backed conversation history on each turn, so the team retains the template chat without relying on provider interaction retention. Flow cannot publish or archive a template. Existing logos and images are preserved unless removal is explicitly requested, and ambiguous destructive requests require confirmation.

Create a Gemini API key in Google AI Studio, restrict it to the Gemini API, and configure the server-only variables:

```bash
AI_PROVIDER=gemini
AI_MODEL=gemini-3.8-flash
AI_TIMEOUT_MS=90000
GEMINI_API_KEY=<your-key>
```

`AI_PROVIDER` defaults to `gemini`. Flow offers the models in `src/services/ai/approved-models.ts` (Gemini 3.8, 3.6 and 3.5 Flash), and each member picks one under Flow's message box; the choice is remembered on their device and the server refuses any model not on that list. `AI_MODEL` (default `gemini-3.8-flash`) covers requests that name no model, and `AI_TIMEOUT_MS` defaults to 90 seconds. An unregistered provider is rejected without fallback.

Restart the application after changing local environment values. In deployed environments, add the same values to the hosting provider and redeploy. Any active member with edit access to a template can use its shared Flow conversation.

Authenticated example:

```bash
curl -X POST http://localhost:3000/api/templates/flow \
  -H "Content-Type: application/json" \
  -H "Cookie: <authenticated Supabase cookies>" \
  -d '{
    "templateId": "00000000-0000-4000-8000-000000000010",
    "instruction": "Add a concise payment schedule after the introduction.",
    "draft": {
      "title": "Vendor agreement",
      "description": "Reusable service agreement",
      "content": "<the current schemaVersion 2 template content>"
    }
  }'
```

## Transactional email setup

Inviting a person sends an email containing a one-time BizFlow invite URL. The same server-side provider-neutral transport delivers private, seven-day document signing links, task assignments, and reminders without exposing tokens or provider credentials to browser code.

EmailJS is the only email provider. `EMAILJS_PRIVATE_KEY` is required in production. `EMAIL_TIMEOUT_MS` defaults to 10 seconds, and `EMAIL_REPLY_TO_EMAIL` can remain empty until a monitored reply address is available.

EmailJS setup:

1. Configure server-only `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, and `EMAILJS_PUBLIC_KEY`. If private-key authorization is enabled under Account → Security, also configure `EMAILJS_PRIVATE_KEY`.
2. In the selected EmailJS template, set **To Email** to `{{to_email}}`, **Subject** to `{{subject}}`, and the content source to `{{{message_html}}}`. Triple braces are required so the already-escaped application HTML is rendered instead of displayed as text.
3. Use the connected service's default From Email. Set the dashboard's From Name to the desired sender label. Leave Reply To empty when `EMAIL_REPLY_TO_EMAIL` is not configured.

The EmailJS REST API permits one request per second. BizFlow serializes sends within each running application instance so multi-recipient signing invitations do not burst through that limit. EmailJS has no idempotency-key guarantee.

The application owns the full branded HTML document (`wrapEmailDocument` in `src/services/email/html.ts`) and passes it to EmailJS along with a plain-text body. EmailJS receives the delivery reference for tracing without exposing raw tokens.

Recipients can create an account from the invite URL or sign in with an existing account. For account-confirmation links to return the recipient to their invite, add the deployed callback URL (for example, `https://app.example.com/auth/callback`) to Supabase Auth's Redirect URLs. The Supabase Site URL should be the deployed application origin.

For browser-based signed uploads and downloads, configure the private R2 bucket CORS policy to allow the deployed app origin, `PUT`, `GET`, and `HEAD` methods, plus the `content-type` and `if-none-match` request headers. Keep the bucket private; the app signs create-only object uploads server-side so a completed version cannot be overwritten by reusing its URL.

The server-side R2 token must permit private object reads, writes, and deletes. Submission upload URLs are capped at 15 minutes. `vercel.json` runs protected daily maintenance: superseded submission-file cleanup at `03:15 UTC` and bounded document/folder purge processing at `03:45 UTC`. Configure the same `CRON_SECRET` in the production Vercel environment before deployment.

## Supabase Migrations

Apply the Supabase migrations before using the dashboard pages:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

If the CLI cannot be linked, run the files in `supabase/migrations` in filename order in the Supabase SQL Editor.

`pnpm supabase:check` (`supabase migration list --linked`) shows which migrations the linked project has applied. After a schema change, run `pnpm db:types` to regenerate `src/types/database.ts` from the local stack; CI fails when it differs from what the migrations produce.

The document upload-authorization barrier migration (`20260803160319`) needed a one-off `reconcile_document_upload_authorization_barriers` run when it was first rolled out over existing data. `20261005110000_db_hygiene` drops that function, so a database that never ran it must do so before applying that migration; a fresh database needs no extra step.

## API Endpoints Summary

Implemented document routes:

- `POST /api/documents/upload-url`
- `POST /api/documents/:id/replace-upload-url`
- `POST /api/documents/:id/complete-upload`
- `POST /api/documents/:id/download-url` (JSON body with `organizationId` and optional `versionId`)
- `POST /api/documents/:id/opened`
- `GET /api/documents/:id/pdf` (no-store preview until finalized; signed redirect to the exact finalized version once the last signature, or the hourly Inngest sweep, has finalized it; reading never finalizes)
- `POST /api/templates/flow`

Implemented internal-submission file routes:

- `POST /api/submissions/:id/files/upload-url`
- `POST /api/submissions/:id/files/:fileId/complete`
- `POST /api/submissions/:id/files/:fileId/download-url`
- `POST /api/submissions/:id/files/:fileId/supersede`

Internal scheduled maintenance:

- `GET /api/cron/submission-file-cleanup` (scheduler only; requires `Authorization: Bearer $CRON_SECRET`)
- `GET /api/cron/document-purge` (scheduler only; bounded enqueue, R2 deletion, retry, and finalization; requires `Authorization: Bearer $CRON_SECRET`)

Implemented guided-document pages:

- `/documents` for per-user recents, nested folder navigation, and folder-scoped creation.
- `/documents/new` for upload, published-template, or blank guided documents.
- `/documents/:id/edit` for shared answers, signing recipients, status, and PDF export.
- `/templates`, `/templates/new`, and `/templates/:id/edit` for organization template management.
- `/sign/:token` for private recipient review, field completion, and drawn acknowledgement.
- `/submissions` for creator lists, assigned external reviews, and the manager review inbox.
- `/submissions/new` for starting a draft from a published template.
- `/submissions/:id` for draft/resubmission editing, verified files, assignment, review decisions, comments, and activity history.

## Denial-of-service protection

Host-independent, in the app (`src/lib/rate-limit.ts`, `src/lib/request-rate-limit.ts`):

- **Every request** spends a per-IP budget in `src/proxy.ts` before any session lookup or render. The editor's live sync and `/api/inngest` are exempt; they have their own limits.
- **Every signed-in API call and server action** spends a per-member budget; CSV exports get a smaller one.
- **Abuse-prone surfaces** (sign-in, public forms, signing, uploads, PDF, AI, email) have their own tighter buckets. Buckets that spend money with a third party fail closed if the limiter is down; the rest fail open.
- **JSON bodies** over 10 MB are refused without being read in full; server actions are capped at 10 MB.
- **No Redis:** production falls back to a per-process limiter (logged as `rate_limit_unconfigured`). Set the Upstash variables when running more than one instance.

Per-IP limits are only as good as the address they see: set `CLIENT_IP_HEADER` and `TRUSTED_PROXY_COUNT` to match the proxy in front of the app. Volumetric floods and slow-connection attacks (slowloris) are not something the app can absorb; run it behind a CDN, load balancer, or WAF that provides connection/read timeouts and network-level filtering.

## Verification Commands

Run the aggregate local quality gate before submitting changes:

```bash
pnpm check
```

The aggregate gate runs, in order: lint, typecheck, a test-integrity check (no committed `.only`/`.skip`/`.todo`), the Vitest suite, the duplication budget, dead-code detection (knip, including `knip --production`), the production build, the per-route JavaScript budget, and the production dependency audit.

PDF output is guarded by `src/services/document-pdf-fingerprint.test.ts`. When a change moves its hashes, render the sample with `RENDER_SAMPLE=1 pnpm vitest run src/services/document-pdf-fingerprint.test.ts`, look at it, then update the constant.

The database's own rules are proven against a real database by the scripts in `supabase/tests/`: access levels, sharing, submissions, signing, invites and public forms, each exercising the SQL functions directly, plus `catalog-security.sql`, which reads the migrated catalog and fails if a table in `public` or `private` lacks enabled and forced row-level security, if a non-trigger function is executable by `public`, `anon` or `authenticated` outside its justified allow-list, if a security definer function leaves `search_path` unset, if signed-in or anonymous callers hold any privilege on a relation (or by default on new ones), or if `realtime.messages` carries an unintended policy. Signed-in users have no direct Data API access to tenant tables: tenant data reaches them only through the service layer, which checks current role-definition permissions.

`pnpm test:sql` runs every script against the local stack (`pnpm e2e:up` or `supabase start`), each inside a transaction that is rolled back, and names each file that fails. CI runs it in the end-to-end job once Supabase is up. To aim it at another local stack, name its database container:

```bash
SUPABASE_DB_CONTAINER=supabase_db_<project_id> pnpm test:sql
```

### Customize workspace navigation

Right-click a sidebar tab and choose **Rename** to change its name for the workspace
(owner only; 1–40 characters). Drag a tab to reorder it, or use its actions menu
(**Move up** / **Move down**) or **Alt + Arrow Up/Down** while it has focus.
Order is saved separately for each member and workspace, including across devices.
Custom names and saved order also appear in mobile navigation. Apply database
migrations before deploying: navigation uses workspace labels and membership order.
