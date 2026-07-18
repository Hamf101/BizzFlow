# BizFlow Offline Foundation Security and Durability Spike

Date: 2026-07-18
Status: deferred; Spike 001 development evidence is preserved
Production data: prohibited
Purpose: replace assumptions with reproducible evidence before the Offline Foundation architecture is implemented

## Supersession Note

The user's later 2026-07-18 direction makes BizFlow cloud-first and explicitly defers PWA packages. This spike is no longer the next project phase and does not block cloud feature work.

If offline support is explicitly reactivated:

1. Review all evidence and failed gates.
2. Select PWA/IndexedDB or Tauri/SQLite.
3. Update the Offline Foundation plan only where the evidence requires it.
4. Implement the Offline Foundation.
5. Release the later-sprint lock only after implementation and verification.

## Governing rule

No issue or proposed solution is considered verified merely because it is plausible, documented by a vendor, or recommended in a threat model.

A control is approved only after:

- the threat is reproduced or its applicability is demonstrated;
- the control is implemented in a minimal isolated prototype;
- positive, negative, failure, and recovery behavior is observed;
- current official platform/provider documentation is checked;
- target-device behavior is recorded;
- residual risk and operational cost are documented;
- a regression test or repeatable manual procedure exists.

If the issue cannot be reproduced or the control cannot be proven, record the uncertainty and do not present the control as protection.

## Questions this spike must answer

1. Can an installed PWA safely retain the complete required corpus—documents, attachments, recipient data, PDFs, and drawings—through the expected device lifecycle?
2. Can locally acknowledged work survive abrupt browser/application termination and the practical power-loss test envelope?
3. Can local data be protected acceptably on dedicated devices without making recovery impossible?
4. Can a hostile or stale local database ever cause unauthorized cloud effects?
5. Can files resume over slow/flapping links without corruption, duplicate versions, or reliance on expired signed URLs?
6. Can old clients reconnect after very long outages without silent conflicts, deletion resurrection, or destructive migration?
7. Does the PWA pass every non-negotiable gate, or must the implementation use Tauri plus SQLite?

## Safety and test-data rules

- Use synthetic organizations, users, recipients, documents, signatures, keys, and files.
- Never copy production documents, emails, tokens, credentials, database dumps, or signing links into fixtures.
- Use isolated Supabase/R2 test resources or local fakes where possible.
- Use harmless industry-standard malware test fixtures only in a scanner-isolated environment; never email or expose them publicly.
- Keep a manifest of every generated file, account, object, and database row for cleanup.
- Do not simulate power loss by damaging a user's primary workstation or filesystem.
- Prefer disposable virtual machines and dedicated test devices.
- Record commands and results, but redact secrets and token-bearing URLs.
- Store evidence under a future artifacts/verification/offline-foundation/ directory, not in logs containing customer content.

## Initial support assumption

Test the actual pilot fleet before finalizing support. Until that inventory exists, begin with:

- Windows 10/11 pilot hardware;
- current stable Microsoft Edge and Google Chrome installed-PWA modes;
- normal browser mode as a recovery fallback;
- throttled and interrupted network profiles representative of pilot sites.

Add any macOS, Linux, Android, or other browser target before claiming it is supported.

## Evidence package

Each scenario must produce:

- scenario ID and related threat-model IDs;
- date, tester, commit, build, schema, protocol, browser/runtime, OS, and device;
- exact setup and synthetic fixture;
- expected behavior;
- observed behavior and timing;
- screenshots or machine-readable logs where safe;
- pass, fail, blocked, or conditional result;
- residual risk;
- recommended decision;
- cleanup confirmation.

Create a final decision summary containing:

- non-negotiable gate results;
- PWA-versus-Tauri decision;
- approved candidate controls;
- rejected controls and reasons;
- unresolved blockers;
- accepted residual risks and owner.

## Test matrix

### A. Capability, persistence, quota, and eviction

| ID | Scenario | Procedure | Pass condition | Related threats |
| --- | --- | --- | --- | --- |
| CAP-01 | Install and offline launch | Install candidate PWA, fully close it, remove all network paths, relaunch | App shell and last authorized local vault open without a network request being required | TM-016, TM-018, TM-028 |
| CAP-02 | Persistence request granted | Request persistent storage after an appropriate user action and inspect result | Product records the actual grant and explains its meaning without claiming absolute durability | TM-015, TM-028 |
| CAP-03 | Persistence denied | Force/choose denial | App remains usable with a visible risk state, conservative admission limits, and export/recovery guidance | TM-015 |
| CAP-04 | Quota growth | Add synthetic documents/files in measured increments to expected and stress volumes | Writes are admitted only when safety margin remains; no falsely saved work | TM-015 |
| CAP-05 | Quota exceeded | Fill storage until the next transaction fails | Failure is atomic, understandable, recoverable, and does not corrupt prior data or queue | TM-013, TM-015 |
| CAP-06 | Browser data cleared | Clear site data using normal browser/OS controls | Product detects missing vault, does not invent recovery, and restores only from a verified export/cloud source | TM-015, TM-029 |
| CAP-07 | Storage pressure/eviction | Use disposable environment to create storage pressure | Observed browser behavior is documented; PWA fails the architecture gate if required data can disappear without an acceptable recovery | TM-015 |
| CAP-08 | Large corpus performance | Load projected per-user documents/files and index/query it | Open/save/startup remain within agreed thresholds and do not block autosave | TM-015, TM-018 |

### B. Atomic save, abrupt termination, and recovery

Inject termination at every numbered boundary:

1. before local transaction;
2. after entity write but before outbox write;
3. before transaction commit;
4. immediately after commit;
5. after UI receives completion;
6. while staging file bytes;
7. after file completion but before queue row;
8. during startup reconciliation;
9. during local schema migration;
10. during export/restore.

| ID | Scenario | Pass condition | Related threats |
| --- | --- | --- | --- |
| DUR-01 | Kill browser/app during every save boundary | Entity and outbox are both committed or neither is; UI never claimed an uncommitted save | TM-013 |
| DUR-02 | Terminate immediately after saved indicator | Relaunch restores the exact acknowledged state | TM-013 |
| DUR-03 | Terminate during file staging | Partial file is quarantined or safely resumed; it is never uploaded as complete | TM-013, TM-020 |
| DUR-04 | Repeated rapid autosave then kill | Latest acknowledged revision recovers; queue contains a valid, compact sequence | TM-008, TM-013 |
| DUR-05 | Corrupt one record/blob/index in disposable copy | Startup isolates damage, preserves unaffected work, and offers verified recovery | TM-013, TM-029 |
| DUR-06 | Kill during migration | Relaunch completes, rolls back, or enters recovery without deleting unacknowledged work | TM-014 |
| DUR-07 | Hard power interruption on test device/VM | Behavior matches the selected durability claim; any loss window is documented and accepted | TM-013 |
| DUR-08 | OS clock jumps years forward/backward | Saved state remains valid; authority/order uses server values after reconnect | TM-011 |

### C. Local vault and device security

Test candidate designs separately; do not combine mechanisms until each property is understood.

Candidates may include:

- reliance on managed OS account plus full-disk encryption;
- user-entered local vault passphrase with a memory-hard or platform-approved derivation selected after compatibility review;
- OS credential storage where a native runtime is selected;
- automatic lock after inactivity/restart;
- per-user/per-organization key separation;
- encrypted export with independent recovery secret.

Required tests:

| ID | Scenario | Pass condition | Related threats |
| --- | --- | --- | --- |
| VAULT-01 | Inspect storage while app is closed/locked | Sensitive fixture content and keys are not available in the claimed attacker model | TM-001 |
| VAULT-02 | Restart after abrupt loss | Vault remains recoverable without storing an equivalent plaintext key beside ciphertext | TM-001, TM-013 |
| VAULT-03 | Wrong unlock and brute-force pressure | Bounded, measured behavior; no destructive lockout without recovery; no sensitive logs | TM-001, TM-025 |
| VAULT-04 | Automatic lock | App locks after configured inactivity/restart and stops displaying cached PII | TM-001 |
| VAULT-05 | Account/org switch | Previous vault cannot be queried/rendered/synced by new identity | TM-004 |
| VAULT-06 | Logout, purge, and reassignment | Defined lock/purge behavior occurs; residual media risk is documented honestly | TM-004, TM-029 |
| VAULT-07 | Lost passphrase/device credential | Recovery behavior matches policy; no insecure universal recovery secret exists | TM-001, TM-029 |
| VAULT-08 | Same-origin XSS prototype in isolated build | Demonstrate that unlocked data is exposed; ensure documentation never claims encryption stops XSS | TM-002 |
| VAULT-09 | Browser extension/local malware model | Record what the selected platform can and cannot contain | TM-001, TM-002 |

Stop condition:

- If required at-rest protection and recovery cannot both be demonstrated in the PWA threat model, PWA fails the non-negotiable gate for the complete offline corpus.

### D. Service worker, cache, and update security

| ID | Scenario | Pass condition | Related threats |
| --- | --- | --- | --- |
| SW-01 | Cache inventory after all workflows | Only allowlisted versioned static assets exist; no auth/sign/API/PDF/R2/signed URL response | TM-016, TM-017 |
| SW-02 | Poison one cached asset in isolated environment | Integrity/version/update behavior detects or replaces it; failure is visible and recoverable | TM-016 |
| SW-03 | Update while online | New app activates atomically and old caches are removed after safe handoff | TM-016 |
| SW-04 | Update interrupted then offline | App runs a known compatible version or a recovery shell; local data remains intact | TM-014, TM-016 |
| SW-05 | Reconnect after very old app version | Server rejects unsafe protocol cleanly and guides upgrade without erasing outbox | TM-014, TM-016 |
| SW-06 | Broad-fetch regression | Automated test fails if a developer adds runtime caching outside allowlist | TM-017 |
| SW-07 | CSP report/enforce trial | Required app behavior works without weakening policy; XSS sink tests remain blocked | TM-002 |

### E. Identity, revocation, and indefinite offline access

Simulate long disconnection using controlled server state and protocol versions rather than relying only on device-clock changes.

| ID | Scenario | Pass condition | Related threats |
| --- | --- | --- | --- |
| AUTH-01 | Valid user offline indefinitely | Local vault remains usable under the accepted local policy; no cloud authority is implied | TM-003 |
| AUTH-02 | Membership removed while device offline | Cached data remains an accepted residual risk, but every push rejects after reconnect and device locks/wipes per policy | TM-003 |
| AUTH-03 | Session revoked/logged out elsewhere | High-risk push checks live session/device state and rejects as designed | TM-003 |
| AUTH-04 | Role downgraded offline | Commands requiring the former role reject; safe draft changes may be preserved for export/conflict policy | TM-003, TM-005 |
| AUTH-05 | Organization disabled/deleted | No command resurrects organization state; local UX enters blocked/recovery mode | TM-003, TM-010 |
| AUTH-06 | Forge local actor/role/org/device | Server derives authority independently and returns a safe denial | TM-004, TM-005 |
| AUTH-07 | Use old but unexpired JWT after logout | Result matches documented Supabase/session policy for sensitive sync | TM-003 |
| AUTH-08 | No Origin/native request | Sync uses its explicit authentication contract; CSRF/origin logic is not misrepresented as native-client auth | TM-005, TM-022 |

Required decision:

- Record explicit acceptance that no remote wipe or revocation is possible before connectivity returns.

### F. Outbox tampering, replay, ordering, and concurrency

Use property-based/randomized sequences in addition to examples.

| ID | Scenario | Pass condition | Related threats |
| --- | --- | --- | --- |
| QUEUE-01 | Exact mutation replay once and many times | One business effect; same authoritative receipt/result each time | TM-007 |
| QUEUE-02 | Same mutation ID, changed payload | Server rejects and records security-relevant metadata | TM-007 |
| QUEUE-03 | Lost response after commit | Retry obtains prior receipt with no duplicate email/file/comment/document | TM-007 |
| QUEUE-04 | Reorder dependent commands | Dependencies block or server state machine rejects; no partial invalid state | TM-008 |
| QUEUE-05 | Duplicate/copy queue to another device | Device identifier does not grant authority; receipt semantics remain safe | TM-005, TM-007 |
| QUEUE-06 | Two tabs/processes sync simultaneously | One local leader or transactional claims; server idempotency remains final defense | TM-030 |
| QUEUE-07 | Kill active sync leader | Another process safely takes over after lease expiry | TM-030 |
| QUEUE-08 | Oversized/unknown command/batch | Strict rejection before expensive work; no unknown fields or command types pass | TM-005, TM-021 |
| QUEUE-09 | Compressed body expansion | Both compressed and expanded limits hold | TM-021 |
| QUEUE-10 | Client supplies server timestamp/final status | Values are ignored/rejected and cannot change authority | TM-005, TM-011 |

### G. Conflicts, deletions, cursors, and very old clients

| ID | Scenario | Pass condition | Related threats |
| --- | --- | --- | --- |
| CON-01 | Two devices edit different safe fields | Approved deterministic merge or explicit conflict; no lost field | TM-009 |
| CON-02 | Two devices edit same answer | Explicit conflict; no arrival-order silent overwrite | TM-009 |
| CON-03 | Signature versus completed workflow | Server rejects incompatible stale command; accepted signature evidence is not overwritten | TM-009, TM-023 |
| CON-04 | Delete/archive versus offline edit | Tombstone/current state wins; user can recover intent without resurrection | TM-010 |
| CON-05 | Cursor timestamp tie | Monotonic sequence returns every change exactly as specified | TM-010 |
| CON-06 | Cursor older than retention | Safe resnapshot preserves outbox and surfaces conflicts | TM-010, TM-014 |
| CON-07 | Sync epoch changes | Old client receives deterministic incompatible-version handling | TM-014 |
| CON-08 | Upgrade from every supported schema | Data and unacknowledged queue survive; result matches current schema | TM-014 |
| CON-09 | Deliberate client downgrade | Server prevents unsafe protocol; local recovery remains possible | TM-014, TM-016 |

### H. Files, R2, scanner, and slow-network recovery

Fixtures:

- empty, minimum, normal, near-limit, and over-limit files;
- PDF, PNG, JPEG, DOCX, XLSX, and CSV fixtures;
- mismatched extension/MIME/magic bytes;
- corrupt and truncated structures;
- decompression/resource-bomb fixture handled only in isolated scanner limits;
- harmless malware-test fixture;
- duplicate content and duplicate filenames;
- checksum mismatch after one-byte modification.

| ID | Scenario | Pass condition | Related threats |
| --- | --- | --- | --- |
| FILE-01 | Signed URL expires before upload | Client obtains a new URL after live authorization; old URL is absent from durable state | TM-020, TM-024 |
| FILE-02 | Disconnect every chunk/step | Upload resumes or safely restarts without corrupt/duplicate available version | TM-020 |
| FILE-03 | Commit response lost | Idempotent completion returns same version/receipt | TM-007, TM-020 |
| FILE-04 | Byte/checksum mismatch | Server refuses availability; local original remains recoverable | TM-019, TM-020 |
| FILE-05 | MIME/magic mismatch | Quarantine/reject before coworker access | TM-019 |
| FILE-06 | Malware fixture | Isolated scanner rejects; no public/email exposure; cleanup confirmed | TM-019 |
| FILE-07 | Scanner unavailable/timeout | Fail closed in quarantine with bounded retry and visible state | TM-019 |
| FILE-08 | Resource-bomb fixture | Parser/scanner resource caps prevent service exhaustion | TM-019, TM-021 |
| FILE-09 | Abandoned allocation/multipart | Reconciliation cleans it after verified safe window without deleting legitimate long-offline work | TM-020 |
| FILE-10 | Local bytes deleted before receipt attempt | Test must fail; implementation retains bytes until authoritative acknowledgment | TM-020 |
| FILE-11 | R2 CORS/header behavior | Real target browser/provider path supports required checksum/resume/create-only headers | TM-020 |
| FILE-12 | Organization/user quota reached | Admission/backpressure is atomic, fair, and communicates recovery | TM-015, TM-021 |

### I. Network behavior

Test profiles:

- complete offline;
- DNS failure;
- TLS handshake failure;
- captive portal;
- intermittent 2G-like latency/loss;
- frequent online/offline flapping;
- low throughput with large upload;
- response dropped after server commit;
- connection change during upload;
- provider-specific partial outage.

| ID | Scenario | Pass condition | Related threats |
| --- | --- | --- | --- |
| NET-01 | Captive portal | Client does not treat portal HTML/redirect as BizFlow sync success | TM-022 |
| NET-02 | TLS/hostname failure | Fail closed; never disable certificate validation | TM-022 |
| NET-03 | Flapping connectivity | Bounded jittered retry; no queue duplication or battery/data storm | TM-007, TM-018, TM-022 |
| NET-04 | Slow successful upload | Progress persists; UI distinguishes local save from cloud completion | TM-018, TM-020 |
| NET-05 | Server/provider partial outage | Independent queue items remain durable; dependencies and backpressure hold | TM-008, TM-018 |
| NET-06 | No physical network | App continues locally; VPN/tunnel is correctly treated as unavailable | TM-022 |

### J. Rate limits, audit, logs, support, and recovery

| ID | Scenario | Pass condition | Related threats |
| --- | --- | --- | --- |
| OPS-01 | Burst sync by IP/user/device/org | Measured limits protect service without corrupting queue; safe retry metadata returned | TM-021, TM-031 |
| OPS-02 | Concurrent expensive actions | Atomic budget/concurrency cap prevents cost amplification | TM-031 |
| OPS-03 | Audit write failure | Defined high-integrity mutation rolls back; best-effort class is documented | TM-012 |
| OPS-04 | Client event-time forgery | Audit records server receipt/order time and marks client time untrusted | TM-011, TM-012 |
| OPS-05 | Seed canary PII/secrets/tokens | Logs, telemetry, crash dumps, and support exports contain none | TM-025 |
| OPS-06 | Encrypted export/restore | Restore reproduces data and queue; wrong key fails safely; artifact reveals no plaintext | TM-001, TM-029 |
| OPS-07 | Interrupted export/restore | Existing vault remains intact; partial artifact is not mistaken as valid | TM-013, TM-029 |
| OPS-08 | Revoked-device reconnect | Cloud rejects, alert/lock policy activates, and diagnostic logs remain content-free | TM-003, TM-025 |

### K. Supply chain and release

| ID | Scenario | Pass condition | Related threats |
| --- | --- | --- | --- |
| SUP-01 | CI action/dependency review | Actions/dependencies are pinned and updateable through reviewed automation | TM-026 |
| SUP-02 | Secret scan | Seeded secrets fail CI; no production secret enters artifacts/client bundle | TM-006, TM-026 |
| SUP-03 | SBOM/provenance prototype | Build produces verifiable artifact metadata without exposing secrets | TM-026 |
| SUP-04 | Service-worker build tamper | Integrity/version controls and deployment process detect unauthorized artifact | TM-016, TM-026 |
| SUP-05 | Rollback drill | Known-bad release can be stopped without destroying local outbox/data | TM-014, TM-026 |

### L. Conditional Tauri comparison

Run this section when any PWA non-negotiable fails or evidence remains insufficient.

| ID | Scenario | Pass condition | Related threats |
| --- | --- | --- | --- |
| TAU-01 | SQLite forced-kill/power-loss matrix | Committed work survives configured durability claim; recovery behavior documented | TM-013, TM-032 |
| TAU-02 | Native file staging | App-data confinement, checksum, reconciliation, and permissions hold | TM-019, TM-020, TM-032 |
| TAU-03 | Credential storage | Secrets/keys are not in renderer, SQLite, logs, or plaintext config | TM-001, TM-032 |
| TAU-04 | IPC command fuzz/authorization | Only narrow typed commands/capabilities work; untrusted WebView cannot access arbitrary filesystem/process/network | TM-002, TM-032 |
| TAU-05 | Path/deep-link validation | Traversal, unexpected schemes, and hostile parameters reject | TM-032 |
| TAU-06 | Signed installer/update | Signature required; tamper, rollback, interrupted update, and lost-key recovery are documented | TM-026, TM-032 |
| TAU-07 | Crash dump/support bundle | No local content, credentials, or tokens leak | TM-025, TM-032 |
| TAU-08 | Distribution on target bandwidth | Installer/update size, delta behavior, and recovery meet pilot constraints | TM-032 |

## Non-negotiable PWA gates

PWA is rejected as the complete offline runtime if any remains true after remediation:

- acknowledged work cannot reliably survive the tested termination/power envelope;
- persistent capacity cannot support the required corpus with a safe margin;
- denied/cleared/evicted storage has no acceptable recovery story;
- local protection and automatic locking are inadequate for the accepted device threat model;
- schema upgrades or old-client reconnection can lose unacknowledged work;
- private responses or bearer capabilities enter service-worker/cache storage;
- same-account/org partitioning cannot be proven;
- file staging/resume cannot preserve and verify bytes safely;
- target pilot browser behavior is too inconsistent to support;
- the user would have to accept a durability or confidentiality risk they have rejected.

If rejected, proceed to the Tauri comparison before implementing the production vertical slice.

## Performance and acceptance thresholds

Set numeric thresholds only after measuring representative pilot hardware and data. At minimum, define and record:

- autosave debounce and maximum time from edit to durable local acknowledgment;
- application cold-start and vault-unlock target at projected corpus size;
- maximum local transaction duration;
- storage safety margin;
- maximum command batch count and encoded/decoded bytes;
- maximum retries/backoff and per-tenant pending bytes;
- conflict and cursor-resnapshot time;
- upload chunk/resume behavior;
- scanner size/time/resource limits;
- supported client/protocol lifetime;
- log/export retention.

Do not copy arbitrary industry numbers into production. The values must follow measured constraints and product decisions.

## Exit criteria

The spike passes only when:

- every non-negotiable scenario has evidence;
- PWA or Tauri is selected through the documented decision rule;
- the selected runtime passes its storage, crash, vault, update, and file gates;
- hostile/stale client tests prove cloud authorization remains current;
- replay, reordering, conflict, deletion, cursor, and migration behavior is specified and demonstrated;
- R2 resume/checksum/scanner behavior is verified with the real provider path;
- cache inventory is free of protected data and bearer capabilities;
- logging/export fixtures prove redaction;
- no Critical or unaccepted High threat remains unexplained;
- all residual risks have an owner and explicit acceptance;
- the user reviews the inability to remotely revoke/wipe a fully offline device.

## Stop conditions

Stop implementation and request a decision if:

- target device/browser information invalidates the test assumption;
- the selected runtime cannot meet a non-negotiable requirement;
- a proposed vault requires unrecoverable keys or creates a hidden master secret;
- a sync design requires trusting client identity/role/time;
- a control needs a provider feature that cannot be verified;
- legal review is required for signature, residency, or provider processing;
- a migration/recovery test risks real user data;
- a custom VPN/local-network product is proposed without an underlying connectivity use case;
- unresolved Critical or High behavior would be hidden behind a feature flag or documentation claim.

## Completion record template

~~~text
Spike commit/build:
Test devices and runtimes:
Synthetic fixture manifest:
PWA result:
Tauri result if run:
Selected runtime:
Approved candidate controls:
Rejected controls:
Failed or conditional scenarios:
Open blockers:
Accepted residual risks and owner:
Threat-model updates:
Offline Foundation plan updates:
Evidence directory:
Reviewer:
Date:
Decision to begin implementation:
~~~
