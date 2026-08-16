const DRAFT_PREFIX = "bizflow:draft:v1:"
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Result of one best-effort local draft write. */
export type LocalDraftWriteResult =
  | { status: "saved"; savedAt: string }
  | { status: "unavailable" }
  | { status: "failed" }

export type SavedDraft<T = Record<string, unknown>> = {
  key: string
  data: T
  savedAt: string
  expiresAt: string
}

function isClient(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined"
}

/**
 * Saves a versioned local recovery draft without throwing into the editor.
 *
 * @param key - Stable resource-scoped key, such as `template:<uuid>`.
 * @param data - Serializable draft payload.
 * @param ttlMs - Retention window in milliseconds.
 * @returns Whether the write succeeded, was unavailable, or failed.
 */
export function saveLocalDraft<T>(
  key: string,
  data: T,
  ttlMs: number = DEFAULT_TTL_MS
): LocalDraftWriteResult {
  if (!isClient()) {
    return { status: "unavailable" }
  }

  try {
    const now = new Date()
    const payload: SavedDraft<T> = {
      key,
      data,
      savedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    }
    localStorage.setItem(`${DRAFT_PREFIX}${key}`, JSON.stringify(payload))
    return { status: "saved", savedAt: payload.savedAt }
  } catch (error) {
    console.warn("local_draft_save_failed", {
      key,
      reason: error instanceof Error ? error.name : "UnknownError"
    })
    return { status: "failed" }
  }
}

/**
 * Loads a non-expired local recovery draft.
 *
 * @param key - Stable resource-scoped key used when saving.
 * @returns Parsed draft metadata and data, or `null` when unavailable or invalid.
 */
export function loadLocalDraft<T>(key: string): SavedDraft<T> | null {
  if (!isClient()) {
    return null
  }

  try {
    const raw = localStorage.getItem(`${DRAFT_PREFIX}${key}`)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<SavedDraft<T>>

    if (
      parsed.key !== key ||
      typeof parsed.savedAt !== "string" ||
      typeof parsed.expiresAt !== "string" ||
      !("data" in parsed)
    ) {
      return null
    }

    const expiresAt = new Date(parsed.expiresAt).getTime()

    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      clearLocalDraft(key)
      return null
    }

    return parsed as SavedDraft<T>
  } catch (error: unknown) {
    console.warn("local_draft_load_failed", {
      key,
      reason: error instanceof Error ? error.name : "UnknownError"
    })
    return null
  }
}

/**
 * Removes a local recovery draft without affecting the cloud resource.
 *
 * @param key - Stable resource-scoped key used when saving.
 * @returns Nothing.
 */
export function clearLocalDraft(key: string): void {
  if (!isClient()) {
    return
  }

  try {
    localStorage.removeItem(`${DRAFT_PREFIX}${key}`)
  } catch (error: unknown) {
    console.warn("local_draft_clear_failed", {
      key,
      reason: error instanceof Error ? error.name : "UnknownError"
    })
  }
}
