import type {
  TemplateFlowDraft,
  TemplateFlowProposal
} from "@/types/template-flow"

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

/** Snapshot retained so one accepted Flow proposal can be undone atomically. */
export type TemplateFlowProposalUndoSnapshot = Readonly<{
  proposalId: string
  draft: TemplateFlowDraft
  changedBlockIds: readonly string[]
}>

/** Session-local state for staging and resolving one coherent Flow proposal. */
export type TemplateFlowProposalState = Readonly<{
  baseDraft: TemplateFlowDraft
  changedBlockIds: readonly string[]
  pendingProposal: TemplateFlowProposal | null
  status: "idle" | "pending" | "stale"
  undoSnapshot: TemplateFlowProposalUndoSnapshot | null
  lastResolution: "accepted" | "rejected" | "undone" | null
}>

/** Actions supported by the pure Flow proposal reducer. */
export type TemplateFlowProposalAction =
  | Readonly<{ type: "stage"; proposal: TemplateFlowProposal }>
  | Readonly<{
      type: "sync_base"
      draft: TemplateFlowDraft
      changedBlockIds: readonly string[]
      clearUndo?: boolean
    }>
  | Readonly<{ type: "accept_all" }>
  | Readonly<{ type: "reject_all" }>
  | Readonly<{ type: "mark_stale" }>
  | Readonly<{ type: "undo_acceptance" }>

/**
 * Creates proposal state around the editor's current accepted draft.
 *
 * @param baseDraft - Current draft used by preview and save controls.
 * @param changedBlockIds - Existing editor highlights to restore on undo.
 * @returns New idle, session-local proposal state.
 */
export function createTemplateFlowProposalState(
  baseDraft: TemplateFlowDraft,
  changedBlockIds: readonly string[] = []
): TemplateFlowProposalState {
  return {
    baseDraft,
    changedBlockIds: [...changedBlockIds],
    pendingProposal: null,
    status: "idle",
    undoSnapshot: null,
    lastResolution: null
  }
}

/**
 * Reduces one proposal action without mutating the prior state or browser draft.
 *
 * Acceptance is all-or-nothing and fails closed by marking the proposal stale
 * whenever the current base draft no longer matches its captured fingerprint.
 *
 * @param state - Current session-local proposal state.
 * @param action - Staging, resolution, synchronization, or undo action.
 * @returns The next immutable proposal state.
 */
export function templateFlowProposalReducer(
  state: TemplateFlowProposalState,
  action: TemplateFlowProposalAction
): TemplateFlowProposalState {
  switch (action.type) {
    case "stage":
      return stageProposal(state, action.proposal)
    case "sync_base":
      return syncBaseDraft(state, action)
    case "accept_all":
      return acceptPendingProposal(state)
    case "reject_all":
      return rejectPendingProposal(state)
    case "mark_stale":
      return markPendingProposalStale(state)
    case "undo_acceptance":
      return undoAcceptedProposal(state)
  }
}

/**
 * Selects the candidate preview while retaining the accepted base for saving.
 *
 * @param state - Current proposal state.
 * @returns The pending candidate, or the accepted base when no proposal exists.
 */
export function previewTemplateFlowDraft(
  state: TemplateFlowProposalState
): TemplateFlowDraft {
  return state.pendingProposal?.candidateDraft ?? state.baseDraft
}

/**
 * Reports whether the pending coherent batch can be accepted on the current base.
 *
 * @param state - Current proposal state.
 * @returns True only for a pending proposal whose fingerprint still matches.
 */
export function canAcceptTemplateFlowProposal(
  state: TemplateFlowProposalState
): boolean {
  return (
    state.pendingProposal?.status === "pending" &&
    state.pendingProposal.baseDraftFingerprint ===
      createTemplateFlowDraftFingerprint(state.baseDraft)
  )
}

/**
 * Produces a stable, compact fingerprint for stale-proposal comparisons.
 *
 * The fingerprint covers the complete draft, including embedded image bytes,
 * without retaining a second serialized copy of those bytes.
 *
 * @param draft - Draft whose exact accepted state should be identified.
 * @returns Versioned dual-32-bit fingerprint with serialized length.
 */
export function createTemplateFlowDraftFingerprint(
  draft: TemplateFlowDraft
): string {
  const serializedDraft = JSON.stringify(toCanonicalJsonValue(draft))
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

function stageProposal(
  state: TemplateFlowProposalState,
  proposal: TemplateFlowProposal
): TemplateFlowProposalState {
  if (state.pendingProposal !== null) {
    return state
  }

  const isCurrentBase =
    proposal.status === "pending" &&
    proposal.baseDraftFingerprint ===
    createTemplateFlowDraftFingerprint(state.baseDraft)
  const stagedProposal: TemplateFlowProposal = isCurrentBase
    ? proposal
    : { ...proposal, status: "stale" }

  return {
    ...state,
    pendingProposal: stagedProposal,
    status: isCurrentBase ? "pending" : "stale",
    lastResolution: null
  }
}

function syncBaseDraft(
  state: TemplateFlowProposalState,
  action: Extract<TemplateFlowProposalAction, { type: "sync_base" }>
): TemplateFlowProposalState {
  const nextState: TemplateFlowProposalState = {
    ...state,
    baseDraft: action.draft,
    changedBlockIds: [...action.changedBlockIds],
    undoSnapshot: action.clearUndo ? null : state.undoSnapshot
  }

  if (
    nextState.pendingProposal !== null &&
    nextState.pendingProposal.baseDraftFingerprint !==
      createTemplateFlowDraftFingerprint(action.draft)
  ) {
    return markPendingProposalStale(nextState)
  }

  return nextState
}

function acceptPendingProposal(
  state: TemplateFlowProposalState
): TemplateFlowProposalState {
  const proposal = state.pendingProposal

  if (proposal === null) {
    return state
  }

  if (!canAcceptTemplateFlowProposal(state)) {
    return markPendingProposalStale(state)
  }

  return {
    baseDraft: proposal.candidateDraft,
    changedBlockIds: [...proposal.changedBlockIds],
    pendingProposal: null,
    status: "idle",
    undoSnapshot: {
      proposalId: proposal.id,
      draft: state.baseDraft,
      changedBlockIds: [...state.changedBlockIds]
    },
    lastResolution: "accepted"
  }
}

function rejectPendingProposal(
  state: TemplateFlowProposalState
): TemplateFlowProposalState {
  if (state.pendingProposal === null) {
    return state
  }

  return {
    ...state,
    pendingProposal: null,
    status: "idle",
    lastResolution: "rejected"
  }
}

function markPendingProposalStale(
  state: TemplateFlowProposalState
): TemplateFlowProposalState {
  if (state.pendingProposal === null) {
    return state
  }

  return {
    ...state,
    pendingProposal: {
      ...state.pendingProposal,
      status: "stale"
    },
    status: "stale"
  }
}

function undoAcceptedProposal(
  state: TemplateFlowProposalState
): TemplateFlowProposalState {
  if (state.undoSnapshot === null) {
    return state
  }

  return {
    baseDraft: state.undoSnapshot.draft,
    changedBlockIds: [...state.undoSnapshot.changedBlockIds],
    pendingProposal: null,
    status: "idle",
    undoSnapshot: null,
    lastResolution: "undone"
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
