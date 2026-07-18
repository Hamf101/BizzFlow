# macOS Chrome 150 Development Result

## Decision

`PASS` for the automated macOS development envelope and `PARTIAL` for Spike 001 overall. The native IndexedDB harness preserved document/outbox atomicity in the tested browser, including a real root-browser `SIGKILL` during the current 60-second active-transaction window. This is process-crash evidence, not installed-PWA, Windows, storage-pressure, or hard-power evidence.

Continue evaluating the PWA candidate, but do not select it as the production offline runtime yet.

## Environment

- Evidence date: 2026-07-18 (America/Chicago)
- Base commit: `421e245`
- Working tree: uncommitted Spike 001 harness and evidence only
- OS: macOS 26.6, build 25G5028f, arm64
- Browser: system Google Chrome 150.0.7871.125, headed
- Browser binary: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- Profile: reused isolated persistent profile at ignored path `output/playwright/spike001-profile`
- Origin: `http://127.0.0.1:4173` (`isSecureContext === true`)
- Node.js: 22.16.0
- Playwright CLI: 0.1.17
- Database: `bizflow-offline-spike-001`, schema version 1
- Fixtures: generated user, organization, document, outbox, and binary corpus data only

The browser user-agent reports `Mac OS X 10_15_7`; the host version above comes from `sw_vers` and is the authoritative OS record for this run.

## Procedure

1. Start the dependency-free localhost harness:

   ~~~text
   node .planning/spikes/001-pwa-indexeddb-durability/server.mjs
   ~~~

2. Open Chrome with a headed persistent isolated profile and run the interactive automated checks.
3. Request persistent storage and write 25 generated 64-KiB high-entropy records in one bounded corpus run.
4. Save an acknowledged document/outbox pair, reload, and compare its stable metadata and digest.
5. Arm the current 60-second strict IndexedDB transaction window. Confirm the UI reports `ARMED`, resolve the root Chrome process by its exact isolated `--user-data-dir`, and send `SIGKILL` to that PID.
6. Reopen the same isolated profile, verify the independently committed IndexedDB oracle, and confirm that neither half of the interrupted document/outbox pair survived.
7. Rerun the five automated checks, confirm a clean browser console, capture a full-page screenshot, and export the metadata-only JSON.

The final abrupt-termination trial killed root Chrome PID 19621 after validating the exact profile command line. Killing only the automation daemon was rejected as insufficient because it can allow Chrome to finish normally.

## Observed Results

| Check | Result | Observation |
| --- | --- | --- |
| Strict transaction option | `CONDITIONAL` | Chrome accepted `{ durability: "strict" }` and reported `transaction.durability === "strict"`; this remains a hint, not a no-loss guarantee. |
| Atomic document/outbox commit | `PASS` | Both records became visible only after the shared transaction completed and the UI acknowledgement followed completion. |
| Injected abort | `PASS` | `AbortError` left document and outbox counts unchanged. |
| Reload recovery | `PASS` | Both acknowledged records recovered and the stored fixture digests matched exactly. |
| Four-scope filtering | `PASS` | Correct user/organization scope returned its generated pair; wrong-user, wrong-organization, and mixed-scope queries returned none. This is partitioning, not authorization. |
| Simulated quota rollback | `PASS` | Injected `QuotaExceededError` aborted the whole pair and preserved prior counts. Real quota exhaustion remains untested. |
| Bounded corpus | `PASS` | Latest run committed and SHA-256 verified 25 of 25 records, 1,638,400 logical bytes, in 73.9 ms. |
| Persistent storage request | `CONDITIONAL` | The reused isolated profile transitioned from `false` to granted/`true`; explicit deletion and other profiles remain outside this result. |
| Current 60-second process-kill window | `PASS` | Recovery used the independent strict IndexedDB oracle (`windowSeconds: 60`) and found neither document nor outbox record from the interrupted transaction. |
| Final automated rerun | `PASS` | 5 of 5 checks passed in 168.7 ms with zero browser console errors or warnings. |

The final export contains 30 document/outbox pairs and 50 corpus records accumulated across preserved exploratory and final runs. Its final storage estimate was 3,644,163 bytes used of 10,741,062,403 bytes quota, with persistence reported as granted. These values describe only this profile and are not production sizing limits.

## Investigation Trail

- A repeated-character 1.6-MiB fixture initially produced a misleadingly small usage estimate, consistent with implementation-defined compression. The harness now generates deterministic high-entropy binary data and verifies every stored record with SHA-256.
- A real `SIGKILL` could lose the recently written local-storage arm marker. The recovery oracle now lives in an independent completed strict IndexedDB transaction; local storage is display-only.
- Stopping the Playwright daemon did not reliably terminate the root browser. Final process-crash trials therefore validate the exact isolated Chrome command line before sending `SIGKILL` to the root browser PID.
- The bounded raw JSON retains earlier exploratory observations, including 15-second development windows and the resulting 156,624-byte low-usage observation from the compressible fixture. The decision above uses the latest current-code events: the recovery record explicitly reports `windowSeconds: 60`, the latest corpus record reports 25 checksum matches, and the latest automated suite reports 5 of 5 passing.

## Evidence Integrity

- Raw JSON: [macos-chrome-150-headed-persistent-profile.json](./macos-chrome-150-headed-persistent-profile.json)
- Raw JSON SHA-256: `eb83808a8d6a956c298797507afbe6f4ca020b1dba00027765a4761eda07a56b`
- Screenshot: [macos-chrome-150-result.png](./macos-chrome-150-result.png)
- Screenshot SHA-256: `f4c575f53c6054be9f9b1b272b7151afef0feebd5d3bdda7b0e751fdfc6d6d57`
- Export schema: 1
- Exported at: 2026-07-18T11:20:23.692Z
- Export outcomes: 94 pass, 145 informational, 11 conditional, 0 fail

## Open Gates

Spike 001 cannot be `VALIDATED` until all of these are recorded and reviewed:

- current stable Edge and Chrome on Windows 10/11, including installed-PWA mode;
- all required forced-termination boundaries on the target browsers;
- actual quota exhaustion and controlled storage-pressure behavior;
- normal site-data clearing and the declared recovery path;
- hard-power interruption on a disposable VM or dedicated test device; and
- representative pilot-device corpus measurements and an accepted safety margin.
