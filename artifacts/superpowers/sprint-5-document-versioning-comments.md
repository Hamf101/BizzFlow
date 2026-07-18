# Sprint 5 Document Versioning And Comments Implementation Plan

**Goal:** Let organization members replace a document without losing prior files, discuss the document in context, and see a trustworthy activity history.

**Architecture:** Extend the existing signed R2 upload lifecycle with create-only replacement PUTs and verify uploaded object metadata with R2 HEAD before promotion. Store immutable comments and member-visible activity in separate tenant-scoped Supabase tables with forced RLS and service-only writes. Keep compliance audit logs manager-only, and use small security-invoker PostgreSQL functions for atomic version allocation, idempotent promotion, comment/activity creation, and archive/activity creation.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase PostgreSQL/RLS, Cloudflare R2 signed URLs, shadcn/ui, Vitest.

---

Last updated: 2026-07-17

## Scope

- Replacement upload URL creation for active documents.
- Version promotion after a successful browser-to-R2 upload.
- Version history with downloads for any available version.
- Tenant-scoped document comments.
- Tenant-scoped document activity timeline.
- Download audit events for current and historical versions.

## Acceptance Criteria

- A member with `document_versions:create` can upload a replacement for an active document.
- Replacement creates the next positive version number and does not overwrite or delete earlier version metadata or R2 objects.
- Version allocation and promotion are atomic; the document points to the newest completed replacement only after that version is marked available.
- Upload completion verifies that the R2 object exists and matches the pending version's byte size and content type before promotion.
- Signed uploads are create-only, so the same URL cannot overwrite an object after verification.
- Members with document access can see version number, file metadata, uploader, and timestamp for every version.
- Any available historical version can be downloaded after a fresh membership check.
- Every signed download request records the document id and version id in the audit log without exposing the signed URL.
- Active organization members with document access can add a non-empty comment of at most 2,000 characters.
- Comments are tenant-scoped, immutable in this sprint, and readable only by members of the owning organization.
- The document detail page shows comments and recent document activity in newest-first order.
- Authenticated browser clients receive read-only Data API access to document comments; all writes remain behind server services.
- Existing invite-email work in the dirty worktree remains intact and outside Sprint 5 scope.

## Verification Commands

```txt
corepack pnpm test
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
git diff --check
```

## Task Checklist

### Task 1: Schema and typed contracts

- [x] Create the migrations with the Supabase CLI.
- [x] Add `document_comments` and `document_activity_events` with tenant-scoped foreign keys, constraints, indexes, forced RLS, explicit grants, and member select policies.
- [x] Add service-role-only security-invoker functions for atomic replacement-version allocation, completion, and comment/activity creation.
- [x] Add migration contract tests proving tenant isolation and service-only writes.
- [x] Extend Supabase admin table types and document collaboration DTOs.
- [x] Extend audit actions for version downloads and activity contracts for comments.

### Task 2: Replacement and version download services

- [x] Add a replacement upload service that validates permission, document state, file policy, and next version number before signing R2 access.
- [x] Make signed R2 PUTs create-only, verify object metadata before promotion, and make concurrent completion retries idempotent.
- [x] Keep upload completion as the only promotion point for `documents.current_version_id`.
- [x] Allow download URL creation for a requested available version, defaulting to the current version.
- [x] Record download audit events without logging URLs or credentials.
- [x] Add focused service and route tests.

### Task 3: Comments and activity services

- [x] Add small document comment and activity services for collaboration writes and reads.
- [x] Require active membership and document visibility for all reads and writes.
- [x] Return safe author labels from profile data.
- [x] Build the member timeline from transactionally paired upload, replacement, comment, and archive events while keeping download audit events restricted.
- [x] Add focused tests for permissions, validation, tenant filters, activity mapping, and transaction failure.

### Task 4: Document detail UI

- [x] Add a replacement upload component that refreshes expired access for the same pending version and retries completion safely.
- [x] Add historical-version download buttons with popup-blocking feedback.
- [x] Add a comment form with pending-state duplicate-submit protection and an accessible comment list.
- [x] Add a recent activity card with readable event labels and timestamps.
- [x] Preserve mobile action priority and permission-based action visibility.

### Task 5: Verification and sprint documentation

- [x] Run focused tests after each backend/UI slice.
- [x] Run the full verification commands.
- [x] Update README, the agent guide, and the development-plan status.
- [x] Apply both Sprint 5 migrations and verify live schema access.
- [x] Record final evidence and the remaining authenticated R2 UAT requirement.

## Final Evidence

- `corepack pnpm test`: 12 files and 118 tests passed.
- `corepack pnpm lint`: passed with no warnings.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm build`: production build passed and emitted all document routes.
- `git diff --check`: passed.
- Supabase migration history matches locally and remotely through `20260717194631`.
- Supabase database lint reported no schema errors.
- Live Data API probes returned `200 OK` for document, version, comment, and activity tables.
- Browser smoke reached the protected `/documents` flow and correctly redirected to `/login`; authenticated browser-to-R2 UAT still requires test-user credentials and configured R2 environment values.
