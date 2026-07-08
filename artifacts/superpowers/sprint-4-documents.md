# Sprint 4 Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tenant-scoped folders, documents, document versions, and Cloudflare R2 signed upload/download workflows.

**Architecture:** Store document metadata in Supabase tables with `org_id`, forced RLS, and explicit Data API grants. Keep all writes and R2 signing behind server services and thin App Router route handlers/actions. Keep the dashboard UI inside the existing shadcn card/list design system.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase PostgreSQL/RLS, Cloudflare R2 S3-compatible API, AWS SDK v3, shadcn/ui, Vitest.

---

Last updated: 2026-07-08

## Scope

- `folders`, `documents`, and `document_versions` schema with tenant indexes and forced RLS.
- Document permission actions and audit event types.
- R2 environment validation, S3 client construction, deterministic object keys, and signed PUT/GET helpers.
- Document service functions for folder creation, document upload URL creation, upload completion, list/detail reads, archive, and download URL creation.
- API routes for signed upload, upload completion, and signed download.
- Documents dashboard page, document detail page, upload client component, folder creation, archive actions, and navigation.

## Acceptance Criteria

- Active organization members can list and view documents in their organization.
- Non-members and disabled members are blocked by RLS and service permission checks.
- Authenticated browser clients do not receive direct database write grants for document metadata.
- Upload URLs are signed server-side for a single deterministic R2 object key and allowed MIME type.
- Download URLs are signed only after service-side membership checks.
- Users can create folders, upload a document, view document detail/version metadata, download the current version, and archive a document.
- Document and folder workflows write audit events.

## Verification Commands

```txt
corepack pnpm test
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

## Task Checklist

### Task 1: Document schema, permissions, and audit contracts

**Files:**
- Create: `supabase/migrations/20260708190000_sprint_4_documents.sql`
- Modify: `supabase/migrations/rls-permissions.test.ts`
- Modify: `src/lib/permissions.ts`
- Modify: `src/lib/permissions.test.ts`
- Modify: `src/types/audit.ts`
- Modify: `src/services/audit-service.ts`

- [x] Add document permission actions: `documents:view`, `documents:create`, `documents:archive`, `folders:manage`, and `document_versions:create`.
- [x] Allow owner admins and managers to perform all document/folder/version actions.
- [x] Allow staff to view documents and create document versions, but not archive documents or manage folders.
- [x] Allow external reviewers to view documents only.
- [x] Extend audit unions and parser support for `folder.created`, `folder.archived`, `document.created`, `document.archived`, `document_version.created`, and target types `folder`, `document`, `document_version`.
- [x] Add a Sprint 4 migration that creates `folders`, `documents`, and `document_versions`.
- [x] Include UUID primary keys, `org_id`, timestamps, creator/updater/archive metadata, folder parent support, document archive fields, version metadata, and `document_versions.status` values `upload_pending` and `available`.
- [x] Add composite foreign keys that prevent cross-org folder/document/version references.
- [x] Enable and force RLS on all three tables.
- [x] Grant authenticated users `select` only on all three tables.
- [x] Grant `service_role` `select, insert, update, delete` on all three tables.
- [x] Add select policies using `(select public.is_organization_member(org_id))`.
- [x] Add tenant and active-record indexes for folders, active documents, archived documents, and document versions.
- [x] End the migration with `notify pgrst, 'reload schema'`.
- [x] Extend migration tests to assert the Sprint 4 table creation, forced RLS, policies, direct-write omission, service-role grants, and schema reload.
- [x] Run `corepack pnpm test -- supabase/migrations/rls-permissions.test.ts src/lib/permissions.test.ts`.
- [x] Commit with `feat(documents): add document schema contracts`.

### Task 2: R2 environment, client, and signed URL helpers

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/lib/env.ts`
- Modify: `src/lib/env.test.ts`
- Create: `src/lib/r2/client.ts`
- Create: `src/services/document-storage-service.ts`
- Create: `src/services/document-storage-service.test.ts`

- [x] Add dependencies: `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.
- [x] Add `getR2Env()` for server-only R2 settings: account id, access key id, secret access key, bucket name, endpoint, region, signed URL TTL seconds.
- [x] Add `getFileUploadPolicyEnv()` for max bytes and allowed MIME types.
- [x] Validate TTL between 1 and 604800 seconds and default to 900 when absent.
- [x] Validate allowed MIME types as a non-empty comma-delimited list and max bytes as positive.
- [x] Create `createR2Client()` that constructs `S3Client` with `region: "auto"` by default, configured endpoint, and server-only credentials.
- [x] Create pure helpers for allowed MIME type lookup, safe extension derivation, object key creation, and upload size validation.
- [x] Use object keys shaped as `organizations/{organizationId}/documents/{documentId}/versions/{versionId}/original{extension}`.
- [x] Create signed PUT and GET helpers using `PutObjectCommand`, `GetObjectCommand`, and `getSignedUrl`.
- [x] Do not log signed URLs or secrets.
- [x] Add unit tests for env validation, object key format, MIME/size rejection, and injected signer behavior.
- [x] Run `corepack pnpm test -- src/lib/env.test.ts src/services/document-storage-service.test.ts`.
- [x] Commit with `feat(documents): add R2 signing foundation`.

### Task 3: Document service and API routes

**Files:**
- Modify: `src/lib/supabase/admin.ts`
- Create: `src/types/document.ts`
- Create: `src/services/document-service.ts`
- Create: `src/services/document-service.test.ts`
- Create: `src/app/api/documents/upload-url/route.ts`
- Create: `src/app/api/documents/[documentId]/complete-upload/route.ts`
- Create: `src/app/api/documents/[documentId]/download-url/route.ts`

- [ ] Add typed Supabase table rows for `folders`, `documents`, and `document_versions`.
- [ ] Create document DTOs for folders, documents, document versions, upload URL responses, download URL responses, workspace lists, and document detail.
- [ ] Implement `DocumentServiceError` with HTTP-style status codes.
- [ ] Implement `createFolder`, `listDocumentWorkspace`, `getDocumentDetail`, `createDocumentUploadUrl`, `completeDocumentUpload`, `archiveDocument`, and `createDocumentDownloadUrl`.
- [ ] Check actor membership through `organization_memberships` before service writes/signing.
- [ ] Check role permissions through the central permission matrix.
- [ ] Create documents with an `upload_pending` version before signing PUT URLs.
- [ ] Complete uploads by marking the version `available` and setting `documents.current_version_id`.
- [ ] List only non-archived documents on the workspace page by default.
- [ ] Archive documents by setting `archived_at` and `archived_by`, not deleting rows.
- [ ] Sign downloads only for available current versions.
- [ ] Write audit events for folder creation, document creation, document version creation, and document archive.
- [ ] API routes must authenticate, parse JSON, call services, and return JSON with specific HTTP status codes.
- [ ] Add focused tests for missing setup handling, permission rejection, upload validation, archive behavior, and route status mapping using injected dependencies or mocks.
- [ ] Run `corepack pnpm test -- src/services/document-service.test.ts`.
- [ ] Commit with `feat(documents): add document services and API routes`.

### Task 4: Documents dashboard UI

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx`
- Modify: `src/app/(dashboard)/dashboard/page.tsx`
- Create: `src/app/(dashboard)/documents/page.tsx`
- Create: `src/app/(dashboard)/documents/[documentId]/page.tsx`
- Create: `src/app/(dashboard)/documents/actions.ts`
- Create: `src/components/documents/document-upload-form.tsx`

- [ ] Add `/documents` navigation as an active link instead of placeholder text.
- [ ] Update dashboard copy from Sprint 3 to Sprint 4 document storage.
- [ ] Build a documents page that loads auth and organization context like People/Audit pages.
- [ ] Show folders, active documents, and an upload panel using existing Card, Alert, Badge, Button, Field, Input, and native select patterns.
- [ ] Add a thin server action for folder creation.
- [ ] Add a client upload form that requests `/api/documents/upload-url`, PUTs the selected file to R2 using the returned URL, calls `/api/documents/{id}/complete-upload`, and redirects to the document detail page.
- [ ] Build document detail with metadata, current version, download button, version list, and archive action.
- [ ] The download button must request `/api/documents/{id}/download-url` client-side and open the returned URL.
- [ ] Keep mobile layout non-overlapping and use the existing dashboard card/list density.
- [ ] Run `corepack pnpm lint` and `corepack pnpm typecheck`.
- [ ] Commit with `feat(documents): add document dashboard UI`.

### Task 5: Sprint docs, verification, and final review

**Files:**
- Modify: `README.md`
- Modify: `.agent/AGENT.md`
- Modify: `artifacts/superpowers/bizflow-development-plan.md`
- Modify: `artifacts/superpowers/sprint-4-documents.md`

- [ ] Update docs from Sprint 3 to Sprint 4 current status.
- [ ] Add Sprint 4 migration to the manual migration order in README.
- [ ] Document the R2 env variables and CORS note for signed browser PUT/GET access.
- [ ] Record final verification commands and results in this sprint artifact.
- [ ] Run `corepack pnpm test`.
- [ ] Run `corepack pnpm lint`.
- [ ] Run `corepack pnpm typecheck`.
- [ ] Run `corepack pnpm build`.
- [ ] Run a final code review subagent over the full Sprint 4 diff.
- [ ] Commit with `docs: record sprint 4 verification`.
