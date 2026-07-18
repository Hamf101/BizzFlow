# BizFlow Docs Agent Guide

Last updated: 2026-07-18

This is the working development guide for BizFlow Docs. Treat the pasted MVP requirements and this file as the source of truth for the project unless the user explicitly replaces them.

Important local context:

- Sprint 6 guided templates, signing, recent documents, and generated PDFs are implemented and migrated.
- The Next.js App Router foundation from Sprint 1 is scaffolded.
- Sprint 4 added tenant-scoped folders, documents, signed R2 upload/download routes, and document dashboard pages.
- Sprint 5 adds create-only, R2-verified replacement versions, transactionally paired comments/archive activity, member-visible timelines, and download audit events.
- `.agent/Project_inf.md` was stale context for another product and is no longer present. Do not recreate it unless it describes BizFlow.
- Existing local rules still apply: plan before non-trivial work, verify before completion claims, prefer simple designs, avoid speculative features, and keep work grounded in actual files.

## Product Summary

BizFlow Docs is a mobile-first, multi-tenant business workflow portal where teams create reusable forms, collect documents, assign submissions, review work, track tasks, send reminders, support public form links, and save offline drafts.

MVP goal:

1. Let two different pilot businesses use the same system without custom code.
2. Support reusable forms, document collection, review workflows, assignments, reminders, activity history, and public submissions.
3. Prove workflow value before adding billing, OCR, e-signatures, AI extraction, native mobile apps, advanced workflow builders, or public APIs.

## Chosen Stack

Use this stack unless the user explicitly changes it:

- Frontend: Next.js App Router, React, TypeScript
- UI: Tailwind CSS and shadcn/ui
- Forms: React Hook Form and Zod
- Backend: Next.js route handlers, server actions, and service functions
- Database: Supabase PostgreSQL
- Auth: Supabase Auth
- Tenant security: `org_id` on every tenant-owned table plus Supabase/Postgres RLS
- File storage: Cloudflare R2 private buckets with signed URLs
- Background jobs: Inngest first; reconsider Trigger.dev later for long-running OCR, AI, or heavy file workflows
- Email: Resend
- SMS: Termii initially; keep Africa's Talking as a later switch option
- Offline: deferred until the user explicitly reprioritizes it; do not add PWA, service-worker, IndexedDB/Dexie, or desktop-runtime packages for the current cloud build
- Monitoring: Sentry
- Analytics: PostHog or an internal event table
- Hosting: Vercel, Supabase, Cloudflare R2, Inngest

## Cloud-First Direction

The user superseded the local-first execution lock on 2026-07-18:

- BizFlow is currently a cloud application. Continue the hosted Next.js, Supabase, R2, and provider-backed MVP.
- Do not install PWA, service-worker, IndexedDB/Dexie, Tauri, or other offline-runtime packages unless the user explicitly reactivates that work.
- Spike 001 and the Offline Foundation documents remain valid research for a possible future offline phase. Their open PWA target-device gates do not block cloud feature work.
- The cloud remains authoritative. Every mutation and file operation must use the authenticated actor, current organization membership, server validation, idempotency where replay is possible, and durable audit evidence for high-integrity transitions.
- Before Sprint 7, close the highest-value cloud safety gaps that can be verified locally: R2 upload compatibility, exact-revision template publishing, and a two-tenant authenticated RLS test path. Run real browser-to-R2 UAT when deployment R2 credentials are available.
- Immutable generated-document finalization and signing evidence remain cloud hardening priorities; do not represent a mutable browser-rendered document as an immutable finalized record.

If offline work is reactivated, first review `artifacts/audits/BizzFlow-threat-model.md`, the preserved Spike 001 evidence, `artifacts/superpowers/offline-foundation-security-spike.md`, and `artifacts/superpowers/offline-foundation-plan.md`. Re-plan against the requirements current at that time instead of treating the old execution order as active.

## Architecture Rules

Keep responsibilities separated:

- Route handlers and server actions are thin. They parse input, call services, and return responses.
- Services contain business logic, permission checks, status transitions, audit/activity events, and integration coordination.
- Models and schemas live in typed TypeScript/Zod definitions.
- Database access is isolated behind Supabase helpers and service functions.
- Generic helpers live in `lib/` utilities.

If a FastAPI service is added later, apply the Python-specific clean architecture rules from the user instructions: thin FastAPI routes, service layer business logic, Pydantic models, typed functions, structured exceptions, logging, and dependency injection.

## Source Layout Target

After scaffolding, use this structure:

```txt
src/
  app/
    (auth)/
      login/
      signup/
      accept-invite/[token]/
    (dashboard)/
      dashboard/
      documents/
      documents/[id]/
      templates/
      templates/new/
      templates/[id]/edit/
      templates/[id]/preview/
      templates/[id]/submit/
      submissions/
      submissions/[id]/
      tasks/
      tasks/[id]/
      people/
      settings/
      audit-log/
    forms/
      [token]/
      [token]/success/
    api/
      organizations/
      invites/
      members/
      folders/
      documents/
      templates/
      submissions/
      comments/
      tasks/
      public-forms/
      reminders/
      inngest/
  components/
    layout/
    documents/
    templates/
    submissions/
    tasks/
    comments/
    public-forms/
    offline/
    ui/
  lib/
    supabase/
      client.ts
      server.ts
      admin.ts
    auth.ts
    permissions.ts
    r2.ts
    inngest.ts
    email.ts
    sms.ts
    audit.ts
    activity.ts
    validators.ts
    constants.ts
  services/
    organization-service.ts
    invite-service.ts
    member-service.ts
    document-service.ts
    folder-service.ts
    template-service.ts
    submission-service.ts
    task-service.ts
    reminder-service.ts
    public-form-service.ts
    notification-service.ts
    audit-service.ts
  inngest/
    client.ts
    functions/
      send-notification.ts
      process-reminders.ts
      cleanup-public-links.ts
      generate-export.ts
  offline/
    db.ts
    sync.ts
    queue.ts
  types/
    database.ts
    permissions.ts
    templates.ts
    submissions.ts
    tasks.ts
```

## Development Workflow

Use this workflow for every non-trivial change:

1. Read the relevant requirements and current implementation.
2. Write a short plan with acceptance criteria and verification commands.
3. Ask for plan approval unless the user explicitly told you to proceed.
4. After approval, pause for `/superpowers-execute-plan` unless the user explicitly says to proceed without it.
5. For sprint execution, use subagent-driven development when tasks are independent:
   - One implementer subagent per task.
   - Spec compliance review before code quality review.
   - Fix and re-review every issue before moving to the next task.
   - Do not dispatch parallel implementers that may touch the same files.
6. Verify with fresh commands before claiming completion.
7. Use conventional commit messages when committing.

Verification rule:

- No "done", "fixed", "passing", or equivalent completion claim without fresh evidence from a command, file check, or explicit checklist review.

## shadcn/ui Rules

After the Next.js app is scaffolded:

1. Run `npx shadcn@latest info --json` or the package-manager equivalent to inspect aliases, framework, Tailwind version, base, style, icon library, and installed components.
2. Use existing components first. Search the registry before custom UI.
3. Run `npx shadcn@latest docs <component>` before using unfamiliar components.
4. Do not import a component until it has been added to the project.
5. Use semantic tokens such as `bg-background`, `text-muted-foreground`, `bg-primary`, and component variants.
6. Use `gap-*`, not `space-x-*` or `space-y-*`.
7. Use `size-*` when width and height are equal.
8. Use `cn()` for conditional classes.
9. Use full Card composition: `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, and `CardFooter`.
10. Use `FieldGroup`, `Field`, `FieldLabel`, and validation attributes for forms.
11. Use `Badge` for statuses, `Alert` for callouts, `Empty` for empty states, `Skeleton` for loading, and `sonner` for toasts.
12. Dialogs, Sheets, and Drawers always need accessible titles.
13. Icons in buttons use the project icon library and `data-icon`; do not manually size icons inside components.

Core BizFlow UI components to build:

- `AppShell`
- `Sidebar`
- `Topbar`
- `RoleGuard`
- `PermissionButton`
- `FileUploader`
- `DocumentCard`
- `DocumentPreview`
- `TemplateFieldEditor`
- `TemplatePreview`
- `SubmissionStatusBadge`
- `SubmissionTimeline`
- `CommentThread`
- `TaskCard`
- `ReminderBadge`
- `PublicFormRenderer`
- `OfflineSyncStatus`

## Supabase/Postgres Rules

Schema principles:

- Use UUID primary keys.
- Add `org_id` to every tenant-owned table.
- Enable RLS on every tenant-owned table.
- Use RLS for tenant isolation and service-level permission helpers for role/action authorization.
- Do not rely only on frontend role checks.
- Index all foreign key columns.
- Use composite indexes for common multi-column filters.
- Use partial indexes for filtered queries such as active records, pending reminders, and non-deleted documents.
- Use cursor-based pagination for large lists.
- Use Supabase connection pooling for deployed server workloads.

RLS pattern:

```sql
exists (
  select 1
  from organization_memberships m
  where m.org_id = table.org_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
)
```

Performance notes:

- Wrap `auth.uid()` in `select` inside policies so Postgres can cache it per statement.
- Add indexes on columns referenced by RLS policies, especially `organization_memberships(org_id, user_id)` and `organization_memberships(user_id)`.
- Check generated plans with `EXPLAIN ANALYZE` for slow queries.

Required tenant tables:

- `organizations`
- `profiles`
- `organization_memberships`
- `invites`
- `folders`
- `documents`
- `document_versions`
- `templates`
- `template_fields`
- `submissions`
- `submission_files`
- `comments`
- `tasks`
- `reminders`
- `public_form_links`
- `activity_events`
- `audit_logs`

## Security And Storage

Cloudflare R2:

- Use private buckets only.
- Never expose raw R2 URLs.
- Backend checks permissions before creating signed upload or download URLs.
- Store file metadata in Postgres and object bytes in R2.

Initial file rules:

- Max file size: 20 MB.
- Allowed types: PDF, JPG, PNG, DOCX, XLSX, CSV.
- Block EXE, JS, SH, and unknown binaries.

Suggested object key patterns:

```txt
/orgs/{org_id}/documents/{document_id}/versions/{version_id}/{safe_filename}
/orgs/{org_id}/submissions/{submission_id}/files/{field_id}/{file_id}/{safe_filename}
/orgs/{org_id}/public-submissions/{submission_id}/files/{field_id}/{file_id}/{safe_filename}
```

## Roles

Hardcode roles for MVP:

- `owner_admin`
- `manager`
- `staff`
- `external_reviewer`

Use application permission helpers for role/action decisions. Keep custom roles out of MVP.

## Status Models

Submission statuses:

```txt
draft
submitted
in_review
needs_changes
approved
rejected
completed
archived
```

Allowed submission transitions:

```txt
draft -> submitted
submitted -> in_review
submitted -> assigned
in_review -> needs_changes
in_review -> approved
in_review -> rejected
needs_changes -> submitted
approved -> completed
completed -> archived
rejected -> archived
```

Task statuses:

```txt
open
in_progress
completed
cancelled
```

Document statuses:

```txt
active
archived
deleted
```

Public form link statuses:

```txt
active
expired
disabled
```

## Sprint Plan And Done Criteria

### Sprint 0: Planning Cleanup

Build:

- Rewrite stale `.agent/Project_inf.md` for BizFlow or remove it.
- Create README with setup, environment, usage, API overview, and verification commands.
- Choose package manager, defaulting to `pnpm` if there is no existing project convention.
- Decide initial SMS provider: Termii.
- Create `.env.example` with required non-secret variable names.

Done when:

- Planning docs all describe BizFlow.
- README explains how to start development.
- No stale source-of-truth document for another product remains.

### Sprint 1: Project Foundation

Build:

- Next.js app with TypeScript.
- Tailwind CSS and shadcn/ui.
- Supabase client/server setup.
- Supabase Auth.
- Protected dashboard layout.
- Vercel deployment setup.
- Environment variable validation.

Done when:

- A user can sign up, log in, and see the dashboard.

### Sprint 2: Organizations And Roles

Build:

- `organizations`, `profiles`, `organization_memberships`, and `invites`.
- Create organization flow.
- Staff invite flow.
- Accept invite flow.
- Role permission helper.
- People page.

Done when:

- Owner can create an organization, invite staff, and assign roles.

### Sprint 3: RLS And Permissions

Build:

- RLS policies for tenant-owned tables.
- Server-side permission checks.
- Role-based UI guards.
- Audit log helper.
- Tests that prove cross-org data access is blocked.

Done when:

- Users cannot access another organization's data.
- Staff cannot perform manager/admin actions.

### Sprint 4: Documents

Build:

- `folders`, `documents`, and `document_versions`.
- R2 signed upload URLs.
- R2 signed download URLs.
- Document list, folder view, document detail, and archive action.

Done when:

- Users can upload, view, download, and organize documents.

### Sprint 5: Document Versioning And Comments

Build:

- Replace document flow.
- Version history.
- Comments.
- Activity timeline.
- File download audit events.

Done when:

- Users can replace documents while keeping version history, discuss active documents, and see a tenant-scoped activity timeline.

### Deferred Phase: Offline Foundation (After Cloud MVP Reprioritization)

Build only if the user explicitly reactivates offline support and the threat model and verification spike are reviewed:

- Local persistence and crash-safe autosave.
- Per-user and per-organization local isolation.
- Versioned outbox and server-authoritative sync contract.
- Mutation idempotency, conflict detection, tombstones, and recovery.
- Secure offline file staging and resumable upload.
- Static-asset-only service-worker caching with explicit private-route exclusions.
- Offline status, recovery, storage-health, and manual retry experiences.

Done when:

- A user can safely continue the agreed offline workflows through crashes and long outages, and hostile or stale local state cannot bypass current cloud authorization.
- Every security and durability acceptance criterion in the Offline Foundation spike has recorded evidence.

Detailed plan: `artifacts/superpowers/offline-foundation-plan.md`.

This phase is not a prerequisite for Sprint 7 or other current cloud work, and it must not add dependencies while deferred.

### Sprint 6: Template Builder

Build:

- `templates` and `template_fields`.
- Template list.
- Create and edit template flows.
- Field builder.
- Template preview.
- Duplicate and archive template actions.

Done when:

- Manager can create a reusable form with custom fields.

### Sprint 7: Internal Submissions

Build:

- `submissions` and `submission_files`.
- Form renderer.
- Save draft.
- Submit form.
- File upload fields.
- Submission detail page.

Done when:

- Staff can fill a template, upload files, and submit.

### Sprint 8: Review Workflow

Build:

- Submission inbox.
- Status transition service.
- Assign submission.
- Approve, reject, request changes, and mark complete.
- Required comments for rejection and changes.
- Activity events.

Done when:

- Manager can process submissions from start to completion.

### Sprint 9: Tasks And Reminders

Build:

- `tasks` and `reminders`.
- Task list and detail.
- Create task from submission.
- Assign task.
- Due dates.
- Inngest reminder processor.
- Email notifications.

Done when:

- Assigned users receive reminders for due work.

### Sprint 10: SMS And Notification Preferences

Build:

- SMS provider integration.
- Notification preferences.
- Organization notification settings.
- Failed notification retries.
- Notification audit events.

Done when:

- The app can notify users by email and SMS.

### Sprint 11: Public Form Links

Build:

- `public_form_links`.
- Create public link.
- Public form renderer.
- Public submission flow.
- Public file upload.
- Link expiration.
- Max submissions.
- Rate limiting.

Done when:

- A business can send a form link to an outside person and receive a submission.

### Sprint 12: Offline Workflow Expansion And Pilot Hardening

Build:

- Extend the validated Offline Foundation to forms, submissions, tasks, and public workflows that are in scope by then.
- Run target-device, low-bandwidth, power-loss, storage-pressure, and long-disconnection pilot tests.
- Close field-observed durability and usability gaps without weakening server authorization.
- Re-evaluate the evidence-based Tauri go/no-go decision.

Done when:

- Pilot users can complete the approved offline workflows with documented recovery and synchronization evidence.

### Sprint 13: Starter Templates And Onboarding

Build:

- Starter template seed data.
- Template categories.
- Onboarding checklist.
- Empty states.
- Sample data option.

Done when:

- A new business can start without building templates from scratch.

### Sprint 14: Audit, Export, Pilot Polish

Build:

- Audit log page.
- CSV export.
- Mobile polish.
- Loading states.
- Error states.
- Sentry.
- PostHog or internal analytics.
- Admin support view if needed for pilots.

Done when:

- The MVP is ready for two pilot businesses.

## Current Completion Checklist

Project setup:

- [x] BizFlow MVP requirements captured from attached notes.
- [x] `.agent/AGENT.md` initialized as the BizFlow development guide.
- [x] Stale `.agent/Project_inf.md` removed.
- [x] README created for BizFlow.
- [x] Package manager chosen: `pnpm`.
- [x] Next.js app scaffolded.
- [x] Tailwind configured.
- [x] shadcn/ui initialized.
- [x] Supabase project configured with real project values.
- [x] `.env.example` created.
- [x] Initial Vercel deployment config added.

Core MVP:

- [ ] Auth works.
- [ ] Organization creation works.
- [ ] Invites and memberships work.
- [ ] RLS policies protect tenant data.
- [ ] Document upload/download works through R2 signed URLs.
- [ ] Document versioning works.
- [ ] Template builder works.
- [ ] Internal submissions work.
- [ ] Review workflow works.
- [ ] Comments and activity timeline work.
- [ ] Tasks work.
- [ ] Inngest reminders work.
- [ ] Email notifications work.
- [ ] SMS notifications work.
- [ ] Public form links work.
- [ ] Offline drafts work.
- [ ] Starter templates are seeded.
- [ ] Audit log and CSV export work.
- [ ] Mobile pilot polish is complete.

Definition of done for MVP:

- [ ] User can sign up.
- [ ] User can create an organization.
- [ ] Owner can invite staff.
- [ ] Users can create folders.
- [ ] Users can upload documents.
- [ ] Users can replace a document and view version history.
- [ ] Manager can create a template.
- [ ] Staff can fill and submit a form.
- [ ] Submitters can upload files inside a form.
- [ ] Manager can assign a submission.
- [ ] Users can comment on a submission.
- [ ] Manager can request changes.
- [ ] Manager can approve or reject.
- [ ] Manager can mark work complete.
- [ ] Users can create tasks.
- [ ] Assigned users receive email/SMS reminders.
- [ ] Manager can share a public form link.
- [ ] Business can receive an external submission.
- [ ] User can save a draft offline.
- [ ] User can sync the draft later.
- [ ] Users can view activity timelines.
- [ ] Admins can export basic audit/submission data.

## Verification Matrix

Use the project package manager once selected. If `pnpm` is used, the expected commands are:

```txt
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test
supabase db lint
supabase db push --dry-run
```

For each sprint, also verify the user-facing acceptance criterion manually in the browser. For frontend changes, inspect desktop and mobile viewports and confirm no overlapping UI, inaccessible controls, or broken responsive states.

For database/RLS work, include tests or SQL checks proving:

- A member can access rows in their organization.
- A member cannot access rows in another organization.
- Staff cannot perform manager/admin actions.
- Public form tokens expose only the intended form and submission path.

## Build Priority

Build in this exact order:

1. Auth
2. Organizations
3. Memberships and roles
4. RLS and permissions
5. Documents
6. R2 upload and download
7. Templates
8. Submissions
9. Workflow review
10. Comments and activity timeline
11. Tasks
12. Inngest reminders
13. Email and SMS
14. Public forms
15. Offline drafts
16. Starter templates
17. Audit and export
18. Pilot polish
