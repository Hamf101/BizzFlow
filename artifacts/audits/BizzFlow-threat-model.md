# BizFlow Repository Threat Model

Date: 2026-07-18
Repository: /Users/ham/Documents/BizzFlow
Branch reviewed: codex/start-bizflow
Status: design and review artifact; no security recommendation in this document is approved for implementation by its presence alone.

Mandatory verification rule:

> Every mitigation below is a candidate control. Before implementation, independently verify the threat is applicable, the control actually addresses it, the selected browser/OS/provider supports it, failure modes are safe, privacy and legal consequences are acceptable, and regression tests cover the affected workflow. Do not implement security controls merely because they appear in this report.

## Executive summary

BizFlow's current cloud application has a strong starting posture: forced tenant RLS, server-side permission checks, transactional database RPCs for several integrity-sensitive workflows, create-only R2 uploads, no-store bearer URL responses, bounded schemas, and global security headers. The proposed local-first direction creates a new high-value trust zone on each dedicated device. Because the confirmed requirement includes documents, attachments, recipient data, PDFs, and drawn signatures with indefinite offline access, the highest risks are device-local data disclosure, XSS gaining access to the complete local vault, authorization that becomes stale while disconnected, replay or tampering of queued commands, conflict-driven data loss, malicious queued files, service-worker persistence, and recovery after abrupt power loss. The cloud can remain protected by treating all local state as hostile and reauthenticating, reauthorizing, validating, deduplicating, and auditing every synchronized effect. Local confidentiality cannot be made revocable while a device is fully offline: remote revocation and remote wipe are physically impossible until connectivity returns, so this residual risk requires explicit product acceptance and device-management controls.

## Scope and assumptions

In scope:

- Runtime application code under src/, including authenticated Server Actions, route handlers, public signing, services, browser components, and security helpers.
- Database schema, RLS, grants, and RPCs under supabase/migrations/.
- Deployment, dependency, build, and CI configuration in package.json, pnpm-lock.yaml, pnpm-workspace.yaml, next.config.ts, vercel.json, and .github/.
- Current integrations with Supabase, Cloudflare R2, Resend, and OpenRouter.
- The planned PWA/local database, service worker, outbox, sync, and offline-file boundaries, even though they do not exist yet.
- Conditional Tauri/SQLite risks only for a later evidence-based desktop-wrapper decision.

User-confirmed context:

- Pilot employees use dedicated devices, not intentionally shared office devices.
- Offline scope includes draft fields, attachments, complete documents, recipient information, generated PDFs, and drawn signatures.
- A previously authenticated user may read and edit the protected local data indefinitely without reconnecting.
- Slow synchronization after reconnection is acceptable; compromise of cloud authorization or tenant isolation is not.
- Complete outages may include no internet, Wi-Fi, LAN, or other network path.

Evidence-backed implementation status:

- Offline persistence is planned in README.md:24-34 and .agent/AGENT.md, but package.json:20-49 has no Dexie, service-worker, PWA, SQLite, Electron, or Tauri dependency. No manifest, service worker, IndexedDB repository, outbox, or sync endpoint currently exists.
- Current unsent files and drawings are held in component memory, for example src/components/documents/document-replace-form.tsx:22-43 and src/components/documents/drawn-signature-field.tsx:34-38. Abrupt termination therefore loses unsent work today.
- The application is currently a Next.js/Vercel cloud application using Supabase/Postgres/Auth, private R2 objects, Resend, and OpenRouter; evidence appears in package.json, vercel.json, src/lib/supabase/, src/lib/r2/, src/services/email/, and src/services/template-ai-service.ts.

Out of scope:

- Vulnerabilities inside Supabase, Vercel, Cloudflare, Resend, OpenRouter, browser engines, or operating systems that BizFlow cannot configure or mitigate, except their effect on BizFlow's design.
- Physical attacks by a fully privileged OS administrator, forensic laboratory attacks, and compromised firmware. Device theft and ordinary local malware/extension access remain in scope.
- A legal determination that any proposed signature is qualified, regulated, or admissible. Specialist legal review is required.
- Peer-to-peer organizational sharing during a complete network outage. A VPN is also out of scope because it cannot operate without an underlying network path.

Open questions that can change detailed implementation but not the principal ranking:

- Initial supported operating systems, browser versions, device-management maturity, and whether full-disk encryption is enforceable.
- Expected per-user file volume, maximum document size, and local retention/backup policy.
- Applicable Cameroon, Nigeria, sector-specific, contractual, and customer data-residency requirements.
- Whether organizations will permit the same dedicated device to switch between multiple BizFlow accounts or tenants.

## System model

### Primary components

- Browser and planned installed PWA: React/Next user interface, current in-memory form/file state, and future service worker.
- Planned local trust zone: per-user/per-organization local database, encrypted-vault candidate, immutable file staging, outbox, sync receipts, and recovery metadata.
- Next.js application: Server Components, Server Actions, route handlers, authentication callback, public signing routes, validation, orchestration, and security headers.
- Supabase: authentication, session JWTs, Postgres, Data API, forced RLS, column privileges, and privileged service-key access.
- Cloudflare R2: private document objects accessed through short-lived signed PUT/GET URLs.
- Resend and OpenRouter: email delivery and proposal-only AI generation.
- Build and delivery: pnpm registry dependencies, GitHub Actions, and Vercel build/deployment.
- Conditional Tauri runtime: native WebView, SQLite/filesystem, IPC capabilities, credential storage, installer, and updater; not currently present.

### Data flows and trust boundaries

- User and device → browser/PWA: credentials, drafts, documents, files, recipient PII, drawings, and local unlock factors cross the physical-device boundary. Current protection depends on the OS/browser profile; future validation and vault behavior are unimplemented.
- Browser/PWA → local database and staged files: future records, blobs, revisions, outbox commands, and sync cursors cross from render logic into durable browser storage. All stored values must be treated as tamperable and must be partitioned by user and organization.
- Browser/PWA → Next.js: cookies, form data, JSON, public signing tokens, and future sync batches cross HTTPS. Current JSON routes use content-type and origin checks in src/lib/request-security.ts:32-97; Server Actions use Next's request path and must still authenticate and authorize.
- Next.js → Supabase user context: auth claims and user-scoped operations cross HTTPS. src/lib/auth.ts:30-52 verifies claims; forced RLS and least-privilege grants provide defense in depth.
- Next.js → Supabase privileged context: service-key queries and RPCs cross HTTPS and may bypass RLS. src/lib/supabase/admin.ts:312-325 creates this client, making manual service checks and narrow RPC permissions security-critical.
- Browser → R2: file bytes cross HTTPS using signed create-only PUTs or signed downloads. Server-generated keys, exact declared sizes/types, If-None-Match, HEAD promotion, attachment disposition, and no-store URL responses exist, but content inspection and resumability do not.
- Next.js → Resend/OpenRouter: recipient PII, bearer links, document/template context, and provider credentials cross HTTPS. Provider behavior and contracts remain external dependencies.
- GitHub/npm → CI/Vercel → production: source, dependencies, actions, build artifacts, and environment secrets cross the software-supply-chain boundary.
- Conditional Tauri WebView → native commands/filesystem/updater: local data and privileged operations would cross IPC and OS boundaries; this boundary must be separately modeled before adoption.

#### Diagram

~~~mermaid
flowchart LR
  subgraph DeviceZone
    U["Dedicated user device"]
    UI["BizFlow UI"]
    SW["Service worker"]
    LDB["Local data vault"]
    OUT["Outbox and file staging"]
  end
  subgraph CloudAppZone
    WEB["Next.js application"]
    SYNC["Future sync gateway"]
  end
  subgraph DataZone
    AUTH["Supabase Auth"]
    DB["Postgres and RLS"]
    R2["Private object storage"]
  end
  subgraph ProviderZone
    MAIL["Email provider"]
    AI["AI provider"]
  end
  subgraph BuildZone
    CI["CI and dependencies"]
    DEPLOY["Deployment platform"]
  end
  U --> UI
  UI --> LDB
  UI --> OUT
  SW --> UI
  UI --> WEB
  OUT --> SYNC
  SYNC --> AUTH
  SYNC --> DB
  OUT --> R2
  WEB --> AUTH
  WEB --> DB
  WEB --> R2
  WEB --> MAIL
  WEB --> AI
  CI --> DEPLOY
  DEPLOY --> WEB
~~~

## Assets and security objectives

| Asset | Why it matters | Security objective (C/I/A) |
| --- | --- | --- |
| Organization records and workflow state | Cross-tenant disclosure or unauthorized changes harm customers and trust | C, I, A |
| Drafts and answers | May contain confidential business and personal information; loss after a power cut defeats the product | C, I, A |
| Attachments, source documents, and generated PDFs | Potentially sensitive and large; malicious content can attack recipients or consume resources | C, I, A |
| Recipient identities and contact details | PII exposed locally and to providers | C, I |
| Drawn signatures and initials | Sensitive identity-linked imagery; misuse can create legal and reputational harm | C, I |
| Local database, staged files, and recovery snapshots | Indefinite offline source of truth for unsynchronized work | C, I, A |
| Outbox commands, mutation IDs, revisions, and cursors | Determine what the cloud will accept and in what order | I, A |
| Authentication cookies, JWTs, refresh tokens, and device credentials | Theft can impersonate users and defeat tenant controls | C, I |
| Invite and public-signing bearer tokens | Possession may grant a scoped workflow capability | C, I |
| Supabase secret key, R2 credentials, provider keys, and future updater key | Compromise can bypass RLS, expose objects, spend money, or distribute malicious builds | C, I |
| Authorization state and RLS policies | Primary cross-tenant and role boundary | I, A |
| Audit and activity history | Supports accountability, incident investigation, and workflow evidence | I, A |
| Cloud spend and provider quotas | Abuse can deny service or create financial harm | I, A |
| Build artifacts, service worker, installers, and updates | Compromise gives code execution in every client trust zone | I, A |

## Attacker model

### Capabilities

- An unauthenticated Internet attacker can reach public auth, callback, public signing, and any accidentally exposed route.
- A malicious or compromised authenticated user can call Server Actions and route handlers directly, modify requests, tamper with local storage, replay queues, and upload hostile files.
- A lower-privilege member may attempt horizontal or vertical authorization bypass within or across organizations.
- Anyone holding a leaked invite, signing token, signed URL, browser session, backup, or exported vault can exercise that bearer capability until it expires or is rejected.
- A thief, ordinary local malware, malicious browser extension, or another process in the same OS account may read browser-accessible data or alter local files and queues.
- A network attacker or captive portal may block, delay, replay at the application level, or redirect connectivity checks, although correctly validated HTTPS should prevent content decryption or alteration.
- A dependency, CI action, deployment account, provider, or service-worker update can be compromised.
- Power loss, storage pressure, browser cleanup, schema skew, clock manipulation, and very long offline periods act as non-malicious threat sources with security and integrity consequences.

### Non-capabilities

- A remote attacker is not assumed to possess Supabase, R2, Resend, OpenRouter, Vercel, or GitHub administrator access without first compromising credentials or supply chain.
- A VPN or mesh overlay is not assumed to create connectivity when no physical or radio network exists.
- The design cannot remotely revoke, rotate, or wipe a device that is fully disconnected.
- Browser-side encryption does not protect data while the application is unlocked from same-origin XSS; this limitation prevents inflated claims about a local vault.
- A fully privileged OS administrator or firmware attacker is outside the application's containment ability.

## Entry points and attack surfaces

| Surface | How reached | Trust boundary | Notes | Evidence (repo path / symbol) |
| --- | --- | --- | --- | --- |
| Login and signup actions | Public forms invoking Server Actions | Internet → Next.js → Supabase Auth | Credentials and redirect targets | src/app/(auth)/login/actions.ts; src/app/(auth)/signup/actions.ts |
| Auth callback | Public GET callback | Internet/provider → Next.js | Uses configured canonical origin | src/app/auth/callback/route.ts |
| Invite acceptance | Bearer token plus authenticated action | Browser → Next.js → privileged DB workflow | Organization invite token currently stored raw | src/app/(auth)/accept-invite/[token]/actions.ts; supabase/migrations/20260708170500_sprint_2_organizations_roles.sql:77 |
| Public signing | Tokenized page and Server Action | Internet → Next.js → privileged signing service | Drawings and answers; final effect must not trust offline state | src/app/sign/[token]/page.tsx; src/app/sign/[token]/actions.ts |
| Organization and member actions | Authenticated Server Actions | Browser → Next.js → service-key DB | Role and membership changes | src/app/(dashboard)/dashboard/actions.ts; src/app/(dashboard)/people/actions.ts |
| Document and template actions | Authenticated Server Actions | Browser → Next.js → services/DB | Drafts, comments, archive, publishing, invitations | src/app/(dashboard)/documents/actions.ts; src/app/(dashboard)/documents/[documentId]/edit/actions.ts; src/app/(dashboard)/templates/actions.ts |
| Document JSON routes | Authenticated POST/GET | Browser → Next.js | Origin/content-type validation, schemas, resource limits | src/app/api/documents/; src/lib/request-security.ts |
| AI suggestion route | Authenticated POST | Browser → Next.js → OpenRouter | Paid external operation with document context | src/app/api/templates/suggest-blocks/route.ts; src/services/template-ai-service.ts |
| Direct R2 signed requests | Short-lived signed URL | Browser → R2 | Bytes bypass Next.js after allocation; server later HEAD-checks metadata | src/components/documents/document-upload-client.ts; src/services/document-storage-service.ts |
| Supabase Data API | Publishable/user JWT or privileged server client | Client/server → Supabase/Postgres | RLS/grants versus service-key bypass | src/lib/supabase/; supabase/migrations/ |
| Future local database | Same-origin app, extension, local process, user | UI → browser storage | Contains full offline data scope indefinitely | Planned; package.json currently has no implementation |
| Future service worker/cache | Installed origin code | Network/app shell → persistent browser proxy | Can persist poisoned code or cache private responses | Planned; no current service worker |
| Future sync gateway | Reconnection and batch push/pull | Hostile local state → cloud authority | Highest-value new endpoint | Planned; no mutation receipt/cursor schema found |
| Local backups and exports | User/support workflow | Local vault → filesystem/removable media | Can escape browser/OS protections | Planned |
| CI and dependency installation | GitHub events and package resolution | External supply chain → build | Actions use major tags; no SBOM/provenance | .github/workflows/ci.yml; package.json; pnpm-workspace.yaml |
| Conditional Tauri IPC/updater | WebView commands, deep links, installers | Web content → native privileges | Not currently implemented | Out of current runtime; future gated decision |

## Top abuse paths

1. Local-vault exfiltration: attacker obtains an unlocked or poorly protected dedicated device → reads IndexedDB/staged files → exfiltrates documents, recipient PII, PDFs, and signatures → revocation cannot arrive while offline.
2. XSS amplification: attacker gets stored or supply-chain script execution → reads the complete future local database and queue → steals sessions and documents or alters queued commands → service worker persists the compromise.
3. Stale authorization: employee is removed from an organization while a device remains offline → user continues reading/editing cached data indefinitely → reconnect attempts to upload privileged changes → weak sync authorization accepts stale authority.
4. Queue privilege injection: attacker edits local outbox fields to claim another actor, organization, role, timestamp, or command type → sync gateway trusts client metadata → cross-tenant or privileged mutation occurs.
5. Retry duplication: network drops after the server commits but before the client receives the receipt → client retries → non-idempotent create/comment/file workflow executes twice → duplicate records, notifications, or spend.
6. Conflict and resurrection: two devices edit the same answer or one deletes/archives while another stays offline → arrival-order merge or expired cursor silently overwrites data → deleted state reappears or a completed document changes.
7. Hostile file pipeline: authorized user stages bytes that do not match the claimed MIME type → upload resumes through a fresh signed URL → server validates only metadata → malicious file reaches coworkers or consumes scanner/parser resources.
8. Service-worker cache leak: broad fetch handler caches auth, signing, PDF, API, or signed-URL responses → a later account/session or local attacker retrieves them → bearer tokens or tenant data escape intended lifetime.
9. Build compromise: mutable CI action/dependency or future updater key is compromised → malicious bundle/service worker/installer ships → attacker gains every client's local data and cloud session.
10. Recovery leak: support/export tooling captures raw vaults, logs, filenames, bearer URLs, or signatures → artifact is emailed or uploaded without protection → incident-response tooling becomes an exfiltration path.

## Threat model table

| Threat ID | Threat source | Prerequisites | Threat action | Impact | Impacted assets | Existing controls (evidence) | Gaps | Recommended mitigations | Detection ideas | Likelihood | Impact severity | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TM-001 | Thief, local malware, same-account process | Device contains indefinite offline data | Read local database, staged files, snapshots, or unlocked UI | Disclosure of an organization's complete cached corpus | Local vault, files, PII, signatures | Dedicated-device assumption; no local database exists yet | No app vault, OS policy, remote wipe, or offline revocation; browser encryption design unresolved | Candidate: require OS account separation/full-disk encryption, automatic app lock, per-user/org vault, minimal plaintext, secure disposal, and reconnect wipe after revocation. Verify on target OS/browser with theft and cold-start tests; document that offline remote wipe remains impossible. | Device posture failures, repeated unlock failures, reconnect of revoked device, vault export events without content logging | Medium — dedicated devices help, but theft and malware are realistic over indefinite retention | High — potentially complete tenant disclosure | High |
| TM-002 | XSS, malicious extension, compromised dependency | Script executes in BizFlow origin or browser context | Read/alter IndexedDB, files, queue, cookies available to JS, or service worker | Mass local exfiltration, command tampering, persistent compromise | All local data, sessions, build trust | React escaping; no dangerous DOM sink found; CSP in next.config.ts:6-30 | Production script policy includes unsafe-inline; future local data raises blast radius; encryption cannot protect unlocked data from same-origin code | Candidate: eliminate script sinks, evaluate nonce/hash CSP and Trusted Types, minimize third-party JS, self-host/pin critical assets, isolate local repository APIs, and add XSS regression tests. Verify Next rendering compatibility and deployed headers before enforcement. | CSP report-only telemetry without PII, SAST sink checks, dependency monitoring, canary local records in security testing | Medium | High | High |
| TM-003 | Removed user, stolen device, revoked session | Device stays offline indefinitely after authority changes | Continue reading/editing cached data and later present stale commands | Local confidentiality persists; weak sync could accept revoked actions | Authorization state, cached records, outbox | Cloud services currently authenticate and check membership; src/lib/auth.ts:30-52 and domain shared helpers | Offline app cannot learn revocation; getClaims alone does not prove a live session; no device registry or reconnect handshake | Candidate: permit indefinite local access only as an accepted residual risk; require fresh authentication, live membership, session/device status, and current resource permission before every push; reject and locally lock/wipe on reconnect when revoked. Verify Supabase session semantics and revocation integration before implementation. | Rejected stale-session/device commands, membership-revocation sync attempts, device last-seen alerts | High — indefinite disconnection makes stale authority inevitable eventually | High | High |
| TM-004 | Account switch, device reassignment, implementation defect | More than one account or organization uses an installation | Read another identity's cache or sync under the wrong tenant | Cross-user/cross-tenant disclosure or corruption | Tenant records, local vault, queue | Dedicated devices reduce intended sharing; cloud queries bind organization and IDs | No local partitioning/logout behavior exists | Candidate: key every table/blob/outbox/receipt by immutable local user and org scope, use separate vaults, fail closed on ambiguous identity, lock on logout, and define purge/transfer behavior. Verify account/org-switch and device-reassignment tests before implementation. | Scope mismatch counters, local invariant checks, rejected cross-scope commands | Low to Medium | High | High |
| TM-005 | Malicious local user or tampered database | Sync gateway accepts client fields | Forge actor, role, organization, timestamps, workflow state, or privileged command | Privilege escalation or tenant compromise | Authorization, workflow state, audit | Current services recheck permissions; src/lib/permissions.ts and service shared modules | Future command dispatcher does not exist; service-key client bypasses RLS | Candidate: allowlist command types; derive actor/session/device server-side; load current org/resource; reauthorize each command; ignore client role/actor; run narrow transactional RPCs. Verify negative authorization tests for every command. | Per-command authz denials, impossible actor/org combinations, tamper test suite | Medium | High | High |
| TM-006 | Developer error or client-bundle import | Privileged Supabase helper is reused by future sync/client code | Expose secret key or omit a manual tenant check while RLS is bypassed | Full database compromise or cross-tenant access | Supabase secret, tenant data | Environment validation and non-persisted admin session; src/lib/supabase/admin.ts:312-325 | No explicit server-only import fence; widespread trusted client makes omissions consequential | Candidate: add server-only fencing and boundary tests, centralize privileged sync dispatcher, minimize service-key surface, prefer user-context/RLS where practical, and scope RPC execution. Verify bundle inspection, Supabase key semantics, RLS negatives, and migration grants before implementation. | Client-bundle secret scans, CI import-boundary rule, Data API/RLS probes, audit of admin calls | Medium | High | High |
| TM-007 | Normal retry or malicious replay | Commit succeeds but response is lost, or queue is copied | Re-submit create/update/provider action | Duplicate documents, comments, notifications, files, costs, or inconsistent state | Workflow integrity, spend, audit | Some DB RPCs and Resend transport are idempotent; migrations 20260717193648 and 20260717194631; src/services/email/resend-transport.ts:69-105 | No universal mutation receipt, device ID, payload binding, or offline protocol | Candidate: unique org/actor/device/mutation receipt with canonical payload hash; atomically authorize, mutate, audit, and receipt; exact replay returns prior result and changed-payload reuse rejects. Verify crash-between-commit-and-response and malicious replay tests. | Duplicate-key/replay metrics, payload-hash mismatch alerts, receipt age/distribution | High | High | High |
| TM-008 | Queue corruption, concurrency, attacker | Commands have dependencies or are processed concurrently | Reorder create/upload/complete/sign/archive operations | Invalid transitions, orphan state, or bypassed invariants | Documents, versions, signatures, audit | Several current RPCs lock and validate transitions | No outbox dependency or sequencing contract | Candidate: explicit command dependencies and per-entity sequence/preconditions; server state machine remains authoritative; independent commands may parallelize only after proof. Verify randomized reorder/concurrency/property tests. | Invalid-transition metrics, dependency-blocked queue depth, reconciliation alarms | High | High | High |
| TM-009 | Concurrent devices or long-offline edits | Same entity changes in cloud and locally | Arrival-order or whole-object merge silently overwrites work | Lost answers, signatures, workflow decisions, or document state | Drafts, answers, revisions | Template revision compare-and-swap; generated answer merge RPC locks rows | Answers/documents/folders lack consistent base revisions; JSON merge is arrival-order for same fields | Candidate: server revision per mutable entity, base-revision precondition, explicit conflict payload, field-specific merge only where proven safe, and human resolution for sensitive conflicts. Verify multi-device conflict corpus and no-silent-loss invariant. | Conflict rate, rejected stale base revisions, unresolved conflict age | High | High | High |
| TM-010 | Long-offline client | Server data is deleted/archived or change history expires | Client misses deletion and re-creates stale state | Data resurrection, retention failure, contradictory workflow | Records, deletion state, retention | Archive flags exist for several entities | No durable change sequence, sync epoch, cursor retention contract, or universal tombstones | Candidate: monotonic server change sequence, tombstones with defined retention, cursor validity/epoch, and safe full-resnapshot path that preserves unacknowledged outbox items. Verify clients offline beyond retention and delete/edit races. | Cursor-expired events, resurrection invariant checks, tombstone lag | Medium | High | High |
| TM-011 | User/device clock manipulation or drift | Client time affects ordering, expiry, or evidence | Backdate signatures, extend lease, reorder events, or poison audit | Misleading history and invalid security decisions | Audit, leases, signatures, conflict resolution | Cloud timestamps used in existing services/RPCs | Future offline event time semantics undefined | Candidate: use server receipt/order time for authority; retain client time only as untrusted metadata with clock-offset diagnostics; never base auth or token expiry on device clock. Verify large forward/backward clock changes. | Clock-skew metrics, impossible timestamp ordering, server/client delta | High | Medium to High | High |
| TM-012 | Failure or malicious client | Audit write is best effort or client supplies event | Mutation commits without trustworthy evidence, or logs are forged | Weak investigation and accountability | Audit/activity history | Several atomic comment/archive/completion workflows; current best-effort helpers in src/services/documents/audit.ts:14-29 and src/services/organizations/shared.ts:87-100 | Sync audit contract absent; client event is untrusted | Candidate: atomically record authoritative high-risk mutation, receipt, actor, and server time; mark client-origin metadata; define which events may remain best effort. Verify rollback and audit-failure tests against documented compliance needs. | Mutation-without-audit invariant query, audit pipeline health, tamper-evident export checks | Medium | High | High |
| TM-013 | Power cut, browser termination, storage corruption | Save spans multiple writes or acknowledged data is not durable | Leave torn entity/outbox/file state or lose last work | Irrecoverable offline work and later corrupt sync | Local database, outbox, staged files | IndexedDB is not implemented; current in-memory work is lost | Atomic save contract, durability mode, checkpoints, reconciliation, and recovery UI absent | Candidate: atomically commit entity revision plus outbox intent; stage immutable file completely before enqueue; show saved only after commit; startup reconciliation/quarantine; periodic verified recovery snapshot. Verify forced-kill and power-loss tests on target hardware before claims. | Startup repair counts, checksum failures, abandoned transaction/file metrics | High | High | High |
| TM-014 | Old client, failed update, malicious rollback | Device reconnects after long offline period with old schema/protocol | Send incompatible commands or run destructive migration | Data corruption, bypassed validation, denial of service | Local/cloud schemas, queue, availability | Versioned cloud migrations and CI exist | No local schema migration, minimum client, protocol version, or rollback design | Candidate: transactional forward-only local migrations with backup/recovery; version every command; server enforces supported range and safe upgrade path; never delete unacknowledged outbox during rebuild. Verify upgrade from every supported historical version and deliberate downgrade. | Old-client rejections, migration failure telemetry, protocol-version distribution | Medium | High | High |
| TM-015 | Browser eviction, quota exhaustion, hostile/large input | Indefinite files consume origin quota or persistence is denied | Writes fail, origin is cleared, or sync stalls | Data loss and local denial of service | Local vault, files, availability | File size limits exist server-side | No persistence request, quota admission, local caps, export/recovery, or capacity UX | Candidate: measure quota/persistence, enforce per-user/org local budgets and safety margin, admission control before capture, backpressure, user-visible storage health, and encrypted export/restore. Verify denial, eviction, full-disk, and user-cleared-data cases; do not promise browser guarantees not observed. | Storage estimate thresholds, quota errors, pending-byte age, export success | Medium to High | High | High |
| TM-016 | Compromised deployment, cache poisoning, unsafe update | Service worker controls requests and persists across sessions | Serve malicious/stale code or retain vulnerable application shell | Persistent local data theft or integrity compromise | App code, local vault, sessions | No service worker currently exists; global headers present | Cache/update/rollback policy unimplemented | Candidate: cache only allowlisted versioned static assets; no arbitrary runtime caching; updateViaCache none; atomic activation; old-cache deletion; recoverable rollback; minimum supported app version. Verify poisoned-cache and interrupted-update tests before release. | SW version telemetry, unexpected cache-key scan, CSP/integrity reports | Medium | High | High |
| TM-017 | Caching bug, browser/plugin behavior | Service worker or CDN caches private/bearer response | Reuse auth callback, signing page, API JSON, PDF, or signed URL under another session | Token or tenant-data disclosure | Sessions, tokens, PDFs, private data | Signed URL and PDF responses use private/no-store; public signing uses no-referrer metadata | No service-worker exclusions or deployed cache verification | Candidate: explicit network-only denylist for auth, sign, private API, PDFs, and R2; strip token-bearing URLs from logs/history where feasible; test cache storage after each sensitive flow. Verify actual CDN/browser headers. | Automated cache inventory, response-header probes, canary token scan | Medium | High | High |
| TM-018 | Browser lifecycle and network outage | Correctness depends on service-worker Background Sync | Browser terminates worker or API is unsupported | Queued work remains stuck or partially applied | Outbox, files, availability | None; feature is planned | No foreground-first retry/manual recovery model | Candidate: durable outbox is truth; sync on launch, authenticated foreground, reconnect, and manual action; background sync only accelerates bounded work. Verify browser support and worker termination; never acknowledge completion before server receipt. | Queue age, last successful foreground sync, manual retry outcomes | High | High | High |
| TM-019 | Authorized malicious uploader or disguised content | Allowed MIME metadata is trusted | Upload malware, parser exploit, active content, or resource bomb | Harm to recipients, scanners, previews, and storage | Files, devices, availability | MIME/size allowlist, exact signed length, create-only PUT, metadata HEAD, attachment download; src/services/document-storage-service.ts:127-187 and 267-303 | No magic-byte/structure validation, quarantine, malware scan, checksum enforcement, or local preview isolation | Candidate: quarantine → bounded signature/structure validation → isolated malware scan → checksum verification → available; safe attachment delivery and sandboxed preview. Verify scanner efficacy, parser limits, false positives, privacy, cost, and provider workflow before implementation. | Scan verdicts, MIME mismatch rate, decompression/parse limits, quarantine age | Medium | High | High |
| TM-020 | Network failure, tampered queue, URL leak | Large file upload is interrupted or signed URL is persisted/replayed | Upload partial/wrong bytes, reuse expired URL, or delete local bytes too early | Corruption, data loss, orphan objects, bearer leakage | Files, R2 objects, queue | Short-lived URLs, create-only PUT, exact size/type HEAD, no-store download URL | Single PUT has no resumability; checksum deferred; abandoned allocations lack reconciliation | Candidate: store bytes plus immutable intent and hash, never persist signed URL, obtain fresh authorization/URL online, use verified resumable protocol, retain bytes until authoritative receipt, reconcile orphans/stale allocations. Verify R2 multipart/checksum/CORS and real low-bandwidth interruption tests. | Hash mismatch, incomplete multipart age, orphan/pending counts, retry distribution | High | High | High |
| TM-021 | Authenticated attacker, corrupted client, bot | Sync accepts large/compressed/batched or expensive input | Exhaust CPU, DB locks, storage, provider budget, or tenant quota | Service degradation and financial harm | Availability, spend, DB | Current schemas and some size bounds; next.config.ts permits 10 MB Server Actions | No sync batch/body limits, decompression limits, durable rate/budget policy, or backpressure | Candidate: strict discriminated schema with unknown-field rejection, compressed/uncompressed caps, max commands/files, per-command bounds, per-IP/user/device/org rate and budget limits, timeouts and fair backpressure. Verify platform limits and load tests before setting values. | 429s, batch size/latency, lock time, provider spend anomalies, tenant quota alerts | High | Medium to High | High |
| TM-022 | Captive portal, network attacker, unreliable connectivity | Client treats navigator state or arbitrary response as connectivity/auth proof | Send data to wrong endpoint, loop retries, or accept downgrade | Leakage, battery/data exhaustion, delayed sync | Network traffic, credentials, availability | Production HTTPS/HSTS conditional headers; canonical application URL | Reconnection protocol and endpoint pinning absent; VPN would not solve full outage | Candidate: HTTPS only, canonical host allowlist, normal certificate validation, authenticated health/sync handshake, bounded jittered retry, and explicit captive-portal handling; never trust navigator.onLine as authority. Verify on target networks without disabling TLS checks. | TLS/host failures, captive detection, retry budget exhaustion | Medium | High | High |
| TM-023 | Stale user or local attacker | Privileged workflow is allowed to finalize offline | Finalize signature, publish/archive, invite, change roles, send email/AI, or allocate bearer URL without live authority | Irreversible unauthorized effect, spam, spend, legal ambiguity | Authorization, signatures, workflow, providers | Current operations are server-side and permission checked | Offline product semantics not defined | Candidate: allow offline capture as provisional data, but require fresh online authz and server state transition for finalization/provider effects; display pending status clearly. Verify each command classification with product/legal owners and negative tests. | Attempts to execute online-only command offline, server rejection rate, pending-finalization age | Medium | High | High |
| TM-024 | Token thief, logs, local backup, email compromise | Invite/signing token or signed URL is exposed | Exercise bearer link or replay scoped capability | Unauthorized invite/signing/document access | Bearer tokens, documents, identity | Signing tokens are random, hashed, expiring; no-store URL responses; attachment delivery | Organization invite token stored raw; offline cache/export could retain links | Candidate: hash organization invite tokens, rotate/resend rather than reveal, never store bearer URLs/links in outbox or cache, short expiry and one-time/transition checks. Verify migration, replay, referrer, logs, and support tooling before implementation. | Token reuse, expired-token attempts, canary secret scans, link issuance/access correlation | Medium | High | High |
| TM-025 | Logging, crash reporter, support process, user export | Diagnostics capture sensitive local/cloud values | Persist or transmit PII, filenames, bodies, signatures, tokens, URLs, keys, or raw errors | Secondary data breach | Logs, backups, secrets, local data | Prior hardening removed several PII logs; structured contextual logs exist | Ad hoc console calls remain; one R2 path logs raw error; local crash/support design absent | Candidate: centralized structured redaction, metadata-only sync logs, encrypted user-confirmed exports, minimal crash dumps, retention/access controls, and canary-secret tests. Verify deployed provider behavior and sample artifacts. | Automated secret/PII scanning of logs and support bundles, access audit | Medium | High | High |
| TM-026 | Dependency, CI action, deployment/update compromise | Mutable upstream or stolen release credential | Ship malicious web bundle, service worker, native installer, or update | Fleet-wide code execution and local/cloud data theft | Build artifacts, clients, secrets | Frozen lockfile CI, read-only token, production audit, restricted install scripts, integrity-pinned pnpm | Actions pinned to major tags; no SAST/secret scan/SBOM/provenance; native signing absent | Candidate: immutable action SHAs with update process, dependency automation, secret/SAST scans, SBOM/provenance, protected releases, and—if Tauri—code-signing/updater-key ceremony and rollback protection. Verify reproducible release and compromised-update drills. | Provenance verification, dependency alerts, release-signature failure, unexpected SW/install hash | Medium | High | High |
| TM-027 | Provider, misconfiguration, compromised account | Sensitive content is sent to Resend/OpenRouter | Retain, expose, or process data outside expected jurisdiction/purpose | Privacy, contractual, regulatory, and reputational harm | PII, template/document content, bearer links | OpenRouter input bounds, proposal-only output, data_collection deny; Resend timeout/idempotency | Provider flags are not contractual deletion; consent/residency classification incomplete | Candidate: data classification/minimization, online-only provider calls, consent and tenant controls, DPA/subprocessor/residency review, key rotation, spend limits. Verify current contracts and applicable law with qualified counsel before implementation. | Provider-call audit without content, consent/config drift, unusual volume | Medium | High | High |
| TM-028 | User confusion, spoofed origin, unsupported browser | User installs wrong app or browser lacks required guarantees | Enter credentials into lookalike or rely on unsupported offline behavior | Credential theft or false durability promise | Identity, local work | HTTPS deployment and canonical app origin planned | Install provenance, capability gate, support matrix, and storage-status UX absent | Candidate: verified publisher/origin instructions, in-app install flow, capability and persistence self-test, unsupported-mode block/warning, signed release links if native. Verify on every supported browser/device. | Install-origin analytics without identity, capability failures, support-version distribution | Medium | Medium | Medium |
| TM-029 | User, support, device lifecycle | Logout/purge/export/disposal semantics are incomplete | Leave deleted data, lose needed recovery, or expose an unencrypted copy | Confidentiality breach or irrecoverable work | Local vault, backups, retention | No local persistence exists | Secure deletion cannot be guaranteed on browser/SSD media; remote wipe impossible offline | Candidate: define lock versus purge, retention/compaction, encrypted export/restore, device reassignment and disposal guidance, reconnect revocation wipe, and honest residual-risk language. Verify recoverability and forensic expectations; do not claim cryptographic erasure without proof. | Vault age/size, purge confirmation, export/restore drills, device decommission checklist | High | Medium to High | High |
| TM-030 | Multi-tab/process race | Two tabs or sync workers act on one local store | Double-send, overwrite leases, or corrupt queue ownership | Duplicate mutations and confusing local state | Outbox, receipts, local DB | IndexedDB transactional semantics would help but are not implemented | No leader election/lease/locking design | Candidate: single sync leader with expiring lease, transactionally claimed jobs, server idempotency as final defense, and safe takeover after crash. Verify multi-tab, suspend/resume, and killed-leader tests. | Concurrent leader detection, duplicate claim/replay metrics | Medium | Medium to High | High |
| TM-031 | Compromised authenticated account or automation | Paid/external actions lack durable quotas | Repeatedly call AI, email, signed allocation, or heavy render paths | Financial loss, spam, availability degradation | Spend, reputation, availability | Authz, input bounds, provider timeouts; Resend idempotency | No durable per-actor/org/IP rate/budget controls | Candidate: define product quotas and implement atomic platform/DB limits, concurrency caps, 429/retry metadata, and provider budget alerts. Verify expected pilot behavior and serverless concurrency before thresholds. | Cost dashboards, rate-limit counters, send/AI anomalies | High | Medium to High | High |
| TM-032 | Future Tauri WebView content, deep link, local process, updater attacker | Tauri/SQLite is adopted | Abuse IPC/filesystem scope, steal DB/key, inject deep link, expose local listener, or install rollback/malicious update | Native privilege escalation, data theft, fleet compromise | Local files, credentials, updater trust | Tauri is not present, so no current exposure | No capability policy, IPC authz, path validation, signing/notarization, key management, or updater design | Candidate and conditional: run a separate Tauri threat model; minimal capabilities, narrow typed commands, sender validation, app-data path confinement, OS credential store, no local listener unless justified, signed atomic updates and rollback protection. Verify on each OS before choosing Tauri. | IPC denial logs, capability inventory, installer/update signature tests, filesystem boundary tests | Low now; Medium if adopted | High | Medium now |

## Criticality calibration

Critical:

- A remotely exploitable path that exposes the Supabase secret/service key, bypasses tenant authorization broadly, or distributes malicious code to the entire installed fleet.
- A sync flaw that permits an unauthenticated or cross-tenant attacker to execute arbitrary privileged commands at scale.
- A verified compromise of installer/service-worker/update signing that gives persistent code execution across customers.

High:

- Theft or XSS disclosure of a tenant's indefinite local documents, recipient data, or signatures.
- Acceptance of stale, forged, duplicated, or conflicting offline commands that causes unauthorized or irreversible workflow changes.
- Malicious-file, storage, or rate abuse with material customer, availability, or cost impact.

Medium:

- Conditional Tauri weaknesses before Tauri exists.
- Install spoofing or unsupported capability behavior requiring user interaction and limited to one device.
- Targeted information exposure or denial of service with bounded scope and practical recovery.

Low:

- Low-sensitivity implementation details without a path to protected data or authority.
- Noisy abuse that is already strongly rate-limited and has negligible customer/cost impact.
- Hypotheses whose required attacker control is not present in BizFlow's intended deployment.

No current threat was assigned Critical because the review did not verify a present pre-auth tenant bypass, secret exposure, arbitrary code execution path, or compromised build channel. Several High risks become release-blocking when offline persistence is introduced.

## Focus paths for security review

| Path | Why it matters | Related Threat IDs |
| --- | --- | --- |
| src/lib/supabase/admin.ts | Creates the privileged RLS-bypassing client and needs a server-only boundary | TM-005, TM-006 |
| src/lib/auth.ts | Defines verified identity behavior and future reconnect authentication | TM-003, TM-005 |
| src/lib/supabase/proxy.ts | Refreshes sessions and gates routes; actual cookie/session behavior must be tested | TM-003, TM-024 |
| src/lib/request-security.ts | Current origin/JSON contract; native sync will require a separate explicit auth contract | TM-005, TM-021, TM-022 |
| src/lib/permissions.ts | Canonical role/action mapping used by server authorization | TM-003, TM-005 |
| src/services/documents/shared.ts | Tenant/resource authorization choke point | TM-005, TM-006 |
| src/services/templates/shared.ts | Template tenant and permission checks | TM-005, TM-009 |
| src/services/document-signing/ | Token, drawing, persistence, and irreversible signing workflows | TM-002, TM-023, TM-024 |
| src/services/documents/version-upload-service.ts | Current non-resumable allocation and privileged create path | TM-007, TM-020 |
| src/services/document-storage-service.ts | R2 signing, metadata validation, and content-trust gap | TM-019, TM-020 |
| src/components/documents/document-upload-client.ts | Direct browser-to-R2 request and future staging integration | TM-018, TM-020 |
| src/services/documents/audit.ts | Best-effort audit behavior | TM-011, TM-012 |
| src/services/organizations/shared.ts | Organization audit and privileged identity context | TM-005, TM-012 |
| src/services/template-ai-service.ts | External PII/context and paid-operation boundary | TM-021, TM-027, TM-031 |
| src/services/email/ | Bearer links, PII, provider retry/idempotency | TM-024, TM-025, TM-027, TM-031 |
| src/app/api/ | All current route handlers and future sync endpoint patterns | TM-005, TM-021, TM-022 |
| src/app/sign/ | Public bearer-token workflow and sensitive response caching | TM-017, TM-023, TM-024 |
| next.config.ts | CSP, cache-related headers, HSTS, and action body limit | TM-002, TM-017, TM-021 |
| supabase/migrations/20260718002902_audit_security_hardening.sql | RLS/grant hardening and transactional integrity baseline | TM-005, TM-006, TM-009, TM-012 |
| supabase/migrations/ | Future receipts, revisions, change sequence, tombstones, and quotas must preserve forced RLS | TM-007 through TM-015, TM-021 |
| package.json and pnpm-workspace.yaml | Dependency versions, scripts, and install-script policy | TM-026 |
| .github/workflows/ci.yml | Build trust, action pinning, scanning, and future release signing | TM-026 |
| Planned src/offline/ or equivalent | Local repositories, vault, autosave, outbox, files, migrations, and recovery | TM-001 through TM-018, TM-029, TM-030 |
| Planned sync gateway and RPCs | Final authority for hostile offline state | TM-003 through TM-015, TM-021, TM-023 |

## Quality check

- [x] Covered all currently discovered public, authenticated, file, provider, Data API, local, sync, and build entry points.
- [x] Represented every identified trust boundary in at least one threat.
- [x] Separated current confirmed gaps, planned offline-design threats, and conditional Tauri threats.
- [x] Separated runtime concerns from CI/build/release concerns.
- [x] Reflected the user's dedicated-device, complete-offline-data, and indefinite-access clarifications.
- [x] Made the impossibility of offline remote revocation/wipe explicit.
- [x] Kept the cloud-authority invariant central: local state is never trusted.
- [x] Marked every mitigation as a candidate requiring verification before implementation.
- [x] Identified focused repository paths for manual follow-up.
- [x] Avoided claiming legal compliance, guaranteed local encryption, guaranteed browser durability, or zero risk.
