import type { SubmissionActorInput, SubmissionServiceDeps } from "@/services/submissions/contracts"
import { SubmissionServiceError } from "@/services/submissions/errors"
import { transitionInternalSubmission } from "@/services/submissions/review-service"
import { setInternalSubmissionReviewers } from "@/services/submissions/reviewer-service"

/** The most submissions one bulk change takes: a page of the list. */
const MAX_BULK_SUBMISSIONS = 50

export type ReviewSubmissionsInBulkInput = SubmissionActorInput & {
  /** Start: take each one on as its only reviewer. Approve: approve each one in review. */
  change: "approve" | "start"
  /** Each submission at the revision the reviewer saw, so a changed one is refused. */
  items: ReadonlyArray<{ id: string; revision: number }>
}

/**
 * Starts or approves several submissions at once, each exactly as one at a
 * time would be: every permission, state and revision check still applies, so
 * one the reviewer may not change, or that changed since they saw it, is
 * counted rather than changed. An unexpected failure stops the run.
 *
 * @param input - Actor, tenant, the change, and the submissions as seen.
 * @param deps - Optional trusted database dependency.
 * @returns The ids changed, and how many were refused.
 */
export async function reviewSubmissionsInBulk(
  input: ReviewSubmissionsInBulkInput,
  deps: SubmissionServiceDeps = {}
): Promise<{ changed: string[]; failed: number }> {
  if (input.items.length > MAX_BULK_SUBMISSIONS) {
    throw new SubmissionServiceError(`Choose up to ${MAX_BULK_SUBMISSIONS} submissions at a time.`, 400)
  }

  const { actorUserId, organizationId } = input
  const changed: string[] = []
  let failed = 0

  // One after another: each takes its submission's lock.
  for (const { id, revision } of input.items) {
    try {
      if (input.change === "start") {
        await setInternalSubmissionReviewers(
          { actorUserId, organizationId, submissionId: id, expectedRevision: revision, reviewerIds: [actorUserId], requiredApprovals: 1 },
          deps
        )
      } else {
        await transitionInternalSubmission(
          { actorUserId, organizationId, submissionId: id, expectedRevision: revision, targetStatus: "approved" },
          deps
        )
      }

      changed.push(id)
    } catch (error: unknown) {
      if (!(error instanceof SubmissionServiceError) || error.statusCode >= 500) {
        throw error
      }

      failed += 1
    }
  }

  return { changed, failed }
}
