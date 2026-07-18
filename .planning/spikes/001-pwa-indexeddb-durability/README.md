---
spike: 001
name: pwa-indexeddb-durability
type: standard
validates: "Given a clean isolated browser profile and bounded user/organization-scoped corpus, when atomic saves, reload recovery, storage capability checks, quota failures, and target-device interruption procedures run, then document and outbox state remain atomic, acknowledged work recovers exactly, scoped queries do not leak, and unsafe writes are rejected without corrupting prior data."
verdict: PARTIAL
related: []
tags: [pwa, indexeddb, durability, quota, recovery, tm-004, tm-013, tm-015]
---

# Spike 001: PWA IndexedDB Durability and Capacity

## Status

`PARTIAL` — the automated macOS Chrome development envelope passed, including a real root-browser process kill during the current 60-second active transaction. Windows installed-PWA, actual quota/storage pressure, and hard-power gates remain open, so this result does not select the production runtime.

## What This Validates

Given a clean isolated browser profile, a bounded synthetic corpus, and immutable user/organization scopes, when BizFlow writes a document revision and matching outbox command, reloads the page, queries each scope, requests persistent storage, approaches and exceeds available quota, and is interrupted at defined lifecycle boundaries, then:

1. the document and outbox command are both committed or neither is;
2. the UI acknowledges a local save only after transaction completion;
3. the latest acknowledged state recovers exactly after reload or restart;
4. another user or organization scope cannot read the saved document or outbox command;
5. the runtime's strict-durability capability and actual transaction durability value are recorded;
6. persistence and quota estimates are recorded as runtime observations, not guarantees;
7. bounded admission rejects unsafe growth while retaining a safety margin; and
8. `QuotaExceededError` or another storage failure aborts atomically, preserves earlier work, and produces a recoverable safe error.

This is the first PWA architecture kill gate from the approved Offline Foundation plan. It covers the first isolated evidence for CAP-02 through CAP-05, CAP-08, DUR-01, DUR-02, and the local partitioning part of VAULT-05. Storage-pressure eviction, installed-PWA behavior, and hard-power claims remain manual target-device work even if the automated portion passes.

## Threats and Invariants

| Threat / invariant | Candidate control under test | Observable proof required |
| --- | --- | --- |
| TM-013: torn or falsely acknowledged local save | One short IndexedDB read-write transaction spans the document and outbox stores; saved state is emitted only after completion. | Inject an abort between logical writes and a deterministic quota error. The transaction leaves both new records or neither, and reload restores the last acknowledged revision. |
| TM-013: acknowledged work lost after interruption | Request `{ durability: "strict" }` where supported and record `transaction.durability`. | Capability report plus lifecycle/restart evidence on each target. The hint alone is not proof of disk-flush or power-loss survival. |
| TM-004: cross-user or cross-organization disclosure | Compound scope keys/indexes and repository queries require both immutable identifiers. | Positive query returns the fixture; wrong-user, wrong-organization, and mixed-scope queries return zero document and outbox rows. |
| TM-015: quota exhaustion or eviction | Inspect persistence and estimated usage/quota, admit only a bounded corpus with a conservative margin, and catch actual write failure. | Record `persist()`, `persisted()`, estimates before/after, admission decision, actual transaction result, and recovery after quota rejection. |
| TM-015: unsupported corpus | Generate deterministic bounded increments without production files. | Record requested and accepted counts, encoded byte sizes, observed IndexedDB usage, transaction latency, and the first rejected increment. Do not invent a production threshold before pilot measurements. |

## Research

Official documentation reviewed on 2026-07-18:

| Source | What it establishes | What it does not establish |
| --- | --- | --- |
| [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) | Browser storage is best-effort by default, persistent origins are excluded from automatic storage-pressure eviction, quotas vary, and writes can fail with `QuotaExceededError`. | The quota available on a pilot device or protection from explicit user clearing. |
| [MDN: `StorageManager.persist()`](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist) | The request resolves to the browser's actual boolean grant and is governed by browser-specific rules. | A guarantee that a request will be granted or that an installed PWA is automatically persistent. |
| [MDN: `StorageManager.estimate()`](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate) | `usage`, `quota`, and optional usage details are approximate and may be intentionally imprecise. | A storage reservation or proof that the next transaction will fit. |
| [MDN: `IDBTransaction.durability`](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/durability) | `strict`, `relaxed`, and `default` are transaction durability hints; the property exposes the chosen value. | A universal no-loss guarantee after power interruption. |
| [W3C Indexed Database API 3.0](https://w3c.github.io/IndexedDB/) | A transaction applies changes atomically, and the durability option describes when the user agent may consider a transaction committed. | Proof that BizFlow's implementation uses one transaction or survives a specific device failure. |
| [Microsoft Edge: Store data on the device](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/offline) | Edge documents IndexedDB for substantial structured/binary PWA data, storage estimates, quota failure handling, persistence requests, and storage-pressure eviction behavior. | Behavior of the actual Windows pilot hardware, enterprise policy, or a specific installed-PWA profile. |
| [Chrome DevTools: View and change IndexedDB data](https://developer.chrome.com/docs/devtools/storage/indexeddb) | Chrome's supported inspection workflow can verify database versions, object stores, indexes, rows, and clearing behavior. | Transaction durability or recovery under process/power interruption. |
| [Chrome: IndexedDB durability mode defaults to relaxed](https://developer.chrome.com/blog/indexeddb-durability-mode-now-defaults-to-relaxed) | Chrome 121 and later default read-write transactions to relaxed durability, documents explicit strict syntax, and warns that strict mode still cannot guarantee against data loss. | The loss window or outcome on a particular device. |
| [Chrome/web.dev: Storage for the web](https://web.dev/articles/storage-for-the-web) | Chrome's guidance recommends IndexedDB for app data, documents estimates, actual `QuotaExceededError` transaction aborts, custom quota simulation, and Chromium eviction behavior. | A reservation of space or a substitute for target-device pressure tests. |
| [Chrome/web.dev: Persistent storage](https://web.dev/articles/persistent-storage) | Chromium may grant or deny persistence through silent heuristics; installation is one possible engagement signal, not a guarantee. | A promise that any specific installed PWA will receive persistence. |

Research constraints that shape the experiment:

- IndexedDB commits are atomic across all stores in one transaction. The experiment must still prove that the implementation actually uses one transaction and does not acknowledge between logical writes.
- Strict durability is a user-agent hint. The prototype must feature-detect the transaction option, record the returned property, and keep the verdict pending until interruption evidence exists.
- `estimate()` is useful for conservative admission and telemetry, but an estimate can be padded, compressed, stale, or implementation-defined. The actual transaction outcome remains authoritative.
- `persist()` may be silently granted or denied by Chromium heuristics. Record both the request result and `persisted()` state; never translate either result into an absolute durability promise.
- Persistent storage prevents automatic eviction under the documented model, but a user can still clear site data. Explicit clearing and recovery belong in the target-device evidence package.

## Chosen Approach

Build the smallest browser-visible harness with the native IndexedDB and Storage APIs so the experiment can observe the transaction option and returned durability value directly without adding a production abstraction. Serve the static harness from localhost, keep each experiment single-purpose, and export metadata-only results so a tester can inspect exact browser behavior without exposing synthetic record bodies in evidence logs. The production decision to access IndexedDB through Dexie remains provisional and is not being implemented or rejected by this isolated platform spike.

Do not add a generic offline framework, production sync, encryption, service-worker caching, file staging, cloud endpoints, or Tauri comparison in this spike. Those decisions depend on later spikes or on Spike 001 failing a PWA gate.

## Scenario Matrix

| Approved ID / case | Scenario | Method | Pass condition | Required evidence class |
| --- | --- | --- | --- | --- |
| DUR-01 / strict capability | Strict durability capability | Open a read-write transaction with `durability: "strict"`; record support, requested value, returned `transaction.durability`, browser, and any exception. | Strict is marked verified only when the returned property is exactly `strict`. Unsupported/default/relaxed is explicit and never mislabeled. | Automated macOS Chromium; repeat Windows Edge and Chrome |
| DUR-01 / atomic success | Atomic document plus outbox commit | Save one scoped document revision and one matching outbox command in one transaction. | Exactly one matching pair exists and the saved indicator occurs only after transaction completion. | Automated on every target |
| DUR-01 / injected abort | Abort between logical writes | Write the document, inject an exception before the outbox write/commit, and reopen the database. | Neither attempted row exists; the prior acknowledged pair is unchanged. | Automated on every target |
| DUR-01 / kill window | Browser/process termination boundaries | Arm the harness's 60-second window and terminate before transaction, between logical writes, before completion, immediately after completion, or after the saved indicator; reopen and reconcile. | No torn pair or false acknowledgement appears. Latest acknowledged state recovers. | Automated lifecycle evidence plus manual Windows forced termination |
| DUR-02 | Reload recovery | Save and acknowledge a deterministic revision, reload, reopen by scope, and compare stable IDs, revision, mutation ID, and integrity metadata. | Recovered metadata exactly matches the last acknowledged state and no unacknowledged revision appears. | Automated reload plus Windows installed-PWA restart |
| VAULT-05 / local scope | Scoped query isolation | Query the same local IDs under correct scope, wrong user, wrong organization, and mixed scope. | Only the exact user-plus-organization scope returns document or outbox rows. This proves local partitioning, not authorization. | Automated on every target |
| CAP-02 | Persistence and durability observation | Record secure-context support, `persisted()` before, `persist()` result, `persisted()` after, and strict durability probe. | Every value or unsupported/error state is explicit; installation, persistence, and strict mode are not promoted to guarantees. | Automated observation plus Windows installed-PWA/manual policy checks |
| CAP-04 / CAP-08 | Bounded corpus, admission, and timing | Add bounded deterministic records while applying the configured limits and storage reserve to each estimate; record actual write outcome and duration. | Writes stay within all prototype caps and reserve. Refused growth creates no partial pairs and existing work remains readable. | Automated on every target; production limits remain unset pending pilot measurement |
| CAP-05 / deterministic | Injected quota-error rollback | Throw a synthetic `QuotaExceededError` inside the same transaction path used by a real write, then reopen. | The failing pair is absent, prior pairs remain queryable, and the safe error is visible. This validates handling, not real quota behavior. | Automated on every target |
| CAP-05 / actual | Actual quota/write failure | In a fresh isolated target profile, use supported custom quota or controlled fill/pressure until a real transaction aborts; reload and retry after safe cleanup. | The failing pair is absent, prior data/indexes remain queryable, the exact browser error is recorded, and recovery succeeds. | Windows target/manual evidence; mandatory for final verdict |
| DUR-07 | Hard power interruption | Cut power only on a disposable VM/test device immediately after defined transaction boundaries and restart. | Observed recovery matches the product claim; any loss window is documented and accepted. | Manual Windows Edge and Chrome; mandatory for final verdict |
| CAP-06 / CAP-07 | Clearing and storage pressure | Separately clear site data through normal controls and create storage pressure in a disposable environment, including persistence-denied state where reproducible. | Behavior is recorded honestly; missing-vault detection never invents recovery; the PWA gate fails if required data can disappear without an accepted recovery path. | Manual Windows target evidence; mandatory for final verdict |

## Bounded Corpus and Admission Contract

The prototype corpus is deterministic and configurable, with hard development-test caps of 200 records, 2 MiB per record, and 64 MiB aggregate growth per run. These caps bound the harness; they are not production capacity claims. Each run records its seed, requested/accepted counts, logical bytes, observed `usage` before/after, reported `quota`, duration, and result. Synthetic payloads are generated data, never copied business records or files.

Admission uses all of these inputs:

1. the 200-record, 2-MiB-per-record, and 64-MiB-per-run caps;
2. the latest available `estimate()` result and estimated per-record overhead;
3. a reserved margin equal to the greater of 20% of reported quota or 32 MiB; and
4. the actual transaction success or failure.

If the estimate is unavailable, malformed, or inside the safety margin, fail closed for growth beyond the already approved bounded tier and leave existing work readable. If the actual write fails despite a favorable estimate, abort the entire pair, classify the storage error, and preserve the last acknowledged state. Numeric production limits are intentionally not fixed until representative Windows pilot hardware is measured.

## How to Run

Start the isolated static server from the repository root:

~~~text
node .planning/spikes/001-pwa-indexeddb-durability/server.mjs
~~~

Then open `http://127.0.0.1:4173` in the browser under test. Use the interactive controls to run each case and export the JSON result. Record this command, the commit, browser binary/version, profile mode, and fixture configuration in the evidence package. Do not claim a completed scenario when the exported result and machine record are absent.

## What to Expect

The interactive harness should show:

- exact runtime and secure-context information;
- strict-durability support, requested value, and reported transaction value;
- persistence state before and after the request;
- usage/quota estimates and the declared safety margin;
- current scoped document/outbox pair counts;
- each scenario's expected, observed, duration, and pass/fail/blocked/conditional state;
- the last acknowledged revision separately from the last attempted revision; and
- an export action that emits metadata-only JSON suitable for the evidence directory.

A green screen is not a final PWA verdict. The harness must keep target-browser and manual interruption requirements visible as incomplete until their evidence is attached and reviewed.

## Observability

Every scenario emits an ISO timestamp, scenario ID, event category, elapsed milliseconds, browser/runtime metadata, fixture seed and bounded run parameters, user/organization scope identifiers that are synthetic and non-sensitive, transaction outcome, error name/safe category, and before/after counts. Logs must never include payload bodies, signatures, tokens, signed URLs, credentials, or unrestricted filenames.

The version-1 JSON export contains `prototype`, `environment`, `storage`, and `events`. Events contain sequence, timestamp, approved scenario ID, action, outcome, and sanitized metadata only. The exported summary must include event counts, durations, errors by safe category, persistence and estimate observations, requested/reported durability, corpus parameters, and cleanup status. Record a cryptographic hash beside the evidence file during collection.

## Evidence Boundary

The [evidence README](../../../artifacts/verification/offline-foundation/001-pwa-indexeddb-durability/README.md) defines the machine, version, and per-scenario result templates.

- Automated macOS Chromium runs validate the harness and the exact bundled Chromium build on that machine.
- Windows 10/11 stable Edge and Chrome installed-PWA runs validate the target runtime assumptions.
- Reload, page close, and ordinary browser close are lifecycle evidence, not abrupt-power evidence.
- Even a killed browser process is process-crash evidence, not proof that OS and device buffers survived power loss.
- Manual power interruption, persistence denial/clearing, and storage-pressure/eviction procedures must use disposable VMs or dedicated test devices and remain mandatory for a final verdict.

## Investigation Trail

| Date | Iteration | Observation | Next action |
| --- | --- | --- | --- |
| 2026-07-18 | Definition | Approved Offline Foundation plan makes PWA durability and capacity the first runtime kill gate. Official APIs expose useful atomicity, durability-hint, persistence, and estimate surfaces, but documentation cannot prove target-device behavior. | Implement the isolated harness, run automated macOS Chromium evidence, then execute the Windows/manual evidence matrix. |
| 2026-07-18 | Corpus iteration | A repeated-character 1.6-MiB fixture produced a misleadingly small storage estimate. | Replace it with deterministic high-entropy binary records and verify every stored checksum. |
| 2026-07-18 | Process-kill iteration | A recent local-storage marker could disappear after root Chrome received `SIGKILL`, and stopping the automation daemon did not reliably kill Chrome. | Persist the oracle in its own completed strict IndexedDB transaction and resolve the exact isolated root-browser PID before termination. |
| 2026-07-18 | macOS evidence | Current-code automation passed 5/5, 25 corpus checksums matched, reload recovery passed, and a 60-second-window `SIGKILL` recovered neither half of the interrupted pair. | Keep the spike `PARTIAL`; run the required Windows installed-PWA, real quota/storage-pressure, clearing, and hard-power matrix. |

Add one row per meaningful implementation or test iteration. Preserve failed and surprising observations; do not overwrite them with the final summary.

## Results

**Verdict: `PARTIAL`.**

The [macOS Chrome 150 development result](../../../artifacts/verification/offline-foundation/001-pwa-indexeddb-durability/macos-chrome-150-result.md) passed the local automated envelope:

- 5 of 5 current automated checks passed with a clean browser console;
- strict durability was requested and reported as `strict`, with the documented hint limitation;
- atomic commit, injected abort, exact reload recovery, four-scope filtering, and simulated quota rollback passed;
- a 25-record, 1.6-MiB high-entropy corpus committed and all 25 SHA-256 checksums matched; and
- a real root Chrome `SIGKILL` during the current 60-second active transaction recovered neither partial record using an independently committed IndexedDB oracle.

The PWA candidate remains undecided. `VALIDATED` requires:

- the automated scenarios pass against the recorded macOS Chromium binary;
- the same applicable scenarios run on current stable Microsoft Edge and Google Chrome on Windows 10/11 in installed-PWA mode;
- forced termination, hard-power interruption, persistence-denied/cleared, quota failure, and storage-pressure procedures are completed safely;
- the bounded corpus and safety margin are supported by measurements on representative pilot hardware;
- raw metadata-only logs/screenshots and cleanup confirmations are attached; and
- residual risk is documented and accepted.

Any torn document/outbox pair, false saved acknowledgement, cross-scope result, unrecoverable quota failure, unbounded admission, or unexplained loss of acknowledged work invalidates this candidate until remediated and rerun. If required data can disappear under the accepted storage/power envelope without an acceptable recovery path, the PWA fails this non-negotiable gate and the Tauri/SQLite comparison becomes mandatory.
