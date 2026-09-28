import type { TemplateFlowDraft } from "@/types/template-flow"

const FNV_32_OFFSET_BASIS = 2_166_136_261
const FNV_32_PRIME = 16_777_619
const SECOND_HASH_OFFSET = 3_332_758_029
const SECOND_HASH_PRIME = 2_246_822_519

type CanonicalJsonValue =
  | boolean
  | number
  | string
  | null
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue }

/**
 * Produces a stable, compact fingerprint for stale-proposal comparisons.
 *
 * The fingerprint covers everything Flow reads of the draft, including
 * embedded image bytes, without retaining a second serialized copy of them.
 *
 * @param draft - Draft whose exact accepted state should be identified.
 * @returns Versioned dual-32-bit fingerprint with serialized length.
 */
export function createTemplateFlowDraftFingerprint(
  draft: TemplateFlowDraft
): string {
  const serializedDraft = JSON.stringify(
    toCanonicalJsonValue(toTemplateFlowDraft(draft))
  )
  let firstHash = FNV_32_OFFSET_BASIS
  let secondHash = SECOND_HASH_OFFSET

  for (let index = 0; index < serializedDraft.length; index += 1) {
    const characterCode = serializedDraft.charCodeAt(index)
    firstHash = Math.imul(firstHash ^ characterCode, FNV_32_PRIME) >>> 0
    secondHash =
      Math.imul(
        secondHash ^ characterCode ^ (index & 0xff),
        SECOND_HASH_PRIME
      ) >>> 0
  }

  return `flow-draft-v1:${serializedDraft.length}:${firstHash
    .toString(16)
    .padStart(8, "0")}${secondHash.toString(16).padStart(8, "0")}`
}

/**
 * Keeps only what Flow reads and writes of a draft. The editor's own state
 * carries more, such as the category, which Flow's request refuses.
 *
 * @param draft - A draft, or editor state holding one.
 * @returns The title, description, and content alone.
 */
export function toTemplateFlowDraft(draft: TemplateFlowDraft): TemplateFlowDraft {
  return {
    content: draft.content,
    description: draft.description,
    title: draft.title
  }
}

function toCanonicalJsonValue(value: unknown): CanonicalJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown): CanonicalJsonValue =>
      item === undefined ? null : toCanonicalJsonValue(item)
    )
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    const canonicalRecord: { [key: string]: CanonicalJsonValue } = {}

    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) {
        canonicalRecord[key] = toCanonicalJsonValue(record[key])
      }
    }

    return canonicalRecord
  }

  throw new TypeError("Template Flow drafts must contain JSON-compatible values.")
}
