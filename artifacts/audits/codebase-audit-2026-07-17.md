# BizFlow codebase audit

Audit window: 2026-07-17 through 2026-07-18
Scope: complete repository as present on `codex/start-bizflow`, including all tracked and untracked Sprint 5/6 work
Mode: audit plus safe remediation; existing uncommitted work was preserved

## Executive assessment

BizFlow has a sound core: strict TypeScript, a clear App Router/service/domain split, tenant-scoped service checks, forced RLS, immutable document versions, bounded template schemas, dependency injection in the newest services, and strong create-only R2 upload semantics. The fresh baseline passed lint, TypeScript, 163 tests, the production build, live Supabase reads, remote database linting, migration-ledger comparison, and diff checks.

The project was not ready to be called hardened or structurally finished. The audit confirmed four high-risk data-integrity/authorization defects, several medium security gaps, one vulnerable transitive dependency, missing CI, duplicated integration and rendering code, unbounded collection queries, and five service files over 1,000 lines. Sprint documentation also overstates completion of generated-document finalization and AI abuse controls.

This pass fixes the high-confidence defects, applies the database hardening migration to the configured remote project, removes every 1,000+ line code/test monolith, and cuts strict duplicated production lines by roughly half. Infrastructure- or product-dependent work is deliberately documented instead of being implemented with unsafe defaults.

## Audit methods

The audit combined:

- repository inventory, dependency-direction checks, import-cycle checks, dead-reference searches, and large-file analysis;
- manual review of authentication, authorization, route handlers, service-role boundaries, R2, Resend, OpenRouter, public signing, PDF generation, and all migrations;
- deterministic clone detection with `jscpd` v5;
- `pnpm audit --prod`, outdated-dependency review, lockfile policy checks, and dependency-use searches;
- lint, strict TypeScript, Vitest, production build, and `git diff --check`;
- direct live Supabase checks, migration-ledger comparison, Postgres linting, schema/OpenAPI inspection, and anonymous privilege probes;
- current official guidance for [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Next.js CSP](https://nextjs.org/docs/app/guides/content-security-policy), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), and the [PostCSS advisory](https://github.com/advisories/GHSA-qx2v-qp2m-jg93).

The audit did not claim browser-to-R2 provider UAT, malware-scanner validation, production CDN-header validation, or multi-user load testing. Those require external execution environments and are called out below.

## Baseline metrics

| Metric | Baseline |
| --- | ---: |
| Repository files | 153 |
| Approximate lines | 31,206 |
| Production TypeScript/TSX files in clone scan | 88 |
| Production lines in clone scan | 22,935 |
| Clone groups | 27 |
| Duplicated production lines | 460 (2.01%) |
| Tests | 19 files / 163 tests |
| Dependency advisories | 1 moderate |
| Import cycles | 0 |
| Live application tables checked | 14 |

Final post-remediation metrics:

| Metric | Final |
| --- | ---: |
| Production TypeScript/TSX files in clone scan | 138 |
| Production lines in clone scan | 24,755 |
| Clone groups | 20 |
| Duplicated production lines | 248 (1.00%) |
| Tests | 36 files / 219 tests |
| Dependency advisories | 0 |
| Largest production TypeScript/TSX file | 610 lines |
| Largest test/support file | 558 lines |
| Live application tables checked | 14/14 plus JWKS |
| Local/remote migrations matched | 8/8 |

Largest pre-audit production files:

| File | Lines | Principal responsibilities |
| --- | ---: | --- |
| `src/services/document-pdf-service.tsx` | 2,221 | two renderers, planning, pagination, fonts/images, validation |
| `src/services/document-signing-service.ts` | 1,606 | orchestration, permissions, tokens, answer validation, drawings, persistence |
| `src/services/document-service.ts` | 1,515 | folders, workspace, upload/version lifecycle, archive, download |
| `src/services/template-service.ts` | 1,139 | templates, generated documents, folders, recents |
| `src/services/organization-service.ts` | 1,071 | organizations, profiles, invites, memberships, email, audit |

## Findings and disposition

Severity uses impact and exploitability together. “Fixed” means code and regression coverage were added in this audit worktree. “Planned” means a specific remediation is defined but needs product/infra decisions or a separately deployable slice.

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| AUTH-01 | High | Any authenticated user could claim an arbitrary unused `profiles.email` | Fixed in database hardening migration |
| DATA-01 | High | Invite acceptance granted membership and consumed invite in separate, raceable writes | Fixed with transactional RPC |
| DATA-02 | High | Concurrent owner demotions could leave an organization with zero owners | Fixed with locking transactional RPC |
| DATA-03 | High | Concurrent generated-answer saves could overwrite fields or report false success | Fixed with locking merge RPC |
| AUTH-02 | Medium | Published-template RLS allowed external reviewers despite application denial | Fixed in RLS policy |
| AUTH-03 | Medium | All active members could receive pending invite bearer links through service-role query | Fixed by role-gating pending invite results |
| AUTH-04 | Medium | Authenticated table reads exposed signing token hashes and raw drawing data | Fixed with least-privilege column grants |
| AUTH-05 | Medium | Cookie-authenticated JSON routes lacked explicit origin/content-type enforcement | Fixed with shared request-security contract |
| AUTH-06 | Medium | Auth callback based absolute redirects on the request host | Fixed; canonical app origin is required |
| WEB-01 | Medium | No repository CSP, anti-framing, nosniff, referrer, permissions, or HSTS policy | Fixed with tested build configuration |
| STORAGE-01 | Medium | Signed PUT did not bind declared byte length | Fixed by signing content length |
| STORAGE-02 | Medium | Uploaded file trust is metadata-only; no quarantine, signature validation, or malware scan | Planned infrastructure control |
| STORAGE-03 | Medium | Signed uploaded-file GETs could render inline | Fixed with attachment disposition |
| ABUSE-01 | Medium | AI suggestions have no durable per-user/organization budget or rate limit | Planned; product limit required |
| ABUSE-02 | Medium | Email and storage operations lack durable tenant quotas | Planned |
| EMAIL-01 | Medium | Resend integrations duplicated transport and lacked timeout/idempotency | Fixed with shared transport adapter |
| DEP-01 | Low | Next resolved vulnerable PostCSS 8.4.31 (CVE-2026-41305) | Fixed with 8.5.16 workspace override |
| PRIV-01 | Low | Legacy tables retained anonymous table privileges even though RLS hid rows | Fixed with explicit revocation |
| PRIV-02 | Low | Auth/session cookies did not explicitly set `Secure` in production | Fixed |
| PRIV-03 | Low | Signed URL JSON lacked explicit `private, no-store` | Fixed |
| PRIV-04 | Low | Authentication/organization logs included email/provider detail | Fixed/trimmed to IDs, types, codes |
| ARCH-01 | Major maintainability | PDF service had two renderers and tests covered the non-production renderer | Fixed; one production renderer and planner modules |
| ARCH-02 | Major maintainability | Document/signing/template/organization services mix unrelated responsibilities | Fixed for the identified monoliths behind stable facades |
| DUP-01 | Moderate maintainability | Upload/replace/download client flows duplicated PUT, completion, and error parsing | Fixed with document upload client helper |
| DUP-02 | Moderate maintainability | Template preview and generated document duplicated all static block rendering | Fixed with shared static block renderer |
| DUP-03 | Moderate maintainability | Dashboard/auth pages duplicated authentication, tenant-context, date, status, error, and shell code | Fixed with typed page and presentation helpers |
| PERF-01 | Medium | Workspace, member, template, and version lists are unbounded | Planned cursor-pagination slice |
| PERF-02 | Medium | Template list selects potentially 8 MB `content` for every row | Planned summary query/DTO |
| PERF-03 | Medium | Recent documents use a capped overfetch heuristic that can underfill results | Planned joined/RPC query |
| PERF-04 | Medium | Template editor rerenders/serializes full multi-MB content on each edit | Planned UI performance slice |
| OPS-01 | Medium | No CI, pinned runtime, aggregate quality command, or dependency gate | Fixed |
| OPS-02 | Medium | Live DB script uses service role and does not prove effective RLS isolation | Planned two-tenant integration job |
| TYPE-01 | Medium | Handwritten database types duplicate rows and erase relationships/nullability | Planned generated-type drift gate |
| SCOPE-01 | Medium | Generated “final” PDFs are rendered on demand, not persisted/versioned/audited | Planned completion-finalization workflow |
| SCOPE-02 | Medium | Sprint status documents conflict and acceptance boxes remain unverified | Planned documentation reconciliation |

## Detailed analysis

### 1. Authorization and transactional integrity

#### Profile email squatting

The original Sprint 2 migration granted authenticated users full-row profile insert/update while its RLS policies constrained only `profiles.id = auth.uid()`. Because email is globally unique and organization flows trust `profiles.email`, an attacker could claim a victim’s unused email, block onboarding, or cause identity misattribution.

The hardening migration removes authenticated profile creation and broad updates. Trusted server workflows remain responsible for synchronizing authenticated identity. If self-service display names are added later, grant only the `full_name` column rather than restoring broad row updates.

#### Invite acceptance

`acceptInvite` originally read a pending invite, upserted membership, then updated the invite. A concurrent revoke/accept could make the final update match zero rows while the membership remained active. A second-write failure also left contradictory state.

The replacement RPC locks and validates the invite, verifies email and expiry, ensures the profile, activates membership, and consumes the invite in one database transaction. Execution is revoked from public/anonymous/authenticated roles and granted only to `service_role`; the function uses `security invoker` and an empty search path.

#### Last-owner invariant

The service previously counted owners and updated a target in separate statements. Two concurrent demotions could each observe two owners. The replacement RPC locks using a consistent organization-first order, authorizes the actor, validates the target, and prevents a transition leaving zero active owners.

#### Generated answer merge

The original read/merge/write path overwrote the full JSON object. Different fields saved concurrently could be lost, and a completion race could update zero rows without an error. The replacement RPC locks the answer row, rejects completed documents, validates an object patch, applies `values || patch`, and returns persisted state. Application-level schema validation remains in place.

### 2. RLS and Data API least privilege

All application tables correctly enable and force RLS. The helper functions schema-qualify objects, use empty search paths, revoke public execution, and wrap `auth.uid()` in scalar subqueries. Tenant foreign keys are strong.

The audit nevertheless found policy/grant drift:

- published templates were readable by every member while `external_reviewer` lacks `templates:view`;
- full signing-recipient reads exposed private token hashes and signature/initial images despite DTO redaction;
- legacy anonymous table privileges returned `200 []` rather than a permission failure;
- service-role People queries bypassed the manager-only invite policy.

The hardening migration aligns RLS with the role model, uses column-level grants for safe signing-recipient fields, explicitly revokes legacy anonymous privileges, and application code only includes pending invites for roles that can manage them.

Residual recommendation: hash organization invite tokens like signing tokens, remove plaintext tokens from persistence, and replace the manager “open link” affordance with rotate/resend. This needs a coordinated data migration and email-flow change; manager-only exposure is the immediate containment.

### 3. Route, browser, and authentication security

The new `readTrustedJsonObject` contract centralizes three rules for cookie-authenticated mutations:

- reject `Sec-Fetch-Site: cross-site`;
- when `Origin` is present, require the configured canonical application origin;
- require `application/json` or a structured `+json` media type and a JSON object body.

It is applied to upload allocation, replacement allocation, upload completion, signed download URL creation, opened tracking, and AI suggestions. The download endpoint is now `POST`, so its required audit side effect is not triggered by speculative navigation or cache prefetch. Missing Origin remains accepted for non-browser/same-origin tooling after authentication.

The authentication callback now builds redirects from required `NEXT_PUBLIC_APP_URL`, never `request.url`. Login/signup logs omit email and raw provider messages; signup returns a generic public error. The invite-signup redirect bug was fixed by moving the email-mismatch redirect outside the invite lookup catch.

Global headers now provide CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, nosniff, no-referrer, restrictive Permissions Policy, and HSTS when the canonical production URL uses HTTPS. The HTTPS condition keeps local HTTP production builds usable. The static CSP retains `unsafe-inline` for Next compatibility; moving to nonce-based CSP would force dynamic rendering and should be assessed separately. `poweredByHeader` is disabled.

### 4. Storage and uploaded content

Existing strengths:

- server-generated tenant/document/version object keys;
- allowlisted declared MIME types and positive sizes;
- create-only `If-None-Match: *` signed PUTs;
- HEAD verification of exact size, content type, and tenant metadata before promotion;
- atomic version allocation/promotion and immutable history.

This pass adds signed `ContentLength`, attachment disposition for uploaded-file downloads, and explicit no-store headers around returned bearer URLs.

Remaining risk: object metadata does not prove content. An authorized user can upload malicious or malformed bytes with an allowed label. The production design should use an `upload_pending -> scanning -> available/rejected` state, validate magic bytes/file structure, scan malware in an isolated worker, delete rejected/stale objects, and enforce per-tenant storage quotas plus R2 lifecycle cleanup. This should not be approximated with synchronous in-process parsing in a serverless route.

### 5. Provider abuse and reliability

The OpenRouter service already bounds instruction/draft size, validates output, and has a timeout, but it has no durable rate/budget control. The correct fix is a database or platform atomic limiter keyed by actor and organization, with a defined product quota, concurrent-request behavior, `429`, and retry metadata. An in-memory map would fail under horizontal/serverless execution and was intentionally not added.

The Resend integrations are now separated into domain-specific message builders and one transport adapter. The adapter enforces a configured timeout and sends a stable provider-supported `Idempotency-Key` for logical invite/signing deliveries. This removes duplicated parsing/logging/escaping while preserving distinct public errors.

### 6. Dependencies and supply chain

`pnpm audit --prod` found one moderate advisory: PostCSS below 8.5.10. Next 16.2.10 resolved 8.4.31. A workspace override now pins PostCSS 8.5.16, and the audit returns no known vulnerabilities.

The unused `shadcn` runtime dependency and duplicate React-PDF stack were removed. `@types/node` and the runtime contract now align at Node 22+, matching current Supabase runtime direction. Major ESLint/TypeScript upgrades were not mixed into the security pass.

The lockfile’s existing supply-chain policy checks pass. Future CI hardening can pin third-party GitHub Actions to immutable commit SHAs in addition to using current major versions.

### 7. Architecture and duplication

The clone scan found only 2.01% duplication, but several groups crossed responsibility boundaries and were worth removing:

- Resend delivery, response parsing, HTML escaping;
- browser signed PUT/completion/API-error handling;
- static template block rendering in preview/generated document;
- PDF rendering duplicated between React-PDF and the production `pdf-lib` path;
- route JSON-object parsing;
- several status badges and small formatters.

All identified cross-responsibility clones are removed. Identical date/status presentation is centralized in small domain-specific helpers; import-only, schema-shape, and behaviorally distinct code is not forced into a generic abstraction because that would increase coupling and violate KISS.

The final strict production scan analyzes 138 TypeScript/TSX files and 24,755 lines. It reports 20 clone groups / 248 duplicated lines (1.00%), down from 27 groups / 460 lines (2.01%) at baseline even though the audit added security controls and split modules. Residual groups are import-only page headers; service-specific permission/error/logging shells; deliberately distinct upload/replacement and publish/archive workflows; and validation-schema shapes. They are recorded rather than hidden behind a generic repository, logging framework, or lifecycle abstraction with mismatched invariants.

The PDF service is now a small public facade over:

```text
src/services/document-pdf/
├── constants.ts
├── errors.ts
├── planner.ts
├── pdf-lib-images.ts
├── pdf-lib-renderer.ts
├── pdf-lib-signing.ts
├── pdf-lib-text.ts
├── pdf-lib-types.ts
├── shared.ts
└── types.ts
```

The test-only React-PDF renderer was deleted. Tests now exercise the deterministic page planner and actual production PDF bytes. The final extraction also passed a byte-identical three-page PNG visual regression; the remaining renderer is 582 lines and has one cohesive reason to change.

The identified service monoliths now retain stable 7–53-line public facades while implementation follows responsibility-based boundaries:

```text
src/services/
├── documents/
│   ├── contracts.ts
│   ├── shared.ts
│   ├── workspace-service.ts
│   ├── version-service.ts
│   ├── version-upload-service.ts
│   ├── version-replacement-service.ts
│   ├── version-download-service.ts
│   ├── version-archive-service.ts
│   └── version-shared.ts
├── document-signing/
│   ├── workflows.ts
│   ├── persistence.ts
│   ├── answer-validation.ts
│   ├── drawing-validation.ts
│   ├── recipient-validation.ts
│   └── token-security.ts
├── templates/
│   ├── template-lifecycle-service.ts
│   ├── generated-document-service.ts
│   └── shared.ts
└── organizations/
    ├── lifecycle-service.ts
    ├── membership-service.ts
    ├── invitation-service.ts
    └── repository.ts
```

No generic repository or workflow framework was introduced; each domain keeps its distinct invariants, errors, and transactional behavior.

### 8. Query and algorithm review

No application N+1 query pattern was confirmed. Profile hydration is batched; generated signing reads run in parallel; recent-document hydration uses one batched document query.

Confirmed scale issues:

- `listDocumentWorkspace` loads every active folder/document and pages filter in memory;
- template lists select full `content`, whose schema permits up to roughly 8 MB, for every template;
- members, invites, and version histories are unbounded;
- recent documents cap access-row overfetch, then discard stale rows, so valid older results can be omitted;
- the editor rerenders a full controlled tree and preview on each change.

Use cursor pagination with deterministic tie-breakers such as `(created_at,id)`, `(updated_at,id)`, or `(lower(name),id)`. Add lightweight template summary DTOs that do not select `content`. Replace recent overfetch with a joined SQL/RPC query constrained to active documents. Add pagination only with matching UI contracts; silently adding arbitrary `.limit()` values would replace slowness with incomplete data.

Database index audit confirmed one redundant index: `organization_memberships_org_user_idx` duplicated the unique constraint’s automatic `(org_id,user_id)` index. The hardening migration removes it and adds only high-confidence indexes matching current predicates/order. Broad “unused index” removal was rejected because the live dataset is too small for usage statistics to be meaningful.

### 9. Generated-document finalization gap

Generated documents currently store a snapshot and answers but do not persist a completed PDF into `document_versions`. The PDF endpoint renders on every request, including before completion, and does not use the version download audit path. Concurrent answer/recipient reads can also produce a mixed-state render.

The correct design is an idempotent finalization state machine:

1. transition completed answers to `finalization_pending` once;
2. read a transactionally consistent immutable completion snapshot;
3. render a deterministic PDF;
4. upload to a deterministic create-only R2 key;
5. atomically create/promote an available `document_version` and mark finalized;
6. make retries reconcile DB/object partial completion;
7. keep a clearly labeled no-store preview endpoint for drafts.

R2 and Postgres cannot share a transaction, so this requires retry/reconciliation design and should be a dedicated sprint slice.

### 10. Testing and delivery process

Before this audit, quality gates existed only as local commands. The new CI workflow uses current Node/pnpm actions, frozen lockfile installation, production dependency audit, lint, typecheck, tests, and production build with read-only repository permissions and concurrency cancellation. `pnpm check` provides the local aggregate gate.

Still needed:

- two-tenant authenticated RLS integration tests using anon/user clients rather than service role;
- generated database types and a CI drift check;
- route tests for opened/PDF/AI behavior and server-action regression coverage;
- a secrets-backed, opt-in provider job for Supabase/R2/Resend rather than pretending mocks prove integration;
- Playwright staging smoke flows for invite signup, upload/replace/download, comments, templates, signing, and final PDF;
- coverage reporting with thresholds chosen from a measured baseline.

## Strong controls retained

- No tracked secrets or browser-secret import path was found.
- No `dangerouslySetInnerHTML`, `eval`, `new Function`, unsafe postMessage, or untrusted external navigation sink was found.
- Signing tokens use 32 random bytes, SHA-256 hashes, expiry, rotation, and no token logging.
- Public signing DTOs omit co-signer email and token hashes.
- Template content uses strict discriminated Zod schemas with bounds, unique IDs/keys, and PNG/JPEG-only data URLs.
- Document replacement/comment/archive/version workflows use narrow transactional RPCs and locks.
- RLS is forced on every application table and composite tenant foreign keys prevent cross-organization relationships.
- Service/UI dependency direction is clean and import-cycle free.

## Recommended remediation order after this pass

1. Add two-tenant authenticated RLS tests for the applied hardening migration and future policy changes.
2. Complete authenticated browser-to-R2 UAT for Sprint 5, including retries and `Content-Length` compatibility.
3. Design/implement generated-document finalization and immutable stored PDFs.
4. Define AI/email/storage budgets, then add durable atomic rate limits and tenant quotas.
5. Add upload quarantine, type verification, malware scanning, lifecycle cleanup, and rejection telemetry.
6. Introduce cursor-paginated workspace/template/member/version APIs and lightweight template summaries.
7. Generate canonical Supabase types and move domain models toward discriminated uploaded/generated document variants.
8. Reconcile the agent guide, sprint plan, and acceptance evidence after provider/browser UAT.

## Verification record

Final verification after all audit edits converged:

- aggregate `pnpm check`: pass;
- ESLint: pass;
- strict TypeScript: pass;
- Vitest: 36 files / 219 tests pass;
- strict production clone scan: 138 files / 24,755 lines, 20 groups / 248 duplicated lines (1.00%), below the enforced 3% gate;
- Next 16.2.10 production build: pass;
- `pnpm audit --prod --audit-level=moderate`: no known vulnerabilities;
- production PDF visual regression: three A4 pages, byte-identical rendered PNGs, no clipping/overlap/spacing change;
- live Supabase: JWKS and 14/14 service-role application table checks pass;
- anonymous PostgREST probes: all 14 application tables deny access with `401`;
- direct remote database lint: no schema errors;
- local/remote migration ledger: 8/8 matched through `20260718002902`, with no non-migration skip warning;
- local production-header probe: CSP, no-referrer, nosniff, anti-framing, and Permissions Policy present; framework signature absent; HSTS correctly omitted for the configured HTTP local origin;
- largest production TypeScript/TSX file: 610 lines; largest test/support file: 558 lines;
- `git diff --check`: pass;
- existing dirty Sprint 5/6 work remained unstaged and uncommitted.
