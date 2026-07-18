const DATABASE_NAME = "bizflow-offline-spike-001"
const DATABASE_VERSION = 1
const MEBIBYTE = 1024 * 1024
const MAX_CORPUS_BYTES = 64 * MEBIBYTE
const MINIMUM_SAFETY_MARGIN_BYTES = 32 * MEBIBYTE
const KILL_WINDOW_MILLISECONDS = 60_000
const EVENT_LIMIT = 250
const EVENT_STORAGE_KEY = "bizflow-spike-001-events"
const RELOAD_MARKER_KEY = "bizflow-spike-001-reload-marker"
const KILL_MARKER_KEY = "bizflow-spike-001-kill-marker"
const KILL_ORACLE_META_KEY = "kill-window-oracle"
const KEEPALIVE_META_KEY = "kill-window-keepalive"

const elements = {
  globalStatus: document.querySelector("#global-status"),
  strictSummary: document.querySelector("#strict-summary"),
  persistSummary: document.querySelector("#persist-summary"),
  storageSummary: document.querySelector("#storage-summary"),
  recordSummary: document.querySelector("#record-summary"),
  recoverySummary: document.querySelector("#recovery-summary"),
  capabilityOutput: document.querySelector("#capability-output"),
  atomicOutput: document.querySelector("#atomic-output"),
  killWindowOutput: document.querySelector("#kill-window-output"),
  isolationOutput: document.querySelector("#isolation-output"),
  corpusOutput: document.querySelector("#corpus-output"),
  eventLog: document.querySelector("#event-log"),
  corpusProgress: document.querySelector("#corpus-progress"),
  admissionPreview: document.querySelector("#admission-preview"),
  corpusCountInput: document.querySelector("#corpus-count-input"),
  corpusKibInput: document.querySelector("#corpus-kib-input"),
  corpusUserSelect: document.querySelector("#corpus-user-select"),
  corpusOrgSelect: document.querySelector("#corpus-org-select"),
  queryUserSelect: document.querySelector("#query-user-select"),
  queryOrgSelect: document.querySelector("#query-org-select"),
  runSelfTestButton: document.querySelector("#run-self-test-button"),
  strictProbeButton: document.querySelector("#strict-probe-button"),
  refreshStorageButton: document.querySelector("#refresh-storage-button"),
  requestPersistButton: document.querySelector("#request-persist-button"),
  atomicCommitButton: document.querySelector("#atomic-commit-button"),
  abortRollbackButton: document.querySelector("#abort-rollback-button"),
  saveReloadButton: document.querySelector("#save-reload-button"),
  armKillWindowButton: document.querySelector("#arm-kill-window-button"),
  reloadDuringWindowButton: document.querySelector("#reload-during-window-button"),
  isolationTestButton: document.querySelector("#isolation-test-button"),
  queryScopeButton: document.querySelector("#query-scope-button"),
  writeCorpusButton: document.querySelector("#write-corpus-button"),
  simulateQuotaButton: document.querySelector("#simulate-quota-button"),
  exportLogButton: document.querySelector("#export-log-button"),
  clearLogButton: document.querySelector("#clear-log-button"),
  resetButton: document.querySelector("#reset-button"),
}

let databasePromise
let forensicEvents = readStoredEvents()
let killWindowActive = false

/**
 * Convert an IndexedDB request into a promise.
 *
 * @template T
 * @param {IDBRequest<T>} request IndexedDB request to observe.
 * @returns {Promise<T>} Resolves with the request result.
 */
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true })
    request.addEventListener(
      "error",
      () => reject(request.error ?? new DOMException("IndexedDB request failed", "UnknownError")),
      { once: true },
    )
  })
}

/**
 * Wait for an IndexedDB transaction to commit or abort.
 *
 * @param {IDBTransaction} transaction Transaction to observe.
 * @returns {Promise<void>} Resolves only after the complete event.
 */
function transactionCompletion(transaction) {
  const completion = new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true })
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError")),
      { once: true },
    )
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new DOMException("Transaction failed", "UnknownError")),
      { once: true },
    )
  })

  // A request can reject before its caller reaches `await completion`.
  // Observe the rejection immediately while preserving it for the caller.
  void completion.catch(() => undefined)
  return completion
}

/**
 * Open the isolated prototype database.
 *
 * @returns {Promise<IDBDatabase>} Open database connection.
 */
function openDatabase() {
  if (databasePromise !== undefined) {
    return databasePromise
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

    request.addEventListener("upgradeneeded", () => {
      const database = request.result
      const documents = database.createObjectStore("documents", { keyPath: "recordKey" })
      documents.createIndex("scopeKey", "scopeKey", { unique: false })

      const outbox = database.createObjectStore("outbox", { keyPath: "mutationId" })
      outbox.createIndex("scopeKey", "scopeKey", { unique: false })

      const corpus = database.createObjectStore("corpus", { keyPath: "recordKey" })
      corpus.createIndex("scopeKey", "scopeKey", { unique: false })

      database.createObjectStore("meta", { keyPath: "key" })
    })

    request.addEventListener("success", () => {
      const database = request.result
      database.addEventListener("versionchange", () => database.close())
      resolve(database)
    })
    request.addEventListener(
      "error",
      () => reject(request.error ?? new DOMException("Unable to open IndexedDB", "UnknownError")),
      { once: true },
    )
    request.addEventListener(
      "blocked",
      () => reject(new DOMException("IndexedDB upgrade is blocked by another tab", "InvalidStateError")),
      { once: true },
    )
  })

  return databasePromise
}

/**
 * Create a transaction and record whether the durability option was accepted.
 *
 * @param {IDBDatabase} database Open database.
 * @param {string[]} storeNames Object stores in the transaction.
 * @param {IDBTransactionMode} mode Transaction mode.
 * @param {IDBTransactionDurability} durability Requested durability hint.
 * @returns {{ transaction: IDBTransaction, optionsAccepted: boolean }} Transaction result.
 */
function createTransaction(database, storeNames, mode, durability = "strict") {
  try {
    return {
      transaction: database.transaction(storeNames, mode, { durability }),
      optionsAccepted: true,
    }
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error
    }

    return {
      transaction: database.transaction(storeNames, mode),
      optionsAccepted: false,
    }
  }
}

/**
 * Build an immutable local scope key from synthetic identity identifiers.
 *
 * @param {string} userId Synthetic user identifier.
 * @param {string} organizationId Synthetic organization identifier.
 * @returns {string} Compound scope key.
 */
function scopeKey(userId, organizationId) {
  return `${userId}::${organizationId}`
}

/**
 * Compute a stable SHA-256 digest for fixture metadata.
 *
 * @param {string} value Input string.
 * @returns {Promise<string>} Lowercase hexadecimal digest.
 */
async function sha256(value) {
  const encoded = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", encoded)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * Compute a SHA-256 digest for synthetic binary fixture bytes.
 *
 * @param {ArrayBuffer | ArrayBufferView} value Synthetic byte buffer.
 * @returns {Promise<string>} Lowercase hexadecimal digest.
 */
async function sha256Bytes(value) {
  const digest = await crypto.subtle.digest("SHA-256", value)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * Create deterministic high-entropy-looking bytes so browser compression does
 * not make the corpus look materially smaller than realistic encrypted files.
 *
 * @param {number} length Required byte length.
 * @param {number} seed Non-zero unsigned seed.
 * @returns {Uint8Array} Deterministic synthetic bytes.
 */
function createDeterministicBytes(length, seed) {
  const bytes = new Uint8Array(length)
  let state = seed >>> 0 || 0x9e3779b9

  for (let index = 0; index < length; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[index] = state & 0xff
  }

  return bytes
}

/**
 * Convert an unknown failure into non-sensitive diagnostic metadata.
 *
 * @param {unknown} error Failure value.
 * @returns {{ errorName: string, errorCategory: string }} Safe error metadata.
 */
function safeError(error) {
  const errorName = error instanceof DOMException || error instanceof Error ? error.name : "UnknownError"
  const errorCategory =
    errorName === "QuotaExceededError"
      ? "storage_quota"
      : errorName === "AbortError"
        ? "transaction_abort"
        : "prototype_failure"

  return { errorName, errorCategory }
}

/**
 * Reject sensitive or payload-shaped keys before persisting forensic metadata.
 *
 * @param {Record<string, unknown>} metadata Candidate event metadata.
 * @returns {Record<string, unknown>} Sanitized shallow metadata.
 */
function sanitizeMetadata(metadata) {
  const prohibitedKey = /(body|content|payload|signature|token|secret|credential|signed.?url|file.?name|binary|blob)/i
  const sanitized = {}

  for (const [key, value] of Object.entries(metadata)) {
    if (prohibitedKey.test(key)) {
      continue
    }

    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Append a bounded metadata-only forensic event.
 *
 * @param {string} category Event category.
 * @param {string} action Stable action identifier.
 * @param {"info" | "pass" | "fail" | "conditional"} outcome Event outcome.
 * @param {Record<string, unknown>} [metadata] Safe event metadata.
 * @returns {void}
 */
function recordEvent(category, action, outcome, metadata = {}) {
  forensicEvents.push({
    at: new Date().toISOString(),
    category,
    action,
    outcome,
    metadata: sanitizeMetadata(metadata),
  })
  forensicEvents = forensicEvents.slice(-EVENT_LIMIT)

  try {
    localStorage.setItem(EVENT_STORAGE_KEY, JSON.stringify(forensicEvents))
  } catch {
    // Evidence remains available in memory when browser storage is unavailable.
  }

  renderEvents()
}

/**
 * Read previously stored forensic events without trusting their shape.
 *
 * @returns {Array<Record<string, unknown>>} Stored event list or an empty list.
 */
function readStoredEvents() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EVENT_STORAGE_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed.slice(-EVENT_LIMIT) : []
  } catch {
    return []
  }
}

/** Render the current forensic event list. */
function renderEvents() {
  elements.eventLog.replaceChildren()

  for (const event of [...forensicEvents].reverse()) {
    const item = document.createElement("li")
    const summary = document.createElement("strong")
    const detail = document.createElement("span")
    const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {}

    summary.textContent = `${String(event.outcome).toUpperCase()} · ${String(event.action)}`
    detail.textContent = `${String(event.at)} · ${String(event.category)} · ${JSON.stringify(metadata)}`
    item.className = `event-${String(event.outcome)}`
    item.append(summary, detail)
    elements.eventLog.append(item)
  }
}

/**
 * Set a human-readable output state.
 *
 * @param {HTMLElement} element Output element.
 * @param {string} message Message to display.
 * @param {"neutral" | "pass" | "fail" | "conditional"} [state] Visual state.
 */
function setOutput(element, message, state = "neutral") {
  element.textContent = message
  element.dataset.state = state
}

/**
 * Temporarily disable a button while an operation runs.
 *
 * @template T
 * @param {HTMLButtonElement} button Button to disable.
 * @param {() => Promise<T>} operation Async operation.
 * @returns {Promise<T>} Operation result.
 */
async function withBusyButton(button, operation) {
  const wasDisabled = button.disabled
  button.disabled = true

  try {
    return await operation()
  } finally {
    button.disabled = wasDisabled
    elements.reloadDuringWindowButton.disabled = !killWindowActive
    button.blur()
  }
}

/**
 * Count all records in one object store.
 *
 * @param {string} storeName Object-store name.
 * @returns {Promise<number>} Record count.
 */
async function countStore(storeName) {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, "readonly")
  const completion = transactionCompletion(transaction)
  const count = await requestResult(transaction.objectStore(storeName).count())
  await completion
  return count
}

/** Refresh the top-level record counts. */
async function refreshRecordSummary() {
  const [documentCount, outboxCount, corpusCount] = await Promise.all([
    countStore("documents"),
    countStore("outbox"),
    countStore("corpus"),
  ])
  elements.recordSummary.textContent = `${documentCount} docs · ${outboxCount} outbox · ${corpusCount} corpus`
}

/**
 * Read the browser storage estimate and persistence state.
 *
 * @returns {Promise<{ usage: number | null, quota: number | null, persisted: boolean | null }>} Observation.
 */
async function readStorageObservation() {
  const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : {}
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null
  return {
    usage: typeof estimate.usage === "number" ? estimate.usage : null,
    quota: typeof estimate.quota === "number" ? estimate.quota : null,
    persisted,
  }
}

/** Format a byte count for display. */
function formatBytes(value) {
  if (value === null || !Number.isFinite(value)) {
    return "unavailable"
  }
  if (value < 1024) {
    return `${value} B`
  }
  if (value < MEBIBYTE) {
    return `${(value / 1024).toFixed(1)} KiB`
  }
  return `${(value / MEBIBYTE).toFixed(1)} MiB`
}

/** Refresh storage status and the admission preview. */
async function refreshStorageStatus() {
  const observation = await readStorageObservation()
  elements.persistSummary.textContent =
    observation.persisted === null ? "Unsupported" : observation.persisted ? "Granted" : "Not granted"
  elements.storageSummary.textContent = `${formatBytes(observation.usage)} / ${formatBytes(observation.quota)}`
  setOutput(
    elements.capabilityOutput,
    `Secure context: ${window.isSecureContext}. Persisted: ${String(observation.persisted)}. ` +
      `Reported usage: ${formatBytes(observation.usage)}. Reported quota: ${formatBytes(observation.quota)}.`,
    "neutral",
  )
  recordEvent("storage", "storage_observed", "info", {
    secureContext: window.isSecureContext,
    usageBytes: observation.usage,
    quotaBytes: observation.quota,
    persisted: observation.persisted,
  })
  await updateAdmissionPreview()
  return observation
}

/** Probe support for explicit strict IndexedDB durability. */
async function probeStrictDurability() {
  const database = await openDatabase()
  const { transaction, optionsAccepted } = createTransaction(database, ["meta"], "readwrite", "strict")
  const completion = transactionCompletion(transaction)
  const reportedDurability = transaction.durability ?? "unreported"

  await requestResult(
    transaction.objectStore("meta").put({
      key: "strict-probe",
      observedAt: new Date().toISOString(),
    }),
  )
  await completion

  const passed = optionsAccepted && reportedDurability === "strict"
  elements.strictSummary.textContent = passed ? "Reported strict" : "Not proven"
  setOutput(
    elements.capabilityOutput,
    `Strict option accepted: ${optionsAccepted}. Transaction reported: ${reportedDurability}. ` +
      "This is a durability hint, not proof against power loss.",
    passed ? "conditional" : "fail",
  )
  recordEvent("durability", "strict_durability_probe", passed ? "conditional" : "fail", {
    optionsAccepted,
    reportedDurability,
  })

  return { optionsAccepted, reportedDurability, passed }
}

/** Request persistent storage after an explicit user action. */
async function requestPersistentStorage() {
  if (!navigator.storage?.persist) {
    throw new DOMException("Persistent storage API is unavailable", "NotSupportedError")
  }

  const before = navigator.storage.persisted ? await navigator.storage.persisted() : null
  const granted = await navigator.storage.persist()
  const after = navigator.storage.persisted ? await navigator.storage.persisted() : null
  elements.persistSummary.textContent = after ? "Granted" : "Not granted"
  setOutput(
    elements.capabilityOutput,
    `Persistence before request: ${String(before)}. Request result: ${granted}. ` +
      `Persistence after request: ${String(after)}. Explicit user clearing remains possible.`,
    after ? "conditional" : "neutral",
  )
  recordEvent("storage", "persistence_requested", after ? "conditional" : "info", {
    persistedBefore: before,
    requestGranted: granted,
    persistedAfter: after,
  })
  return { before, granted, after }
}

/**
 * Save one document revision and matching outbox command atomically.
 *
 * @param {{ userId: string, organizationId: string, scenario: string, abortAfterDocument?: boolean, quotaAfterDocument?: boolean }} input Save input.
 * @returns {Promise<Record<string, unknown>>} Saved pair metadata.
 */
async function saveAtomicPair(input) {
  const database = await openDatabase()
  const runId = crypto.randomUUID()
  const currentScopeKey = scopeKey(input.userId, input.organizationId)
  const documentId = `${input.scenario}-${runId}`
  const recordKey = `${currentScopeKey}::${documentId}`
  const mutationId = crypto.randomUUID()
  const fixtureDigest = await sha256(`${recordKey}:${mutationId}:revision-1`)
  const startedAt = performance.now()
  const { transaction, optionsAccepted } = createTransaction(
    database,
    ["documents", "outbox", "meta"],
    "readwrite",
    "strict",
  )
  const completion = transactionCompletion(transaction)
  const reportedDurability = transaction.durability ?? "unreported"

  recordEvent("transaction", "transaction_started", "info", {
    scenario: input.scenario,
    runId,
    optionsAccepted,
    reportedDurability,
  })

  await requestResult(
    transaction.objectStore("documents").put({
      recordKey,
      scopeKey: currentScopeKey,
      userId: input.userId,
      organizationId: input.organizationId,
      documentId,
      revision: 1,
      fixtureDigest,
      mutationId,
      savedAt: new Date().toISOString(),
    }),
  )
  recordEvent("transaction", "document_request_succeeded", "info", {
    scenario: input.scenario,
    runId,
  })

  if (input.abortAfterDocument || input.quotaAfterDocument) {
    transaction.abort()
    try {
      await completion
    } catch {
      // The expected abort is represented by the explicit injected error below.
    }

    throw input.quotaAfterDocument
      ? new DOMException("Injected quota failure", "QuotaExceededError")
      : new DOMException("Injected rollback after document write", "AbortError")
  }

  await requestResult(
    transaction.objectStore("outbox").put({
      mutationId,
      scopeKey: currentScopeKey,
      userId: input.userId,
      organizationId: input.organizationId,
      documentId,
      recordKey,
      commandType: "document.answer.patch",
      fixtureDigest,
      createdAt: new Date().toISOString(),
    }),
  )
  recordEvent("transaction", "outbox_request_succeeded", "info", {
    scenario: input.scenario,
    runId,
  })

  await requestResult(
    transaction.objectStore("meta").put({
      key: `ack:${recordKey}`,
      recordKey,
      mutationId,
      fixtureDigest,
      acknowledgedAt: new Date().toISOString(),
    }),
  )
  await completion

  const durationMs = Number((performance.now() - startedAt).toFixed(2))
  recordEvent("transaction", "transaction_complete", "pass", {
    scenario: input.scenario,
    runId,
    durationMs,
    reportedDurability,
  })
  recordEvent("ui", "local_save_acknowledged", "pass", {
    scenario: input.scenario,
    runId,
  })

  return {
    runId,
    scopeKey: currentScopeKey,
    documentId,
    recordKey,
    mutationId,
    fixtureDigest,
    reportedDurability,
    optionsAccepted,
    durationMs,
  }
}

/**
 * Read a document and outbox record by their exact primary keys.
 *
 * @param {string} recordKey Document record key.
 * @param {string} mutationId Outbox mutation identifier.
 * @returns {Promise<{ document: unknown, outbox: unknown }>} Recovered records.
 */
async function readPair(recordKey, mutationId) {
  const database = await openDatabase()
  const transaction = database.transaction(["documents", "outbox"], "readonly")
  const completion = transactionCompletion(transaction)
  const documentRecord = await requestResult(transaction.objectStore("documents").get(recordKey))
  const outboxRecord = await requestResult(transaction.objectStore("outbox").get(mutationId))
  await completion
  return { document: documentRecord, outbox: outboxRecord }
}

/**
 * Persist the kill-window oracle in its own completed strict transaction.
 * LocalStorage is only an auxiliary display marker because a process kill can
 * lose a recently buffered localStorage write.
 *
 * @param {Record<string, unknown>} marker Synthetic recovery marker.
 * @returns {Promise<void>} Resolves after the oracle transaction completes.
 */
async function writeKillOracle(marker) {
  const database = await openDatabase()
  const { transaction } = createTransaction(database, ["meta"], "readwrite", "strict")
  const completion = transactionCompletion(transaction)
  await requestResult(transaction.objectStore("meta").put({ key: KILL_ORACLE_META_KEY, ...marker }))
  await completion
}

/** Read the independently committed kill-window oracle. */
async function readKillOracle() {
  const database = await openDatabase()
  const transaction = database.transaction("meta", "readonly")
  const completion = transactionCompletion(transaction)
  const marker = await requestResult(transaction.objectStore("meta").get(KILL_ORACLE_META_KEY))
  await completion
  return marker
}

/** Delete the consumed kill-window oracle. */
async function deleteKillOracle() {
  const database = await openDatabase()
  const { transaction } = createTransaction(database, ["meta"], "readwrite", "strict")
  const completion = transactionCompletion(transaction)
  await requestResult(transaction.objectStore("meta").delete(KILL_ORACLE_META_KEY))
  await completion
}

/** Test a successful atomic pair commit. */
async function testAtomicCommit() {
  const saved = await saveAtomicPair({
    userId: "synthetic-user-a",
    organizationId: "synthetic-org-red",
    scenario: "atomic-commit",
  })
  const recovered = await readPair(saved.recordKey, saved.mutationId)
  const passed = recovered.document !== undefined && recovered.outbox !== undefined

  setOutput(
    elements.atomicOutput,
    passed
      ? `PASS — document and outbox committed together after ${saved.durationMs} ms.`
      : "FAIL — the expected document/outbox pair was not recovered.",
    passed ? "pass" : "fail",
  )
  recordEvent("verification", "atomic_pair_verified", passed ? "pass" : "fail", {
    runId: saved.runId,
    documentPresent: recovered.document !== undefined,
    outboxPresent: recovered.outbox !== undefined,
  })
  await refreshRecordSummary()
  return passed
}

/** Test rollback after the document request succeeds but before outbox creation. */
async function testInjectedAbort() {
  const beforeDocuments = await countStore("documents")
  const beforeOutbox = await countStore("outbox")
  let observedError

  try {
    await saveAtomicPair({
      userId: "synthetic-user-a",
      organizationId: "synthetic-org-red",
      scenario: "injected-abort",
      abortAfterDocument: true,
    })
  } catch (error) {
    observedError = safeError(error)
  }

  const afterDocuments = await countStore("documents")
  const afterOutbox = await countStore("outbox")
  const passed =
    observedError?.errorName === "AbortError" &&
    beforeDocuments === afterDocuments &&
    beforeOutbox === afterOutbox

  setOutput(
    elements.atomicOutput,
    passed
      ? "PASS — injected abort left document and outbox counts unchanged."
      : "FAIL — rollback did not preserve the prior record counts.",
    passed ? "pass" : "fail",
  )
  recordEvent("verification", "injected_abort_verified", passed ? "pass" : "fail", {
    errorName: observedError?.errorName ?? "none",
    documentsBefore: beforeDocuments,
    documentsAfter: afterDocuments,
    outboxBefore: beforeOutbox,
    outboxAfter: afterOutbox,
  })
  return passed
}

/** Save a pair, persist an independent reload oracle, and reload the page. */
async function saveAndReload() {
  const saved = await saveAtomicPair({
    userId: "synthetic-user-a",
    organizationId: "synthetic-org-red",
    scenario: "reload-recovery",
  })
  sessionStorage.setItem(
    RELOAD_MARKER_KEY,
    JSON.stringify({
      recordKey: saved.recordKey,
      mutationId: saved.mutationId,
      fixtureDigest: saved.fixtureDigest,
      acknowledgedAt: new Date().toISOString(),
    }),
  )
  window.location.reload()
}

/** Recover and verify any pending reload oracle. */
async function recoverReloadMarker() {
  const rawMarker = sessionStorage.getItem(RELOAD_MARKER_KEY)
  if (rawMarker === null) {
    return
  }

  sessionStorage.removeItem(RELOAD_MARKER_KEY)
  try {
    const marker = JSON.parse(rawMarker)
    const recovered = await readPair(marker.recordKey, marker.mutationId)
    const documentRecord = recovered.document
    const outboxRecord = recovered.outbox
    const passed =
      documentRecord !== undefined &&
      outboxRecord !== undefined &&
      documentRecord.fixtureDigest === marker.fixtureDigest &&
      outboxRecord.fixtureDigest === marker.fixtureDigest

    elements.recoverySummary.textContent = passed ? "Reload pair recovered" : "Reload recovery failed"
    setOutput(
      elements.atomicOutput,
      passed
        ? "PASS — the exact acknowledged document/outbox metadata recovered after reload."
        : "FAIL — reload did not recover the exact acknowledged pair.",
      passed ? "pass" : "fail",
    )
    recordEvent("recovery", "reload_recovery_verified", passed ? "pass" : "fail", {
      documentPresent: documentRecord !== undefined,
      outboxPresent: outboxRecord !== undefined,
      digestMatched: passed,
    })
  } catch (error) {
    const diagnostic = safeError(error)
    elements.recoverySummary.textContent = "Reload marker invalid"
    recordEvent("recovery", "reload_recovery_failed", "fail", diagnostic)
  }
}

/**
 * Keep a native IndexedDB transaction active until a deadline by continuously
 * queueing a harmless request from the preceding request callback.
 *
 * @param {IDBObjectStore} store Meta object store within the active transaction.
 * @param {number} deadline Epoch-millisecond deadline.
 * @returns {Promise<number>} Number of keepalive requests completed.
 */
function keepTransactionAlive(store, deadline) {
  return new Promise((resolve, reject) => {
    let iterations = 0

    const pump = () => {
      const request = store.get(KEEPALIVE_META_KEY)
      request.addEventListener(
        "success",
        () => {
          iterations += 1
          if (Date.now() >= deadline) {
            resolve(iterations)
            return
          }
          pump()
        },
        { once: true },
      )
      request.addEventListener(
        "error",
        () => reject(request.error ?? new DOMException("Keepalive request failed", "UnknownError")),
        { once: true },
      )
    }

    pump()
  })
}

/** Arm a 60-second transaction window for abrupt browser termination. */
async function armKillWindow() {
  if (killWindowActive) {
    return
  }

  killWindowActive = true
  elements.reloadDuringWindowButton.disabled = false
  const database = await openDatabase()
  const runId = crypto.randomUUID()
  const currentScopeKey = scopeKey("synthetic-user-a", "synthetic-org-red")
  const documentId = `kill-window-${runId}`
  const recordKey = `${currentScopeKey}::${documentId}`
  const mutationId = crypto.randomUUID()
  const fixtureDigest = await sha256(`${recordKey}:${mutationId}:kill-window`)
  const marker = {
    phase: "armed",
    recordKey,
    mutationId,
    fixtureDigest,
    armedAt: new Date().toISOString(),
    windowSeconds: KILL_WINDOW_MILLISECONDS / 1000,
  }
  await writeKillOracle(marker)
  localStorage.setItem(KILL_MARKER_KEY, JSON.stringify(marker))

  const { transaction } = createTransaction(
    database,
    ["documents", "outbox", "meta"],
    "readwrite",
    "strict",
  )
  const completion = transactionCompletion(transaction)
  const documents = transaction.objectStore("documents")
  const outbox = transaction.objectStore("outbox")
  const meta = transaction.objectStore("meta")

  try {
    await requestResult(
      documents.put({
        recordKey,
        scopeKey: currentScopeKey,
        userId: "synthetic-user-a",
        organizationId: "synthetic-org-red",
        documentId,
        revision: 1,
        fixtureDigest,
        mutationId,
        savedAt: new Date().toISOString(),
      }),
    )

    setOutput(
      elements.killWindowOutput,
      "ARMED — terminate the Playwright/browser process now. The outbox write has not run.",
      "conditional",
    )
    recordEvent("termination", "kill_window_armed", "conditional", {
      runId,
      windowSeconds: KILL_WINDOW_MILLISECONDS / 1000,
    })

    const iterations = await keepTransactionAlive(meta, Date.now() + KILL_WINDOW_MILLISECONDS)
    await requestResult(
      outbox.put({
        mutationId,
        scopeKey: currentScopeKey,
        userId: "synthetic-user-a",
        organizationId: "synthetic-org-red",
        documentId,
        recordKey,
        commandType: "document.answer.patch",
        fixtureDigest,
        createdAt: new Date().toISOString(),
      }),
    )
    await requestResult(
      meta.put({
        key: `ack:${recordKey}`,
        recordKey,
        mutationId,
        fixtureDigest,
        acknowledgedAt: new Date().toISOString(),
      }),
    )
    await requestResult(meta.put({ key: KILL_ORACLE_META_KEY, ...marker, phase: "committed" }))
    await completion
    localStorage.setItem(KILL_MARKER_KEY, JSON.stringify({ ...marker, phase: "committed" }))
    setOutput(
      elements.killWindowOutput,
      `COMMITTED — the 60-second window elapsed after ${iterations} keepalive requests. Reload to verify both records.`,
      "pass",
    )
    recordEvent("termination", "kill_window_committed", "pass", { runId, keepaliveIterations: iterations })
  } catch (error) {
    const diagnostic = safeError(error)
    recordEvent("termination", "kill_window_failed", "fail", { runId, ...diagnostic })
    throw error
  } finally {
    killWindowActive = false
    elements.reloadDuringWindowButton.disabled = true
  }
}

/** Recover and verify a kill-window marker after process restart or reload. */
async function recoverKillWindowMarker() {
  const indexedDbMarker = await readKillOracle()
  const rawMarker = localStorage.getItem(KILL_MARKER_KEY)
  if (indexedDbMarker === undefined && rawMarker === null) {
    return
  }

  try {
    const marker = indexedDbMarker ?? JSON.parse(rawMarker)
    const recovered = await readPair(marker.recordKey, marker.mutationId)
    const documentPresent = recovered.document !== undefined
    const outboxPresent = recovered.outbox !== undefined
    const expectedCommitted = marker.phase === "committed"
    const passed = expectedCommitted
      ? documentPresent && outboxPresent
      : !documentPresent && !outboxPresent

    elements.recoverySummary.textContent = passed
      ? expectedCommitted
        ? "Committed pair recovered"
        : "Interrupted pair rolled back"
      : "Kill-window recovery failed"
    setOutput(
      elements.killWindowOutput,
      passed
        ? expectedCommitted
          ? "PASS — both records recovered after the completed kill window."
          : "PASS — neither partial record survived the interrupted transaction."
        : "FAIL — kill-window recovery found a torn or missing expected pair.",
      passed ? "pass" : "fail",
    )
    recordEvent("recovery", "kill_window_recovery_verified", passed ? "pass" : "fail", {
      oracleSource: indexedDbMarker === undefined ? "local_storage" : "indexeddb_strict_transaction",
      windowSeconds: marker.windowSeconds ?? "unknown",
      expectedCommitted,
      documentPresent,
      outboxPresent,
    })
    await deleteKillOracle()
    localStorage.removeItem(KILL_MARKER_KEY)
  } catch (error) {
    recordEvent("recovery", "kill_window_marker_failed", "fail", safeError(error))
  }
}

/**
 * Read all documents and outbox commands in one exact scope.
 *
 * @param {string} userId Synthetic user identifier.
 * @param {string} organizationId Synthetic organization identifier.
 * @returns {Promise<{ documents: Array<Record<string, unknown>>, outbox: Array<Record<string, unknown>> }>} Scoped rows.
 */
async function readScope(userId, organizationId) {
  const database = await openDatabase()
  const currentScopeKey = scopeKey(userId, organizationId)
  const transaction = database.transaction(["documents", "outbox"], "readonly")
  const completion = transactionCompletion(transaction)
  const documents = await requestResult(
    transaction.objectStore("documents").index("scopeKey").getAll(currentScopeKey),
  )
  const outbox = await requestResult(
    transaction.objectStore("outbox").index("scopeKey").getAll(currentScopeKey),
  )
  await completion
  return { documents, outbox }
}

/** Create and verify four isolated synthetic scopes. */
async function testScopeIsolation() {
  const runPrefix = `scope-test-${crypto.randomUUID()}`
  const scopes = [
    ["synthetic-user-a", "synthetic-org-red"],
    ["synthetic-user-a", "synthetic-org-blue"],
    ["synthetic-user-b", "synthetic-org-red"],
    ["synthetic-user-b", "synthetic-org-blue"],
  ]
  const savedPairs = []

  for (const [userId, organizationId] of scopes) {
    savedPairs.push(
      await saveAtomicPair({
        userId,
        organizationId,
        scenario: runPrefix,
      }),
    )
  }

  let passed = true
  for (const [userId, organizationId] of scopes) {
    const expectedScope = scopeKey(userId, organizationId)
    const result = await readScope(userId, organizationId)
    const runDocuments = result.documents.filter((row) => row.documentId.startsWith(runPrefix))
    const runOutbox = result.outbox.filter((row) => row.documentId.startsWith(runPrefix))
    passed =
      passed &&
      runDocuments.length === 1 &&
      runOutbox.length === 1 &&
      runDocuments.every((row) => row.scopeKey === expectedScope) &&
      runOutbox.every((row) => row.scopeKey === expectedScope)
  }

  const uniqueScopeKeys = new Set(savedPairs.map((pair) => pair.scopeKey)).size
  passed = passed && uniqueScopeKeys === 4
  setOutput(
    elements.isolationOutput,
    passed
      ? "PASS — each of four compound scopes returned only its own generated pair. This is filtering, not authorization."
      : "FAIL — one or more compound-scope queries returned missing or foreign rows.",
    passed ? "pass" : "fail",
  )
  recordEvent("isolation", "four_scope_query_verified", passed ? "pass" : "fail", {
    runPrefix,
    scopeCount: uniqueScopeKeys,
  })
  await refreshRecordSummary()
  return passed
}

/** Query the scope selected in the UI. */
async function querySelectedScope() {
  const userId = elements.queryUserSelect.value
  const organizationId = elements.queryOrgSelect.value
  const result = await readScope(userId, organizationId)
  setOutput(
    elements.isolationOutput,
    `${userId} / ${organizationId}: ${result.documents.length} documents and ${result.outbox.length} outbox commands.`,
    "neutral",
  )
  recordEvent("isolation", "scope_queried", "info", {
    userId,
    organizationId,
    documentCount: result.documents.length,
    outboxCount: result.outbox.length,
  })
}

/**
 * Parse and validate corpus controls.
 *
 * @returns {{ count: number, kibPerRecord: number, logicalBytes: number, userId: string, organizationId: string }} Corpus input.
 */
function readCorpusInput() {
  const count = Number(elements.corpusCountInput.value)
  const kibPerRecord = Number(elements.corpusKibInput.value)
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    throw new RangeError("Corpus record count must be between 1 and 200")
  }
  if (!Number.isInteger(kibPerRecord) || kibPerRecord < 1 || kibPerRecord > 2048) {
    throw new RangeError("Synthetic KiB per record must be between 1 and 2048")
  }

  const logicalBytes = count * kibPerRecord * 1024
  if (logicalBytes > MAX_CORPUS_BYTES) {
    throw new RangeError("One corpus run cannot exceed 64 MiB")
  }

  return {
    count,
    kibPerRecord,
    logicalBytes,
    userId: elements.corpusUserSelect.value,
    organizationId: elements.corpusOrgSelect.value,
  }
}

/** Compute the conservative corpus admission decision. */
async function readAdmissionDecision(input) {
  const observation = await readStorageObservation()
  if (observation.usage === null || observation.quota === null) {
    return { admitted: false, observation, safetyMarginBytes: null, reason: "estimate_unavailable" }
  }

  const safetyMarginBytes = Math.max(observation.quota * 0.2, MINIMUM_SAFETY_MARGIN_BYTES)
  const admitted = observation.usage + input.logicalBytes + safetyMarginBytes <= observation.quota
  return {
    admitted,
    observation,
    safetyMarginBytes,
    reason: admitted ? "within_bound_and_margin" : "inside_safety_margin",
  }
}

/** Update the UI admission preview. */
async function updateAdmissionPreview() {
  try {
    const input = readCorpusInput()
    const decision = await readAdmissionDecision(input)
    elements.admissionPreview.textContent =
      `Requested ${formatBytes(input.logicalBytes)}. Reserve ${formatBytes(decision.safetyMarginBytes)}. ` +
      `Decision: ${decision.admitted ? "ADMIT" : "REFUSE"} (${decision.reason}).`
    elements.admissionPreview.dataset.state = decision.admitted ? "pass" : "conditional"
  } catch (error) {
    elements.admissionPreview.textContent = error instanceof Error ? error.message : "Invalid corpus controls"
    elements.admissionPreview.dataset.state = "fail"
  }
}

/** Write one bounded synthetic corpus transaction. */
async function writeSyntheticCorpus() {
  const input = readCorpusInput()
  const decision = await readAdmissionDecision(input)
  if (!decision.admitted) {
    setOutput(
      elements.corpusOutput,
      `REFUSED — ${decision.reason}. Existing records were not changed.`,
      "conditional",
    )
    recordEvent("corpus", "corpus_admission_refused", "conditional", {
      requestedBytes: input.logicalBytes,
      safetyMarginBytes: decision.safetyMarginBytes,
      reason: decision.reason,
    })
    return false
  }

  const database = await openDatabase()
  const currentScopeKey = scopeKey(input.userId, input.organizationId)
  const runId = crypto.randomUUID()
  const startedAt = performance.now()
  const bytesPerRecord = input.kibPerRecord * 1024
  const fixtureRecords = []

  for (let index = 0; index < input.count; index += 1) {
    const syntheticBytes = createDeterministicBytes(bytesPerRecord, 0x51f15e + index * 2654435761)
    fixtureRecords.push({
      sequence: index,
      syntheticBytes: syntheticBytes.buffer,
      fixtureDigest: await sha256Bytes(syntheticBytes),
    })
    elements.corpusProgress.value = ((index + 1) / input.count) * 20
  }

  const { transaction } = createTransaction(database, ["corpus", "meta"], "readwrite", "strict")
  const completion = transactionCompletion(transaction)
  const corpus = transaction.objectStore("corpus")

  try {
    for (const fixture of fixtureRecords) {
      await requestResult(
        corpus.put({
          recordKey: `${currentScopeKey}::${runId}::${fixture.sequence}`,
          scopeKey: currentScopeKey,
          runId,
          sequence: fixture.sequence,
          logicalBytes: bytesPerRecord,
          fixtureDigest: fixture.fixtureDigest,
          syntheticBytes: fixture.syntheticBytes,
        }),
      )
      elements.corpusProgress.value = 20 + ((fixture.sequence + 1) / input.count) * 60
    }
    await requestResult(
      transaction.objectStore("meta").put({
        key: `corpus:${runId}`,
        scopeKey: currentScopeKey,
        recordCount: input.count,
        logicalBytes: input.logicalBytes,
        completedAt: new Date().toISOString(),
      }),
    )
    await completion
  } catch (error) {
    try {
      transaction.abort()
    } catch {
      // Transaction may already be aborted by the browser.
    }
    try {
      await completion
    } catch {
      // The original request error remains the useful failure to report.
    }
    throw error
  }

  const verificationTransaction = database.transaction("corpus", "readonly")
  const verificationCompletion = transactionCompletion(verificationTransaction)
  const storedRecords = await requestResult(
    verificationTransaction.objectStore("corpus").index("scopeKey").getAll(currentScopeKey),
  )
  await verificationCompletion
  const currentRunRecords = storedRecords.filter((record) => record.runId === runId)
  let checksumCount = 0
  for (const record of currentRunRecords) {
    if ((await sha256Bytes(record.syntheticBytes)) === record.fixtureDigest) {
      checksumCount += 1
    }
    elements.corpusProgress.value = 80 + (checksumCount / input.count) * 20
  }

  if (currentRunRecords.length !== input.count || checksumCount !== input.count) {
    throw new DOMException("Stored corpus checksum verification failed", "DataError")
  }

  const durationMs = Number((performance.now() - startedAt).toFixed(2))
  const after = await readStorageObservation()
  setOutput(
    elements.corpusOutput,
    `PASS — committed and verified ${input.count} records / ${formatBytes(input.logicalBytes)} in ${durationMs} ms. ` +
      `Browser now reports ${formatBytes(after.usage)} used.`,
    "pass",
  )
  recordEvent("corpus", "bounded_corpus_committed", "pass", {
    runId,
    recordCount: input.count,
    checksumCount,
    logicalBytes: input.logicalBytes,
    durationMs,
    usageBytesAfter: after.usage,
  })
  await refreshRecordSummary()
  await refreshStorageStatus()
  return true
}

/** Simulate a quota error after the document request and verify full rollback. */
async function testSimulatedQuotaFailure() {
  const beforeDocuments = await countStore("documents")
  const beforeOutbox = await countStore("outbox")
  let diagnostic = { errorName: "none", errorCategory: "none" }

  try {
    await saveAtomicPair({
      userId: "synthetic-user-a",
      organizationId: "synthetic-org-red",
      scenario: "simulated-quota",
      quotaAfterDocument: true,
    })
  } catch (error) {
    diagnostic = safeError(error)
  }

  const afterDocuments = await countStore("documents")
  const afterOutbox = await countStore("outbox")
  const passed =
    diagnostic.errorName === "QuotaExceededError" &&
    beforeDocuments === afterDocuments &&
    beforeOutbox === afterOutbox

  setOutput(
    elements.corpusOutput,
    passed
      ? "PASS (simulated) — QuotaExceededError aborted the entire pair and preserved prior counts. Real quota remains untested."
      : "FAIL — simulated quota handling changed record counts or produced the wrong error.",
    passed ? "pass" : "fail",
  )
  recordEvent("quota", "simulated_quota_rollback_verified", passed ? "pass" : "fail", {
    simulated: true,
    errorName: diagnostic.errorName,
    documentsBefore: beforeDocuments,
    documentsAfter: afterDocuments,
    outboxBefore: beforeOutbox,
    outboxAfter: afterOutbox,
  })
  return passed
}

/** Run the bounded automated development checks. */
async function runAutomatedChecks() {
  const startedAt = performance.now()
  const results = []
  results.push((await probeStrictDurability()).passed)
  results.push(await testAtomicCommit())
  results.push(await testInjectedAbort())
  results.push(await testScopeIsolation())
  results.push(await testSimulatedQuotaFailure())
  const passed = results.every(Boolean)
  const durationMs = Number((performance.now() - startedAt).toFixed(2))

  elements.globalStatus.textContent = passed
    ? `Automated development checks passed in ${durationMs} ms. Target-device gates remain pending.`
    : `One or more automated development checks failed after ${durationMs} ms.`
  elements.globalStatus.dataset.state = passed ? "pass" : "fail"
  recordEvent("suite", "automated_checks_complete", passed ? "pass" : "fail", {
    passedCount: results.filter(Boolean).length,
    checkCount: results.length,
    durationMs,
  })
  return passed
}

/** Export the current metadata-only evidence snapshot as JSON. */
async function exportForensicJson() {
  const storage = await readStorageObservation()
  const snapshot = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGiB: navigator.deviceMemory ?? null,
      secureContext: window.isSecureContext,
      origin: window.location.origin,
      databaseName: DATABASE_NAME,
      databaseVersion: DATABASE_VERSION,
    },
    storage,
    counts: {
      documents: await countStore("documents"),
      outbox: await countStore("outbox"),
      corpus: await countStore("corpus"),
    },
    events: forensicEvents,
    limitations: [
      "macOS browser evidence does not prove Windows Edge or Chrome behavior",
      "strict durability is a browser hint and not a no-loss guarantee",
      "simulated quota failure does not reproduce actual disk pressure or eviction",
      "scope filtering is not local encryption or cloud authorization",
    ],
  }
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = `bizflow-spike-001-${new Date().toISOString().replaceAll(":", "-")}.json`
  anchor.click()
  URL.revokeObjectURL(objectUrl)
  recordEvent("evidence", "forensic_json_exported", "info", { eventCount: forensicEvents.length })
}

/** Delete only the isolated prototype database and its recovery markers. */
async function resetPrototypeData() {
  const database = await openDatabase()
  database.close()
  databasePromise = undefined

  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME)
    request.addEventListener("success", () => resolve(), { once: true })
    request.addEventListener(
      "error",
      () => reject(request.error ?? new DOMException("Unable to delete prototype data", "UnknownError")),
      { once: true },
    )
    request.addEventListener(
      "blocked",
      () => reject(new DOMException("Close other prototype tabs before resetting", "InvalidStateError")),
      { once: true },
    )
  })

  sessionStorage.removeItem(RELOAD_MARKER_KEY)
  localStorage.removeItem(KILL_MARKER_KEY)
  await openDatabase()
  await refreshRecordSummary()
  await refreshStorageStatus()
  setOutput(elements.atomicOutput, "Prototype database reset. Forensic events were preserved.", "neutral")
  recordEvent("maintenance", "prototype_database_reset", "pass", {})
}

/** Run a button operation with consistent safe failure reporting. */
async function runButtonOperation(button, output, action, operation) {
  await withBusyButton(button, async () => {
    try {
      await operation()
    } catch (error) {
      const diagnostic = safeError(error)
      setOutput(output, `FAIL — ${diagnostic.errorName} (${diagnostic.errorCategory}).`, "fail")
      recordEvent("operation", action, "fail", diagnostic)
    }
  })
}

/** Bind interactive controls. */
function bindControls() {
  elements.runSelfTestButton.addEventListener("click", () =>
    runButtonOperation(elements.runSelfTestButton, elements.globalStatus, "automated_checks_failed", runAutomatedChecks),
  )
  elements.strictProbeButton.addEventListener("click", () =>
    runButtonOperation(elements.strictProbeButton, elements.capabilityOutput, "strict_probe_failed", probeStrictDurability),
  )
  elements.refreshStorageButton.addEventListener("click", () =>
    runButtonOperation(elements.refreshStorageButton, elements.capabilityOutput, "storage_refresh_failed", refreshStorageStatus),
  )
  elements.requestPersistButton.addEventListener("click", () =>
    runButtonOperation(
      elements.requestPersistButton,
      elements.capabilityOutput,
      "persistence_request_failed",
      requestPersistentStorage,
    ),
  )
  elements.atomicCommitButton.addEventListener("click", () =>
    runButtonOperation(elements.atomicCommitButton, elements.atomicOutput, "atomic_commit_failed", testAtomicCommit),
  )
  elements.abortRollbackButton.addEventListener("click", () =>
    runButtonOperation(elements.abortRollbackButton, elements.atomicOutput, "abort_test_failed", testInjectedAbort),
  )
  elements.saveReloadButton.addEventListener("click", () =>
    runButtonOperation(elements.saveReloadButton, elements.atomicOutput, "reload_save_failed", saveAndReload),
  )
  elements.armKillWindowButton.addEventListener("click", () =>
    runButtonOperation(elements.armKillWindowButton, elements.killWindowOutput, "kill_window_failed", armKillWindow),
  )
  elements.reloadDuringWindowButton.addEventListener("click", () => window.location.reload())
  elements.isolationTestButton.addEventListener("click", () =>
    runButtonOperation(elements.isolationTestButton, elements.isolationOutput, "isolation_test_failed", testScopeIsolation),
  )
  elements.queryScopeButton.addEventListener("click", () =>
    runButtonOperation(elements.queryScopeButton, elements.isolationOutput, "scope_query_failed", querySelectedScope),
  )
  elements.writeCorpusButton.addEventListener("click", () =>
    runButtonOperation(elements.writeCorpusButton, elements.corpusOutput, "corpus_write_failed", writeSyntheticCorpus),
  )
  elements.simulateQuotaButton.addEventListener("click", () =>
    runButtonOperation(
      elements.simulateQuotaButton,
      elements.corpusOutput,
      "simulated_quota_failed",
      testSimulatedQuotaFailure,
    ),
  )
  elements.exportLogButton.addEventListener("click", () =>
    runButtonOperation(elements.exportLogButton, elements.globalStatus, "forensic_export_failed", exportForensicJson),
  )
  elements.clearLogButton.addEventListener("click", () => {
    forensicEvents = []
    localStorage.removeItem(EVENT_STORAGE_KEY)
    renderEvents()
  })
  elements.resetButton.addEventListener("click", () =>
    runButtonOperation(elements.resetButton, elements.globalStatus, "prototype_reset_failed", resetPrototypeData),
  )
  elements.corpusCountInput.addEventListener("input", () => void updateAdmissionPreview())
  elements.corpusKibInput.addEventListener("input", () => void updateAdmissionPreview())
}

/** Initialize the prototype and recover any pending lifecycle oracle. */
async function initialize() {
  bindControls()
  renderEvents()
  try {
    await openDatabase()
    await recoverReloadMarker()
    await recoverKillWindowMarker()
    await refreshRecordSummary()
    await refreshStorageStatus()
    elements.globalStatus.textContent = "Ready. Run automated checks or an individual scenario."
    elements.globalStatus.dataset.state = "pass"
    recordEvent("lifecycle", "prototype_ready", "info", {
      databaseVersion: DATABASE_VERSION,
      secureContext: window.isSecureContext,
    })
  } catch (error) {
    const diagnostic = safeError(error)
    elements.globalStatus.textContent = `Initialization failed: ${diagnostic.errorName}.`
    elements.globalStatus.dataset.state = "fail"
    recordEvent("lifecycle", "prototype_initialization_failed", "fail", diagnostic)
  }
}

window.__BIZFLOW_SPIKE_001__ = Object.freeze({
  runAutomatedChecks,
  readStorageObservation,
  exportForensicJson,
})

void initialize()
