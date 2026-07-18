# Security best-practices report

Audit window: 2026-07-17 through 2026-07-18
Application: BizFlow Docs
Stack: Next.js 16, React 19, TypeScript, Supabase/Postgres, Cloudflare R2, Resend, OpenRouter

## Summary

The review confirmed four high-impact authorization/data-integrity defects, ten medium findings, and several defense-in-depth gaps. No critical secret exposure, direct cross-tenant query, practical signing-token reversal, DOM execution sink, or anonymous row disclosure was found. All high-confidence application/database issues are remediated; the hardening migration is applied to the configured remote database and the remaining infrastructure/product controls have concrete follow-ups.

## 1. Authenticated profile email squatting

Severity: High
Status: Fixed in hardening migration

Evidence:

- `supabase/migrations/20260708170500_sprint_2_organizations_roles.sql` originally granted authenticated `INSERT, UPDATE` on `profiles`.
- Policies constrained `id` to `auth.uid()` but did not bind `email` to the authenticated identity.
- `profiles.email` has a global case-normalized uniqueness constraint.
- `src/services/organizations/repository.ts` trusts the field for profile lookup and invite/member presentation.

Impact: an authenticated attacker could reserve a victim email, block later profile creation, or cause identity misattribution.

Fix: authenticated profile creation/broad updates are revoked and unsafe policies removed. Trusted server code remains responsible for email synchronization. If self-service names are later needed, grant only `UPDATE (full_name)`.

## 2. Non-atomic invite acceptance

Severity: High
Status: Fixed with transactional RPC

Evidence: the pre-hardening invite workflow, now isolated in `src/services/organizations/invitation-service.ts`, loaded an invite, upserted membership, then marked the invite accepted without verifying a matched row. A concurrent revoke/state change could leave active membership from an unconsumed invite.

Impact: authorization could be granted after invite revocation or remain active after a partial failure.

Fix: a service-role-only `security invoker`, empty-search-path RPC locks and validates the invite, checks email/expiry, ensures the profile, activates membership, and consumes the invite atomically.

## 3. Last-owner time-of-check/time-of-use race

Severity: High
Status: Fixed with locking RPC

Evidence: the pre-hardening member-role workflow, now isolated in `src/services/organizations/membership-service.ts`, counted active owners and updated the target membership in separate statements.

Impact: simultaneous demotions in a two-owner organization could both observe count `2` and leave zero owners.

Fix: actor authorization, target validation, owner-invariant check, and update now execute under a consistent database lock order in one RPC.

## 4. Lost generated-answer updates

Severity: High
Status: Fixed with atomic merge RPC

Evidence: the pre-hardening answer workflow, now split between `src/services/document-signing/workflows.ts` and `persistence.ts`, read the full answer JSON, merged in memory, then overwrote the column. It did not verify that `.neq("workflow_status", "completed")` matched a row.

Impact: concurrent edits to different fields could overwrite each other; a completion race could silently discard a save while returning success.

Fix: the database locks the answer row, rejects completed state, validates a JSON object patch, merges it atomically, and returns persisted state. Zod/domain validation remains server-side.

## 5. Cross-origin cookie-authenticated JSON mutations

Severity: Medium
Status: Fixed

Affected routes:

- document upload allocation;
- replacement allocation;
- upload completion;
- signed download URL creation;
- document-open tracking;
- template AI suggestions.

Evidence: handlers authenticated with cookies but accepted arbitrary request content types and did not validate Origin or Fetch Metadata. `Request.json()` accepts JSON sent as CORS-safelisted `text/plain`.

Impact: a compromised same-site sibling or a deployment with permissive cookie settings could trigger state changes or paid AI calls.

Fix: shared validation rejects cross-site Fetch Metadata, rejects mismatched explicit origins against `NEXT_PUBLIC_APP_URL`, and requires JSON media types/object bodies. SameSite Lax remains defense-in-depth; server actions retain Next’s built-in origin checks.

False-positive note: unrelated cross-site origins normally do not receive Lax cookies, so this was not a universal unauthenticated CSRF primitive.

## 6. Canonical-origin redirect handling

Severity: Medium
Status: Fixed

Evidence: the auth callback used `request.url` as the base for absolute redirects after sanitizing only the path.

Impact: under a poisoned Host/proxy configuration, a valid callback could redirect to an attacker-controlled origin.

Fix: redirects are based only on required, validated `NEXT_PUBLIC_APP_URL`; invalid configuration fails closed with 500. Regression coverage sends an attacker-host request and asserts the configured origin.

## 7. RLS/application permission mismatch

Severity: Medium
Status: Fixed

Evidence: `external_reviewer` lacked `templates:view` in application permissions while the published-template RLS policy allowed any active member.

Impact: external reviewers could bypass the service and read full published template content through PostgREST.

Fix: policy roles now match owner/manager/staff semantics.

## 8. Sensitive signing-recipient columns exposed through Data API

Severity: Medium
Status: Fixed

Evidence: authenticated users had table-wide select on `document_signing_recipients`, including `token_hash`, `signature_data`, and `initials_data`. The application DTO intentionally omitted private token hashes.

Impact: any tenant member could bypass DTO redaction and retrieve signature imagery and hashes. Token entropy made practical reversal unlikely, but least privilege and biometric-like drawing sensitivity were violated.

Fix: table-wide authenticated selection is revoked and only approved columns are granted. Trusted service-role flows retain raw-column access.

## 9. Pending organization invite links exposed too broadly

Severity: Medium
Status: Contained; hashing follow-up remains

Evidence: service-role `listOrganizationPeople` checked only active membership, selected pending invite tokens, and returned them to staff/external reviewers even though invite RLS was manager-only.

Impact: lower-privilege members could enumerate addresses/roles and bearer links. Email matching and confirmation reduced immediate account takeover.

Fix: pending invites are returned only to roles with invite-management permission. Recommended next step: migrate invite tokens to SHA-256 hashes, remove plaintext persistence and listing, and provide manager-only resend/rotate.

## 10. Uploaded content trust and storage abuse

Severity: Medium
Status: Partially fixed; scanner/quota follow-up remains

Evidence:

- signed PUTs originally omitted `ContentLength`;
- promotion verified object size/type metadata but not magic bytes or structure;
- no quarantine, malware scan, stale-object lifecycle, or tenant quota existed;
- signed GETs did not force attachment disposition.

Impact: an authorized uploader could create oversized orphan objects, store malicious/mislabeled content, and distribute it to members.

Fixes in this pass: declared length is signed, uploaded-file GETs force attachment disposition, and signed bearer URL responses are no-store.

Required infrastructure mitigation: quarantine and scan, validate signatures/structures, delete rejected/stale objects, configure R2 lifecycle rules, and enforce per-tenant storage quotas.

## 11. Missing security headers

Severity: Medium
Status: Fixed

Evidence: no CSP, anti-framing, nosniff, global referrer policy, permissions policy, or HSTS existed in repository config.

Impact: public token-bearing pages could leak referrers or be framed; future XSS had no containment layer.

Fix: global CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, nosniff, no-referrer, restrictive Permissions Policy, HTTPS-production HSTS, and disabled framework signature header. HSTS and `upgrade-insecure-requests` are emitted only when the canonical production URL uses HTTPS, so a local HTTP production build is not made unusable.

Residual: the compatibility CSP allows inline scripts/styles. A nonce-based strict CSP should be evaluated against its forced dynamic-rendering cost using the official [Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy).

## 12. Unbounded paid/external operations

Severity: Medium
Status: Planned

Evidence: AI suggestions, invite email, signing email, and storage allocation have no durable per-user/tenant rate or budget policy. Provider limits protect providers, not application spend or users.

Impact: a compromised manager/staff account could generate AI charges, spam recipients, or exhaust storage/workers.

Recommendation: define product quotas, then implement atomic database/platform limits keyed by actor/organization/IP where appropriate. Return 429 and retry metadata. Do not use process-local memory in serverless deployments.

## 13. Resend transport reliability and duplication

Severity: Medium
Status: Fixed

Evidence: invite and signing services duplicated fetch/payload/error/escaping code, lacked abort timeouts, and could duplicate mail under retry ambiguity.

Fix: shared injected transport with a bounded timeout, stable provider-supported `Idempotency-Key`, one response parser, and shared HTML escaping. Domain-specific message composition/error text remains separate.

Resend documents idempotency support for `POST /emails`, 24-hour retention, and the `Idempotency-Key` header in its [official documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).

## 14. Vulnerable PostCSS transitive dependency

Severity: Low effective / Moderate upstream
Status: Fixed

Evidence: `pnpm audit --prod` reported Next resolving PostCSS 8.4.31, affected by [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93), patched in 8.5.10.

Impact: vulnerable CSS serialization can permit `</style>` breakout in specific attacker-controlled CSS-to-HTML flows. No such runtime user-controlled CSS path was found in BizFlow.

Fix: workspace override to PostCSS 8.5.16; production dependency audit is clean and enforced in CI.

## 15. Cookie and signed-URL defense in depth

Severity: Low
Status: Fixed

Evidence: Supabase SSR cookie options did not explicitly set production `Secure`; signed download URL JSON had no explicit cache policy.

Fix: server/proxy clients set `path=/`, `SameSite=Lax`, and production `Secure`; bearer URL responses set `private, no-store, max-age=0` and `Pragma: no-cache`.

Do not blindly set `HttpOnly` without moving to a deliberate server-only Supabase session design.

## 16. PII and provider detail in logs

Severity: Low
Status: Fixed

Evidence: login/signup and organization-operation contexts logged email and raw provider errors; signup returned raw provider text.

Impact: centralized logs exposed account/invite PII and implementation detail.

Fix: logs use IDs, token length, stable error types/codes/statuses; public signup failures are generic. Passwords, sessions, signing tokens, signed URLs, and raw invite tokens were never logged.

## Verified security controls

- All private route handlers authenticate.
- Service-role domain operations recheck tenant membership and action permission.
- Queries consistently scope organization and resource IDs.
- Server-side auth uses verified claims rather than trusting an unverified session.
- Internal redirects reject protocol-relative/cross-origin destinations.
- Signing tokens use cryptographic randomness, hashes, expiry, and rotation.
- R2 keys are server-generated and tenant-scoped; PUT is create-only; promotion verifies object metadata.
- Generated PDF responses are attachment-only and no-store.
- React escaping is retained; no dangerous DOM execution sink was found.
- Template/signing images are bounded PNG/JPEG data URLs.
- `.env.local` is ignored; tracked files contain placeholders rather than credentials.
- Every application table enables and forces RLS.
- Tenant relationships use composite foreign keys.
- High-risk mutation RPCs are service-role-only with empty search paths.

## Final verification evidence

- The configured remote migration ledger matches all eight local migrations through `20260718002902`.
- Direct remote Postgres lint reports no schema errors.
- JWKS and all 14 application tables pass service-role smoke reads.
- Anonymous PostgREST probes against all 14 application tables return `401`.
- ESLint, strict TypeScript, 36 test files / 219 tests, the Next production build, and `git diff --check` pass.
- The production dependency audit reports no known vulnerabilities.
- A local production response exposes CSP, no-referrer, nosniff, anti-framing, and Permissions Policy headers and omits the framework signature. HSTS is intentionally absent for the configured HTTP local URL and remains subject to deployed HTTPS edge verification.

## Required verification before production closure

1. Use two authenticated users in different tenants to prove positive/negative RLS and RPC execution behavior for the applied hardening migration.
2. Complete real browser-to-R2 PUT UAT with signed `Content-Length`, retry `412`, HEAD promotion, and historical download.
3. Inspect deployed response headers at the CDN edge.
4. Add durable rate/budget controls before enabling AI/email broadly.
5. Add quarantine/malware scanning and object lifecycle cleanup before accepting untrusted external uploads.
6. Rotate/hash organization invite tokens in a coordinated migration.
