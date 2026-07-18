# BizFlow Offline Foundation Plan

Date: 2026-07-18
Status: approved for next-work execution; implementation has not started
Priority: mandatory next work before Sprint 6 or any later feature sprint

## Execution lock

The next agent must begin with this plan. It must not select the next numbered product sprint.

The user's 2026-07-18 instruction authorizes the agent to start Phase 0. It should pause only when a documented stop condition is reached, a release-blocking gate fails, or an external/destructive action requires additional authority.

Required order:

1. Execute the Offline Foundation security and durability spike.
2. Record evidence and make the PWA-versus-Tauri storage decision.
3. Resolve or explicitly accept every failed release-blocking gate.
4. Implement the Offline Foundation in the phases below.
5. Verify the complete save, crash recovery, authorization, sync, conflict, and file path.
6. Resume Sprint 6 only after the foundation is accepted.

No application-code phase may silently skip the spike, and no sprint-status document may mark the foundation complete without fresh evidence.

## Verification-before-implementation rule

Every architecture or security control in this plan is a candidate until verified.

Before implementing a candidate:

- Confirm the threat or failure mode exists in BizFlow's actual design.
- Confirm the proposal addresses that failure mode rather than merely moving it.
- Verify current official browser, Next.js, Supabase, R2, and—if selected—Tauri documentation.
- Prototype risky platform behavior on target pilot devices.
- Define regression, negative, recovery, and observability tests.
- Check performance, bandwidth, storage, support, privacy, and legal consequences.
- Prefer the smallest control that satisfies a known requirement.

If a control cannot be verified, stop and record the uncertainty instead of representing it as protection.

## Product decision

BizFlow is a local-first desktop cloud application for environments with slow, intermittent, or absent connectivity and abrupt power loss.

Confirmed requirements:

- Employees use dedicated devices.
- Offline data includes draft fields, attachments, complete documents, recipient information, generated PDFs, and drawn signatures.
- A previously authenticated user can read and edit the protected local data indefinitely while disconnected.
- Delayed or slow upload after reconnect is acceptable.
- A hostile, corrupted, stale, or replayed device must not bypass current cloud authorization or tenant isolation.
- Work acknowledged as locally saved must survive application termination and the tested power-loss envelope.

The key distinction is:

- Local availability may continue indefinitely.
- Cloud authority never continues indefinitely. Every synchronized effect requires fresh server authentication, live membership, current resource authorization, validation, idempotency, and audit.

## Unavoidable residual risk

An indefinitely disconnected device cannot receive account revocation, membership changes, key rotation, remote-lock, or remote-wipe commands. No architecture, VPN, or cloud service can remove this physical limitation.

The product can reduce but not eliminate local disclosure through:

- dedicated OS accounts;
- enforceable full-disk encryption where available;
- a protected, automatically locking BizFlow local vault;
- minimal plaintext and temporary-file exposure;
- reconnect-time revocation handling;
- encrypted export and controlled device disposal;
- honest administrator and user guidance.

The server must reject every upload from a removed user or revoked device once connectivity returns. This protects the cloud and other tenants, but it does not retroactively erase local data viewed while offline.

## VPN decision

Do not build a BizFlow VPN as part of this phase.

A VPN:

- requires an underlying internet, Wi-Fi, LAN, mobile, satellite, or other network path;
- cannot save local work during total connectivity loss;
- cannot remotely revoke a fully disconnected device;
- does not prevent XSS, local database theft, queue tampering, malicious files, conflicts, or power-loss corruption;
- adds routing, key management, client support, performance, monitoring, and incident-response obligations;
- may worsen low-bandwidth latency and throughput through tunneling or backhaul.

Continue to protect cloud traffic with correctly validated HTTPS/TLS. If a future enterprise customer needs private access to an on-premises service or hidden cloud origin, evaluate a managed Zero Trust/private-tunnel product as a separate infrastructure decision. Do not create a custom VPN product without a distinct business requirement and threat model.

## Technology decision

### Provisional implementation path

Start with a measured architecture spike, not a blind framework commitment.

Candidate A:

- Installable Next.js PWA.
- IndexedDB accessed through Dexie.
- Service worker restricted to the versioned application shell.
- Foreground-first synchronization.

Candidate B:

- Tauri 2 desktop client.
- SQLite configured and tested for crash-safe durable work.
- App-data filesystem for immutable staged files.
- OS credential store or verified Tauri secret facility.
- Existing Next.js application retained as cloud web/API/public-link service.

### Decision rule

Select PWA only if target-device evidence proves all non-negotiable requirements:

- safe recovery after forced termination and tested power interruption;
- sufficient persistent capacity for the required document/file corpus;
- clear handling when persistence is denied or browser data is cleared;
- acceptable local-vault protection and automatic locking;
- reliable schema migration and long-offline upgrade behavior;
- no unsafe private-response caching;
- workable encrypted export/restore;
- acceptable support across selected pilot browsers.

If any non-negotiable requirement fails, select Tauri plus SQLite before building the business workflow slice. Do not build the complete PWA data layer and then rediscover that the browser cannot meet a known hard requirement.

Tauri is not permission to rewrite the cloud stack. Preserve Next.js, React/TypeScript domain/UI work, Supabase/Postgres/RLS, R2, Zod, Resend, OpenRouter, PDF logic, and tests where compatible. Add a desktop client and shared contracts only where the chosen runtime requires them.

## Non-goals

- Peer-to-peer organization sharing with no network path.
- A custom VPN, mesh network, or local server.
- Trusting a device because it was previously authenticated.
- Fully automatic conflict resolution for legally or operationally sensitive fields.
- Qualified or regulated electronic-signature claims.
- Offline execution of role changes, invitations, provider calls, or final irreversible transitions.
- A generic synchronization framework for hypothetical future entities.
- Replacing Supabase, R2, Resend, or OpenRouter without evidence that they cannot meet the requirements.

## Security and integrity invariants

These invariants are release-blocking:

1. Local data, clocks, identities, roles, organization IDs, command types, and file metadata are untrusted.
2. No client contains Supabase secret/service, R2, Resend, OpenRouter, database, or updater private keys.
3. Every push authenticates a current session and checks live membership and action permission.
4. Server code derives actor identity and authoritative timestamps.
5. Every command has a unique mutation ID and canonical payload hash.
6. The server atomically authorizes, mutates, audits, and records a mutation receipt for high-integrity changes.
7. Exact replay returns the original result; mutation-ID reuse with another payload fails.
8. Mutable records use a server revision or equivalent precondition; conflicts are explicit and never silently discarded.
9. Deletes and archives cannot be resurrected by an old client.
10. A local save commits the entity revision and outbox intent atomically before the UI says saved.
11. Staged file bytes remain local until the server acknowledges verified completion.
12. Signed R2 URLs are never persisted as durable queue state.
13. Uploaded content remains quarantined until server-side checksum/content/scanner gates pass.
14. Service-worker caches never contain auth callbacks, signing pages, private APIs, PDFs, signed URLs, or R2 responses.
15. Background Sync is optional acceleration; foreground/manual sync is the correctness path.
16. Logs, telemetry, crash dumps, and support exports do not contain record bodies, signatures, tokens, signed URLs, credentials, or unrestricted filenames.
17. Offline signatures and privileged actions remain visibly provisional until accepted by the cloud.
18. A revoked user/device cannot push changes after reconnect.
19. Unacknowledged outbox work survives schema upgrade, full resnapshot, and recovery.
20. No completion claim is made without running the approved target-device test matrix.

## Architecture

### Logical flow

1. UI reads and writes through a local repository rather than directly treating cloud calls as the save boundary.
2. A short local transaction writes the entity, local revision metadata, and an outbox command.
3. The UI displays local-save state separately from cloud-sync state.
4. A foreground sync coordinator performs an authenticated handshake when connectivity is usable.
5. The server verifies session, device status, organization membership, protocol version, and cursor epoch.
6. The client pushes a bounded command batch.
7. The server validates the discriminated schema, ignores client authority fields, checks current resource state, and processes each command idempotently.
8. The server returns receipts, authoritative revisions/timestamps, conflicts, or safe rejection codes.
9. File commands receive fresh upload authorization only after metadata authorization. Bytes upload through a verified resumable path and remain local until server completion and scan acknowledgement.
10. The client pulls changes by monotonic server sequence. Expired cursors trigger a safe resnapshot that preserves unacknowledged local work.
11. A local transaction applies cloud changes, receipts, and conflict records.
12. Acknowledged outbox entries and file bytes are compacted under a documented retention policy.

### Trust model

The local client is a useful but hostile replica. It can propose:

- a command;
- a base revision;
- a client event time;
- file bytes and a claimed hash;
- a stable mutation identifier.

It cannot authoritatively assert:

- actor identity;
- organization membership;
- role or permission;
- current session or device status;
- server time;
- final workflow state;
- file safety;
- whether a signature is accepted;
- whether a deletion may be reversed.

### Foreground-first sync

Correctness must not depend on a service worker remaining alive.

Required triggers:

- application launch;
- unlock after authentication;
- verified transition from unusable to usable connectivity;
- explicit user retry;
- periodic foreground opportunity with bounded backoff.

Background Sync may process small, bounded work when supported, but the same durable queue and server idempotency rules apply.

## Data contracts

### Local records

Each locally stored entity must include only fields required by its workflow plus:

- local primary key;
- server ID when known;
- user scope;
- organization scope;
- entity type;
- local revision;
- last known server revision;
- local lifecycle status;
- authoritative server timestamp when known;
- untrusted client timestamp where useful;
- conflict and validation status;
- last mutation ID;
- schema version.

Never use the presence of an organization or role field locally as authorization.

### Outbox command

Minimum conceptual fields:

- mutation ID;
- device ID as a routing/audit identifier, not authentication;
- entity type and local/server ID;
- command type from a strict allowlist;
- base server revision;
- normalized payload;
- canonical payload hash;
- dependency mutation IDs where required;
- local creation time marked untrusted;
- retry count and safe last-error code;
- status: pending, blocked, sending, conflict, rejected, acknowledged.

Do not persist:

- bearer/refresh tokens;
- service credentials;
- signed upload or download URLs;
- raw invite or signing links;
- server-assigned roles;
- provider secrets.

### Server mutation receipt

Conceptual uniqueness:

- organization ID;
- actor user ID;
- device ID;
- mutation ID.

Receipt stores:

- canonical payload hash;
- command type;
- target ID;
- authoritative result or result reference;
- server revision;
- server receipt time;
- safe status.

Receipt creation and business mutation must share the same transaction for high-integrity commands.

### Revision and conflict model

- Use entity-level revisions as the baseline.
- Allow field-level merge only for fields whose independence is explicitly proven.
- Never merge signature, workflow state, role, archive/delete, or same-field answer changes silently.
- Return both local intent and current server value for user resolution.
- Keep conflict resolution as a new idempotent command rather than mutating queue history.

### Change feed, tombstones, and snapshots

- Use a monotonic server change sequence, not timestamp alone.
- Return tombstones for deletions and durable archive transitions.
- Define cursor retention.
- Include a sync epoch so the server can invalidate incompatible history.
- If a cursor is too old, preserve the outbox, obtain an authorized snapshot, rebase safe local intents, and surface conflicts.
- Indefinite offline support does not require infinite incremental history if safe resnapshot is proven.

### File staging

Local file metadata includes:

- immutable local file ID;
- user and organization scope;
- intended entity/field;
- original display name stored with privacy controls;
- byte size;
- detected/declared media type;
- locally calculated checksum;
- staging completeness;
- upload session state without durable signed URL;
- acknowledged cloud object/version ID;
- quarantine/scan result from server.

The application must reconcile:

- complete file with missing queue row;
- queue row with missing or partial file;
- acknowledged server object with retained local bytes;
- abandoned multipart upload;
- checksum or metadata mismatch;
- rejected/quarantined content.

## Offline and online action classification

| Workflow | Offline behavior | Authoritative completion |
| --- | --- | --- |
| Create/edit draft fields | Save locally and queue with base revision | Server accepts after live authz and conflict check |
| Attach file | Stage immutable bytes and queue intent | Fresh online authorization, verified upload, quarantine/scan, server receipt |
| View cached document/PDF | Allowed while local vault is unlocked | Cloud remains source for newer/revoked state |
| Generate PDF | Candidate for deterministic local generation after parity testing | Server may regenerate/verify final artifact when workflow requires |
| Add/edit recipient information | Save provisional local state | Server validates permissions, normalization, duplicates, and workflow state |
| Draw signature/initials | Capture provisionally with explicit pending label | Server validates token/user, current document state, answers, drawing, and receipt time |
| Comments | Candidate for append-only offline command with stable ID | Server permission and document-state validation |
| Create folder/document draft | Queue idempotent creation with client-generated UUID | Server assigns authoritative revision and enforces tenant constraints |
| Publish template | Queueing an intent may be allowed, but do not display published | Fresh online permission and revision check |
| Archive/delete/finalize | Capture a request only if product needs it; do not apply as final | Fresh online permission, current-state lock, audit, receipt |
| Invite/change role/create organization | Online-only | Server-only privileged workflow |
| Send/resend email or SMS | Online-only | Server provider outbox and rate/budget controls |
| AI suggestion | Online-only | Server authorization, privacy, budget, provider call |
| Obtain signed URL | Online-only and ephemeral | Server authorizes and signs current resource |

## Module layout

Keep modules small and responsibility-based. Do not introduce a generic repository or workflow framework before two real implementations prove the abstraction.

If PWA is selected:

~~~text
src/
  offline/
    db/
      client.ts
      schema.ts
      migrations.ts
    records/
      document-repository.ts
      template-repository.ts
    outbox/
      contracts.ts
      repository.ts
      scheduler.ts
    sync/
      contracts.ts
      coordinator.ts
      push.ts
      pull.ts
      conflicts.ts
    files/
      staging-repository.ts
      hashing.ts
      reconciliation.ts
    security/
      vault.ts
      identity-scope.ts
    recovery/
      startup-checks.ts
      export.ts
      restore.ts
  components/
    offline/
      sync-status.tsx
      storage-health.tsx
      conflict-dialog.tsx
      recovery-panel.tsx
  app/
    api/
      sync/
        handshake/route.ts
        push/route.ts
        pull/route.ts
  services/
    sync/
      dispatcher.ts
      command-handlers/
      authorization.ts
      receipts.ts
      changes.ts
~~~

If Tauri is selected, first define a minimal workspace split:

~~~text
apps/
  web/
  desktop/
packages/
  domain/
  sync-contracts/
  ui/
~~~

The desktop renderer never accesses SQLite, arbitrary files, credentials, or the updater directly. Narrow native commands own those privileges. Do not move cloud secrets into the binary.

## Implementation phases

### Phase 0 — Security and durability spike

Objective:

- Produce the evidence required to select PWA/IndexedDB or Tauri/SQLite and approve candidate controls.

Tasks:

- Run every mandatory scenario in offline-foundation-security-spike.md.
- Use synthetic, non-production fixtures.
- Record device/browser/runtime versions and raw observations.
- Decide local vault approach and document its limits.
- Decide file capacity/staging/resume strategy.
- Decide PWA versus Tauri using the non-negotiable gates.
- Review the threat model and classify every High item as mitigated-by-plan, accepted residual risk, or blocker.

Acceptance:

- Exit criteria in the spike are satisfied.
- No unresolved blocker is hidden by a generic TODO.
- Architecture decision and evidence are recorded.

### Phase 1 — Protocol and persistence contracts

Objective:

- Freeze the smallest versioned contracts needed for one vertical document workflow.

Tasks:

- Define Zod schemas for local records, outbox commands, receipts, conflicts, handshake, push, pull, and safe errors.
- Define version compatibility and sync epoch behavior.
- Define mutation identity/payload hash canonicalization.
- Define server revisions, monotonic change sequence, tombstones, and cursor expiry.
- Define offline/online command allowlist.
- Threat-review the contracts before database or endpoint implementation.

Acceptance:

- Unknown fields and unsupported command versions reject.
- Client authority fields do not exist in accepted payloads.
- Fixtures cover exact replay, changed-payload replay, stale revision, deleted entity, revoked membership, and cursor expiry.

### Phase 2 — Local vault, database, and crash-safe autosave

Objective:

- Save one document/answer/file intent locally with clear local versus cloud status.

Tasks:

- Implement scoped local database and versioned migrations.
- Implement the verified vault/automatic-lock design.
- Implement atomic entity plus outbox transaction.
- Implement immutable file staging and checksum.
- Implement startup reconciliation and quarantine.
- Implement storage-health/admission checks.
- Implement encrypted export/restore only after the spike proves the approach.

Acceptance:

- Forced termination at every save boundary never yields a falsely acknowledged save.
- Account/org switching cannot expose another scope.
- Missing/corrupt files and rows enter recoverable states.
- No secret, bearer URL, or raw signing/invite link appears in storage.

### Phase 3 — Server-authoritative sync core

Objective:

- Safely accept hostile local commands without weakening existing tenant security.

Tasks:

- Add explicit server-only fence to privileged modules.
- Create narrowly granted database structures/RPCs for mutation receipts, revisions, changes/tombstones, and device status.
- Add handshake, bounded push, and pull paths.
- Centralize command dispatch and live authorization.
- Atomically authorize/mutate/audit/receipt high-integrity commands.
- Add explicit conflicts and resnapshot flow.
- Add rate, batch, size, timeout, and backpressure controls after measured tests.

Acceptance:

- Tampered actor/org/role/device payloads cannot change authority.
- Revoked users/devices cannot push.
- Exact replay is harmless and returns the prior result.
- Same ID/different payload fails.
- Cross-tenant negative tests pass at service, RPC, RLS, and HTTP boundaries.
- Cursor expiry preserves unsynchronized local intent.

### Phase 4 — Secure offline file pipeline

Objective:

- Reliably transfer staged files over slow and interrupted networks.

Tasks:

- Authorize file intent before issuing upload capability.
- Obtain fresh scoped upload authorization after reconnect.
- Implement the provider-verified resumable protocol.
- Verify checksum and object metadata.
- Add quarantine, content signature/structure validation, isolated malware scan, and safe release state.
- Add stale allocation/multipart/orphan cleanup and tenant quotas.
- Retain local bytes until authoritative completion receipt.

Acceptance:

- Power/network loss at every chunk boundary resumes without corruption or duplication.
- Expired URLs are not persisted or reused.
- Tampered/mislabeled/malicious fixtures never become available.
- Scanner failure fails closed without deleting the user's only local copy.
- Cleanup does not delete legitimate work after long outages.

### Phase 5 — Offline shell and safe update behavior

Objective:

- Launch the application and access the local vault without connectivity while preventing cache leakage.

Tasks:

- Add manifest/install experience if PWA is selected.
- Implement allowlisted, versioned app-shell caching.
- Network-only exclude auth, sign, API, PDF, signed URLs, and R2.
- Implement atomic service-worker/client update and old-cache cleanup.
- Implement minimum supported client/protocol behavior.
- Add an offline capability and storage-health screen.

Acceptance:

- Cache inventory contains no tenant data, bearer token, private response, or signed URL.
- Interrupted/long-delayed update recovers or rolls back safely.
- Unsupported versions cannot send unsafe commands.
- App launches offline with the last verified local data state.

### Phase 6 — Complete vertical document workflow

Objective:

- Apply the foundation to a real end-to-end slice before generalizing.

Initial slice:

- open cached document;
- edit answers;
- stage attachments;
- maintain recipient data;
- render or access cached/generated PDF;
- capture provisional drawing;
- recover after termination;
- reconnect;
- authenticate and reauthorize;
- resolve conflicts;
- upload files;
- accept server receipt;
- present authoritative final status.

Acceptance:

- The full scenario passes target-device, long-offline, power-loss, tamper, conflict, and low-bandwidth tests.
- Provisional and authoritative states are never visually confused.
- Existing online workflow and security regression suite continues to pass.

### Phase 7 — Recovery, observability, and operational controls

Objective:

- Make failures diagnosable without exposing customer data.

Tasks:

- Add metadata-only sync health, queue age, conflict, storage, and migration metrics.
- Add centralized log redaction and canary-secret tests.
- Add user-controlled recovery, export, restore, and support workflow.
- Add device last-seen/revocation status and reconnect behavior.
- Add provider cost/storage quotas and alerts.
- Create incident procedures for compromised device, local corruption, build/service-worker compromise, and stolen release keys.

Acceptance:

- Support bundle contains no seeded PII/token/signature/file content.
- Recovery drill restores acknowledged and unacknowledged synthetic work.
- Operators can distinguish offline backlog, authorization rejection, conflict, scanner delay, quota, and provider failure.

### Phase 8 — Security verification and controlled pilot

Objective:

- Prove the foundation under realistic field conditions before resuming feature sprints.

Tasks:

- Run full threat-model negative tests.
- Run two-tenant authenticated integration tests against the deployed environment.
- Run real R2 interruption/resume/scanner tests.
- Inspect deployed headers and caches.
- Pilot behind a feature flag with synthetic or approved low-risk data first.
- Review privacy/provider/legal implications.
- Record accepted residual risks and owner.

Acceptance:

- No Critical or unaccepted High finding remains.
- All non-negotiable durability/security gates have fresh evidence.
- Pilot rollback does not destroy unsynchronized local work.
- User explicitly accepts the residual inability to revoke/wipe a fully offline device.
- Offline Foundation is marked complete only after review.

## Process and test requirements

Every implementation task must:

1. State the threat/failure it addresses.
2. Link the relevant TM identifier from BizzFlow-threat-model.md.
3. State the candidate control and verification hypothesis.
4. Add tests before or with the implementation.
5. Run lint, typecheck, focused tests, full tests, build, dependency audit, and migration/RLS checks as applicable.
6. Record target-device evidence for browser/native behavior.
7. Avoid mixing unrelated refactors or later-sprint features.
8. Keep public routes thin, domain logic in services, runtime schemas explicit, and modules single-purpose.

## Rollout and telemetry

Rollout sequence:

- developer synthetic data;
- automated hostile-state fixtures;
- controlled target-device lab;
- one internal/pilot organization behind a server-controlled flag;
- small dedicated-device cohort;
- broader pilot only after review.

Telemetry must be metadata-only:

- local database/schema version;
- service worker/app version;
- last successful sync time;
- counts and age of pending/blocked/conflict/rejected commands;
- pending bytes and storage pressure state;
- receipt/replay/hash mismatch counts;
- migration/recovery outcomes;
- rate-limit and scanner status categories.

Do not collect:

- document/answer bodies;
- signatures/initials;
- tokens, cookies, or signed URLs;
- raw filenames unless explicitly approved and redacted;
- full provider errors;
- local encryption keys or passphrases.

## Decision register

| Decision | Status | Rationale | Verification required |
| --- | --- | --- | --- |
| Offline Foundation precedes Sprint 6 | Locked | Later workflows otherwise deepen cloud-first coupling | Confirm all planning/context files route next work here |
| Dedicated devices | Confirmed assumption | Reduces intentional cross-user sharing but not theft/malware | Pilot device-management survey |
| All listed data available offline | Confirmed requirement | Core value during outages | Capacity, privacy, and recovery spike |
| Indefinite offline local access | Confirmed requirement with residual risk | Supports long outages | Explicit acceptance of no remote revocation/wipe |
| Cloud is final authority | Locked invariant | Protects tenant isolation from stale/tampered clients | Negative authz/replay tests |
| PWA first only if gates pass | Conditional | Lowest distribution friction but browser guarantees may be insufficient | Phase 0 device evidence |
| Tauri fallback | Conditional | Stronger file/SQLite/OS integration at higher operational cost | Separate security/release gate |
| No custom VPN | Locked for this phase | Does not solve no-network operation and adds unrelated risk | Revisit only for a concrete private-network customer need |
| Background Sync is optional | Locked invariant | Browser lifecycle is not a correctness boundary | Termination and unsupported-browser tests |
| Offline signature is provisional | Locked invariant | Live authority and server time are required | Product/legal/security review |

## Completion definition

The Offline Foundation is complete only when:

- the architecture decision is backed by target-device evidence;
- all required offline data survives the tested interruption envelope;
- a malicious or stale client cannot bypass live cloud authorization;
- queue replay, reordering, conflicts, deletion, and cursor expiry are safe;
- files resume, verify, scan, and reconcile safely;
- cache/update behavior exposes no private data;
- recovery and support artifacts are usable and redacted;
- no Critical or unaccepted High threat remains;
- the user reviews the residual risk of indefinite disconnected access;
- the canonical plan explicitly releases the Sprint 6 execution lock.
