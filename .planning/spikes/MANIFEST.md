# Offline Foundation Spike Manifest

## Idea

Preserve the Offline Foundation's reproducible research for a possible future offline phase. The user selected a cloud-first product direction on 2026-07-18 and explicitly deferred PWA packages, so these spikes no longer gate current cloud implementation.

## Requirements

- Cloud implementation and Sprint 7 may proceed without completing this manifest.
- Do not install PWA, service-worker, IndexedDB/Dexie, Tauri, or other offline-runtime packages while this phase is deferred.
- Spike 001's dependency-free native IndexedDB harness and evidence remain available for future research; they are not production PWA code.
- If offline support is reactivated, revalidate the product requirements before selecting an installed Next.js PWA or Tauri/SQLite candidate.
- A locally acknowledged save must commit the document revision and its outbox intent atomically. The UI cannot report saved before the transaction completes.
- The PWA must request strict IndexedDB durability where supported, record the durability value the runtime reports, and treat it as a browser hint rather than a guarantee against power-loss data loss.
- Every local record, index, and query must be scoped by immutable user and organization identifiers. Local scope fields are partitioning data, never cloud authorization.
- Storage admission must use a measured, bounded synthetic corpus, a conservative safety margin, and the result of the actual write. `StorageManager.estimate()` is an estimate, not a reservation.
- The application must record `StorageManager.persist()` and `persisted()` outcomes without claiming that installation implies persistence or that persistence prevents explicit user deletion.
- A quota failure must abort the complete document-plus-outbox transaction, preserve prior acknowledged work, surface a safe error, and leave the database recoverable after reload.
- Automated macOS Chromium evidence is development evidence only. Windows installed-PWA, hard-power, and storage-pressure work is deliberately paused; it remains required only if a future decision needs a production PWA durability verdict.
- Tests use synthetic fixtures and isolated profiles only. Evidence must not contain production data, credentials, tokens, signed URLs, document bodies, signatures, or unrestricted filenames.

## Risk-ordered landscape

The order reflects architecture-killing uncertainty first, not an assertion that later threats are low severity. Only Spike 001 has a detailed record and README in this iteration.

| Order | Planned spike | Primary decision | Why it is ordered here | Definition state |
| --- | --- | --- | --- | --- |
| 001 | PWA IndexedDB durability and capacity | Can the PWA atomically retain acknowledged work and the required bounded corpus across the tested lifecycle? | Failure would reject the PWA as the complete offline runtime. | macOS development envelope passed; verdict `PARTIAL`; further work deferred |
| 002 | Local vault and device boundary | Can the selected runtime balance offline confidentiality, automatic locking, scope isolation, and recoverability on dedicated devices? | At-rest protection or recovery failure would be a non-negotiable runtime gate. | Deferred; no detailed row or README |
| 003 | Hostile outbox and live authorization | Can tampered, replayed, reordered, stale, or concurrent local commands remain harmless to cloud authority and tenant isolation? | A failure could create unauthorized or duplicate cloud effects. | Deferred; no detailed row or README |
| 004 | Long-offline evolution and reconciliation | Can migrations, conflicts, tombstones, expired cursors, resnapshots, and old clients preserve unacknowledged intent without resurrection or silent loss? | Indefinite offline operation makes version and history skew unavoidable. | Deferred; no detailed row or README |
| 005 | Offline file integrity and slow-link recovery | Can immutable local files resume through the real provider path with checksum, quarantine, scanning, and receipt-based retention? | Complete documents require files, and corruption or premature deletion can lose the only copy. | Deferred; no detailed row or README |
| 006 | PWA shell, updates, recovery, and operations | Can offline launch, cache allowlisting, interrupted updates, redacted diagnostics, export/restore, rollout, and rollback remain safe? | These controls determine whether the chosen runtime can be supported without leaking or stranding data. | Deferred; no detailed row or README |

## Detailed spike records

| # | Name | Type | Validates | Verdict | Tags |
| --- | --- | --- | --- | --- | --- |
| 001 | [PWA IndexedDB durability and capacity](./001-pwa-indexeddb-durability/README.md) | standard | Given a clean isolated browser profile and bounded scoped corpus, when document saves, reload recovery, persistence/quota checks, injected aborts, and target-device interruption procedures run, then document and outbox state remain atomic, acknowledged work recovers exactly, cross-scope queries return nothing, and admission fails safely before corruption. | `PARTIAL` | `pwa`, `indexeddb`, `durability`, `quota`, `recovery`, `tm-004`, `tm-013`, `tm-015` |

Spike 001 evidence belongs in [its verification package](../../artifacts/verification/offline-foundation/001-pwa-indexeddb-durability/README.md). The current macOS development result supports `PARTIAL`; its remaining matrix is intentionally deferred and does not block the cloud MVP.

## Verdicts

- `PENDING`: required evidence has not been completed or reviewed.
- `VALIDATED`: every non-negotiable gate in the spike passed on the required targets and residual risks were accepted.
- `PARTIAL`: useful properties were demonstrated, but a required target, scenario, or recovery property remains conditional.
- `INVALIDATED`: a non-negotiable requirement failed or the tested runtime cannot make the required claim.
