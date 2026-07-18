# Spike 001 Evidence: PWA IndexedDB Durability and Capacity

## Evidence Status

`PARTIAL` — the macOS Chrome development envelope is recorded and passed. Keep the Spike 001 production verdict partial until the required Windows installed-PWA, real quota/storage-pressure, clearing, and hard-power evidence is complete and reviewed.

This package is for synthetic, metadata-only evidence. Never place production documents, recipient details, signatures, credentials, tokens, signed URLs, database dumps, unrestricted filenames, or browser profiles here.

## Evidence Classes

Automated development evidence and target-device/manual evidence answer different questions and are not interchangeable.

### A. Automated macOS Chromium development evidence

This class may cover the automated portions of CAP-02, CAP-04, CAP-05, CAP-08, DUR-01, DUR-02, and VAULT-05 against the exact recorded Chromium binary, OS, profile, origin, and fixture configuration. It validates harness behavior, IndexedDB transaction invariants, reload recovery, scoped queries, capability reporting, bounded admission, and deterministic injected quota-error handling in that environment.

It does **not** validate:

- stable Microsoft Edge or Google Chrome on Windows;
- installed-PWA integration or enterprise browser policy;
- the Windows filesystem/storage stack or pilot hardware;
- user-driven site-data clearing;
- real storage-pressure eviction;
- forced operating-system or device power interruption; or
- a universal guarantee that strict durability prevents loss.

Reload, `page.close()`, and normal `browser.close()` are graceful lifecycle tests. A killed Chromium process, if added, is process-crash evidence only and must not be labeled power-loss evidence.

### B. Required Windows Edge and Chrome target evidence

Run all applicable CAP-02, CAP-04, CAP-05, CAP-08, DUR-01, DUR-02, and VAULT-05 cases on Windows 10/11 pilot-class hardware using current stable Microsoft Edge and Google Chrome. Record normal-tab and installed-PWA mode separately where behavior or policy differs. Use a fresh isolated synthetic profile for destructive scenarios.

A macOS Chromium pass cannot substitute for either Windows browser row.

### C. Required manual power and storage-pressure evidence

Run the manual portions of CAP-05, CAP-06, CAP-07, DUR-01, and DUR-07 only on a disposable virtual machine or dedicated test device. Include forced-termination boundaries, hard-power interruption at the documented boundaries, actual quota exhaustion, persistence denial where reproducible, normal site-data clearing, controlled storage pressure, restart/recovery, and cleanup.

Do not perform destructive power or disk-pressure testing on a primary workstation. A procedure blocked by hardware, browser policy, or inability to reproduce denial/eviction remains `BLOCKED` or `CONDITIONAL`; it is not a pass.

## Completion Matrix

| Evidence target | Scenarios | Required mode | Status | Result file / notes |
| --- | --- | --- | --- | --- |
| macOS + automated Chromium | Automated CAP-02/04/05/08, DUR-01/02, VAULT-05 cases | Headed system Chrome 150.0.7871.125; reused isolated persistent profile | `PASS` | [Result](./macos-chrome-150-result.md), [JSON](./macos-chrome-150-headed-persistent-profile.json), [screenshot](./macos-chrome-150-result.png) |
| Windows 10/11 + Microsoft Edge stable | Applicable CAP-02/04/05/08, DUR-01/02, VAULT-05 cases | Installed PWA; normal tab fallback recorded separately | `PENDING` | |
| Windows 10/11 + Google Chrome stable | Applicable CAP-02/04/05/08, DUR-01/02, VAULT-05 cases | Installed PWA; normal tab fallback recorded separately | `PENDING` | |
| Windows disposable VM/test device + Edge | Manual CAP-05/06/07, DUR-01/07 cases | Forced termination, actual quota, hard power, clearing, storage pressure | `PENDING` | |
| Windows disposable VM/test device + Chrome | Manual CAP-05/06/07, DUR-01/07 cases | Forced termination, actual quota, hard power, clearing, storage pressure | `PENDING` | |

## File Naming

Use lowercase names without customer or tester identity:

~~~text
YYYYMMDD-<os>-<browser>-<version>-<mode>-<scenario-id>-<result>.json
YYYYMMDD-<os>-<browser>-<version>-<mode>-<scenario-id>-<result>.png
YYYYMMDD-<os>-<browser>-<version>-<mode>-machine.md
~~~

Allowed result suffixes are `pass`, `fail`, `blocked`, and `conditional`. Keep raw exported JSON immutable after collection; place interpretation in a separate Markdown result record.

## Machine and Runtime Record Template

Create one machine record per distinct OS/browser/profile/mode combination.

~~~markdown
# Machine Record

- Evidence class: automated-macos-chromium | windows-edge | windows-chrome | manual-power-storage
- Date/time with timezone:
- Tester or automation identity:
- Git commit:
- Working tree clean: yes | no (list relevant changes)
- Build identifier:
- App/schema/protocol version:
- OS name, edition, version, and build:
- Physical device or VM:
- Device model / VM platform:
- CPU architecture:
- RAM:
- Storage medium and filesystem where known:
- Free disk before run:
- Power test isolation and recovery method, if applicable:
- Browser name:
- Browser full version and channel:
- Browser binary path/source:
- Browser policy state or policy export location:
- Mode: normal-tab | installed-pwa | headless | headed
- Profile: fresh-isolated | reused-isolated (explain)
- Origin and secure-context result:
- Third-party extensions disabled: yes | no (explain)
- Persistence before request:
- persist() result or error:
- Persistence after request:
- estimate() usage/quota before run:
- Requested transaction durability:
- Reported transaction durability:
- Fixture seed:
- Corpus requested count/bytes and configured bounds:
- Declared safety margin policy:
- Exact command or manual procedure version:
- Result/log directory:
- Cleanup confirmation:
~~~

Do not infer a browser version from an automation package version. Record the runtime's own reported version and the binary source/path.

## Per-scenario Test Result Template

Create one result record for each scenario/browser/mode run.

~~~markdown
# Test Result

- Scenario ID:
- Related approved scenario(s): CAP-__ | DUR-__ | VAULT-__
- Related threats: TM-004 | TM-013 | TM-015
- Evidence class:
- Machine record:
- Date/time with timezone:
- Git commit/build:
- Browser/runtime and mode:
- Synthetic fixture seed and bounded run parameters:
- Preconditions:
- Exact command or numbered manual steps:
- Injection/termination boundary, if any:
- Expected behavior:
- Observed behavior:
- Acknowledged revision before/after:
- Attempted revision before/after:
- Document count before/after:
- Outbox count before/after:
- Scope-negative query counts:
- Requested/reported durability:
- persisted() before / persist() result / persisted() after:
- estimate() usage/quota before/after:
- Actual write result and error name/safe category:
- Duration:
- Result: PASS | FAIL | BLOCKED | CONDITIONAL
- Machine-readable log:
- Screenshot/video, if safe:
- SHA-256 of raw result file:
- Residual risk or limitation:
- Recommended decision:
- Cleanup performed and confirmed:
- Reviewer/date:
~~~

## Manual Interruption Record Template

Use this addition for manual CAP-05, CAP-06, CAP-07, DUR-01, and DUR-07 cases. One record covers one browser, one boundary, and one interruption type; repeat rather than combining ambiguous observations.

~~~markdown
# Manual Interruption Record

- Scenario ID:
- Browser/mode:
- Disposable device/VM identifier:
- Boundary: before transaction | after document request | before commit/complete | immediately after complete | after saved indicator | startup recovery
- Interruption: forced-browser-termination | VM-power-cut | device-power-cut | storage-pressure | clear-site-data | persistence-denial
- How the boundary was positively identified:
- How interruption was triggered:
- Wall-clock delay between boundary signal and interruption:
- State expected after restart:
- State observed after restart:
- Document/outbox atomicity check:
- Last acknowledged revision recovered:
- Startup/reconciliation result:
- Prior data/index query result:
- Evidence files:
- Result: PASS | FAIL | BLOCKED | CONDITIONAL
- Safety/cleanup confirmation:
- Residual risk and decision impact:
~~~

## Required Scenario Evidence

| ID | Minimum attached observations |
| --- | --- |
| CAP-02 | Secure context, `persisted()` before/after, `persist()` result/error, strict-durability request and returned value |
| CAP-04 | Seed, hard caps, logical bytes, reserve calculation, estimate, admission decision, and actual write for each increment |
| CAP-05 / deterministic | Injected `QuotaExceededError`, transaction abort, no partial pair, prior-state read, and safe error output; labeled simulated |
| CAP-05 / actual | How real quota was controlled/reached, exact browser error/abort, no partial pair, prior-state read, cleanup, and successful retry |
| CAP-06 | Normal clear-site-data steps, missing-vault detection, declared recovery source, and proof that no recovery was invented |
| CAP-07 | Persistence state, storage-pressure procedure, eviction or non-eviction observation, restart/recovery, and cleanup |
| CAP-08 | Corpus parameters, observed usage delta, transaction duration, browser responsiveness, and admission result |
| DUR-01 / strict | Feature detection, request options, returned durability value or exact exception, browser/version/mode |
| DUR-01 / atomic | Transaction event order, saved-indicator timestamp, pair identifiers/counts after reopen, and injected-abort result |
| DUR-01 / forced termination | One record per process boundary and exact post-reopen state; process tests labeled separately from power tests |
| DUR-02 | Pre-reload acknowledged metadata and post-reload exact comparison |
| DUR-07 | Disposable environment, hard-power method, boundary timing, restart result, observed loss window, and repeat count |
| VAULT-05 / local scope | Correct, wrong-user, wrong-organization, and mixed-scope query counts for both stores; labeled local partitioning, not authz |

## Result Rules

- `PASS` means the stated scenario passed on the exact recorded machine/runtime/mode; it does not generalize beyond that evidence row.
- `FAIL` means an observable pass condition failed. Preserve the raw evidence and link the remediation/rerun rather than deleting it.
- `BLOCKED` means the scenario could not be executed or observed. It remains an open gate.
- `CONDITIONAL` means the observed behavior depends on a policy, capability, reproducibility limit, or accepted loss window that requires an explicit decision.
- Unsupported strict durability must be recorded as unsupported, never silently downgraded and passed.
- A favorable estimate followed by a failed write is a valid observation; the actual transaction result controls.
- A persistence grant is not proof against explicit deletion, corruption, browser defects, or power loss.
- No scenario may pass solely because vendor documentation predicts the behavior.

## Decision Summary Template

Complete only after all required rows have evidence.

~~~markdown
# Spike 001 Decision Summary

- Spike commit/build:
- Evidence review date:
- Automated macOS Chromium result:
- Windows Edge installed-PWA result:
- Windows Chrome installed-PWA result:
- Forced-termination result:
- Hard-power result:
- Storage-pressure/clear-data result:
- Atomic save gate:
- Scoped query gate:
- Strict durability capability and observed limits:
- Persistence behavior:
- Measured corpus and accepted safety margin:
- Quota-error/recovery gate:
- Failed or conditional scenarios:
- Accepted loss window, if any, and owner:
- Unresolved blockers:
- Recommended verdict: VALIDATED | PARTIAL | INVALIDATED
- Recommended runtime decision: continue PWA evaluation | require remediation/rerun | start Tauri/SQLite comparison
- Reviewer:
- Decision owner:
~~~

The decision summary cannot set `VALIDATED` while a required Windows browser, hard-power, or storage-pressure row is `PENDING`, `BLOCKED`, `FAIL`, or unaccepted `CONDITIONAL`.
