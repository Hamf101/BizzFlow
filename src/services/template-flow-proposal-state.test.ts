import { describe, expect, it } from "vitest"

import {
  canAcceptTemplateFlowProposal,
  createTemplateFlowDraftFingerprint,
  createTemplateFlowProposalState,
  previewTemplateFlowDraft,
  templateFlowProposalReducer
} from "@/services/template-flow-proposal-state"
import { createBlankTemplateContent } from "@/types/template"
import type {
  TemplateFlowDraft,
  TemplateFlowProposal
} from "@/types/template-flow"

describe("template Flow proposal state", () => {
  it("stages and previews a candidate without changing the accepted base", () => {
    const baseDraft = createDraft("Original")
    const proposal = createProposal(baseDraft, createDraft("Candidate"))
    const staged = templateFlowProposalReducer(
      createTemplateFlowProposalState(baseDraft),
      { type: "stage", proposal }
    )

    expect(staged.baseDraft).toBe(baseDraft)
    expect(staged.pendingProposal).toBe(proposal)
    expect(previewTemplateFlowDraft(staged).title).toBe("Candidate")
    expect(canAcceptTemplateFlowProposal(staged)).toBe(true)
  })

  it("accepts the complete batch and retains one undo snapshot", () => {
    const baseDraft = createDraft("Original")
    const candidateDraft = createDraft("Candidate")
    const staged = templateFlowProposalReducer(
      createTemplateFlowProposalState(baseDraft, ["prior-block"]),
      { type: "stage", proposal: createProposal(baseDraft, candidateDraft) }
    )
    const accepted = templateFlowProposalReducer(staged, {
      type: "accept_all"
    })

    expect(accepted.baseDraft).toBe(candidateDraft)
    expect(accepted.changedBlockIds).toEqual(["changed-block"])
    expect(accepted.pendingProposal).toBeNull()
    expect(accepted.lastResolution).toBe("accepted")
    expect(accepted.undoSnapshot).toMatchObject({
      proposalId: "proposal-1",
      draft: baseDraft,
      changedBlockIds: ["prior-block"]
    })

    const undone = templateFlowProposalReducer(accepted, {
      type: "undo_acceptance"
    })

    expect(undone.baseDraft).toBe(baseDraft)
    expect(undone.changedBlockIds).toEqual(["prior-block"])
    expect(undone.undoSnapshot).toBeNull()
    expect(undone.lastResolution).toBe("undone")
  })

  it("rejects the complete batch without changing the accepted base", () => {
    const baseDraft = createDraft("Original")
    const staged = templateFlowProposalReducer(
      createTemplateFlowProposalState(baseDraft),
      {
        type: "stage",
        proposal: createProposal(baseDraft, createDraft("Candidate"))
      }
    )
    const rejected = templateFlowProposalReducer(staged, {
      type: "reject_all"
    })

    expect(rejected.baseDraft).toBe(baseDraft)
    expect(rejected.pendingProposal).toBeNull()
    expect(rejected.lastResolution).toBe("rejected")
  })

  it("marks a proposal stale and refuses acceptance after a base edit", () => {
    const baseDraft = createDraft("Original")
    const staged = templateFlowProposalReducer(
      createTemplateFlowProposalState(baseDraft),
      {
        type: "stage",
        proposal: createProposal(baseDraft, createDraft("Candidate"))
      }
    )
    const edited = templateFlowProposalReducer(staged, {
      type: "sync_base",
      draft: createDraft("Manual edit"),
      changedBlockIds: []
    })
    const refused = templateFlowProposalReducer(edited, {
      type: "accept_all"
    })

    expect(refused.status).toBe("stale")
    expect(refused.pendingProposal?.status).toBe("stale")
    expect(refused.baseDraft.title).toBe("Manual edit")
    expect(refused.undoSnapshot).toBeNull()
    expect(canAcceptTemplateFlowProposal(refused)).toBe(false)
  })

  it("keeps the first pending batch when another stage action arrives", () => {
    const baseDraft = createDraft("Original")
    const firstProposal = createProposal(baseDraft, createDraft("First"))
    const firstState = templateFlowProposalReducer(
      createTemplateFlowProposalState(baseDraft),
      { type: "stage", proposal: firstProposal }
    )
    const secondState = templateFlowProposalReducer(firstState, {
      type: "stage",
      proposal: {
        ...createProposal(baseDraft, createDraft("Second")),
        id: "proposal-2"
      }
    })

    expect(secondState).toBe(firstState)
    expect(secondState.pendingProposal?.id).toBe("proposal-1")
  })

  it("fingerprints equivalent object key orders identically", () => {
    const draft = createDraft("Original")
    const reorderedDraft = {
      content: draft.content,
      description: draft.description,
      title: draft.title
    }

    expect(createTemplateFlowDraftFingerprint(reorderedDraft)).toBe(
      createTemplateFlowDraftFingerprint(draft)
    )
  })
})

function createDraft(title: string): TemplateFlowDraft {
  return {
    title,
    description: "Reusable template",
    content: createBlankTemplateContent()
  }
}

function createProposal(
  baseDraft: TemplateFlowDraft,
  candidateDraft: TemplateFlowDraft
): TemplateFlowProposal {
  return {
    id: "proposal-1",
    status: "pending",
    baseDraftFingerprint: createTemplateFlowDraftFingerprint(baseDraft),
    candidateDraft,
    operations: [
      {
        id: "operation-1",
        type: "set_title",
        summary: "Renamed template",
        target: "Document title",
        affectedBlockIds: []
      }
    ],
    changedBlockIds: ["changed-block"],
    qualityIssues: []
  }
}
