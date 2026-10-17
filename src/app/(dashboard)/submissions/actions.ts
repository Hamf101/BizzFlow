"use server"

import { revalidatePath } from "next/cache"

import { parseGeneratedDocumentAnswers } from "@/components/documents/generated-document-form-data"
import type { ActionFeedbackCode } from "@/lib/action-result"
import {
  ActionError,
  loadActionContext,
  requireFormId,
  runFormAction,
  type ActionActor,
} from "@/lib/form-action"
import { getFormString } from "@/lib/form-utils"
import {
  createInternalSubmissionComment,
  createInternalSubmissionDraft,
  decideSubmissionSuggestion,
  dismissSubmissionChangesRequest,
  listSubmissionPage,
  saveInternalSubmissionDraft,
  setInternalSubmissionReviewers,
  shareInternalSubmission,
  submitInternalSubmission,
  suggestSubmissionAnswers,
  transitionInternalSubmission,
  type SubmissionReviewTransition,
} from "@/services/submission-service"
import type { Submission } from "@/types/submission"

const NO_ORGANIZATION = "Create an organization before managing submissions."

/**
 * Starts an internal submission draft from an immutable published template.
 *
 * @param formData - Template identifier and user-facing submission title.
 * @returns Never returns; redirects to the draft or a user-safe error.
 */
export async function createSubmissionAction(formData: FormData): Promise<void> {
  await runFormAction({
    event: "submission_create_action",
    path: "/submissions/new",
    success: "submission_created",
    run: async () => {
      const { actor } = await loadActionContext(NO_ORGANIZATION)
      const submission = await createInternalSubmissionDraft({
        ...actor,
        submissionId: requireFormId(getFormString(formData, "submissionId"), "Submission id"),
        templateId: requireFormId(getFormString(formData, "templateId"), "Template id"),
        title: getFormString(formData, "title"),
      })

      revalidatePath("/submissions")
      return { path: getSubmissionPath(submission.id) }
    },
  })
}

/**
 * Saves a namespaced answer patch using optimistic editable-state matching.
 *
 * @param formData - Submission identity, expected revision, and rendered fields.
 * @returns Never returns; redirects to the refreshed submission or an error.
 */
export async function saveSubmissionAction(formData: FormData): Promise<void> {
  await runSubmissionFormAction(formData, "changes_saved", (actor, submissionId) =>
    saveInternalSubmissionDraft({ ...actor, ...readAnswers(formData, submissionId) })
  )
}

/**
 * Validates all required scalar and file fields, then atomically submits work.
 *
 * @param formData - Submission identity, expected revision, and rendered fields.
 * @returns Never returns; redirects to the immutable detail or an error.
 */
export async function submitSubmissionAction(formData: FormData): Promise<void> {
  await runSubmissionFormAction(formData, "submission_submitted", (actor, submissionId) =>
    submitInternalSubmission({ ...actor, ...readAnswers(formData, submissionId) })
  )
}

/**
 * Names the reviewers of a submission and how many of them must approve. This
 * starts the review when it has not started.
 *
 * @param formData - Submission id, expected revision, the reviewers, and the approvals needed (blank for everyone).
 * @returns Never returns; redirects to the refreshed submission or an error.
 */
export async function setSubmissionReviewersAction(formData: FormData): Promise<void> {
  await runSubmissionFormAction(formData, "submission_assigned", (actor, submissionId) => {
    const needed = getFormString(formData, "requiredApprovals").trim()

    return setInternalSubmissionReviewers({
      ...actor,
      expectedRevision: parseExpectedRevision(getFormString(formData, "expectedRevision")),
      requiredApprovals: needed ? Number(needed) : null,
      reviewerIds: formData.getAll("reviewerIds").map((id) => String(id)),
      submissionId,
    })
  })
}

/**
 * Sets one reviewer's change request aside, with a note, and optionally
 * approves in the same step. Only the person who assigned the reviewers may.
 *
 * @param formData - Submission id, expected revision, the reviewer, the note, and `alsoApprove`.
 * @returns Never returns; redirects to the refreshed submission or an error.
 */
export async function dismissChangesRequestAction(formData: FormData): Promise<void> {
  await runSubmissionFormAction(formData, "submission_review_updated", (actor, submissionId) => {
    const comment = getFormString(formData, "comment").trim()

    if (!comment) {
      throw new ActionError("Add a note saying why the change request is set aside.")
    }

    return dismissSubmissionChangesRequest({
      ...actor,
      alsoApprove: getFormString(formData, "alsoApprove") === "yes",
      comment,
      expectedRevision: parseExpectedRevision(getFormString(formData, "expectedRevision")),
      reviewerUserId: requireFormId(getFormString(formData, "reviewerUserId"), "Reviewer"),
      submissionId,
    })
  })
}

/**
 * Sets who a submission is shared with beyond its reviewers. The database
 * decides whether this person may.
 *
 * @param formData - Submission id and everyone it should be shared with.
 * @returns Never returns; redirects to the refreshed submission or an error.
 */
export async function shareSubmissionAction(formData: FormData): Promise<void> {
  await runSubmissionFormAction(formData, "submission_shared", (actor, submissionId) =>
    shareInternalSubmission({ ...actor, submissionId, userIds: formData.getAll("sharedUserIds").map(String) })
  )
}

/**
 * Keeps a reviewer's suggested answers for the person who submitted it to accept.
 *
 * @param formData - Submission id and the form's answers.
 * @returns Never returns; redirects to the refreshed submission or an error.
 */
export async function suggestSubmissionChangesAction(formData: FormData): Promise<void> {
  await runSubmissionFormAction(formData, "changes_suggested", (actor, submissionId) =>
    suggestSubmissionAnswers({ ...actor, submissionId, values: parseGeneratedDocumentAnswers(formData) })
  )
}

/**
 * Accepts or declines one suggested answer.
 *
 * @param formData - Submission id, the suggestion, and `decision` of accept or decline.
 * @returns Never returns; redirects to the refreshed submission or an error.
 */
export async function decideSuggestionAction(formData: FormData): Promise<void> {
  const accept = getFormString(formData, "decision") === "accept"

  await runSubmissionFormAction(formData, accept ? "changes_saved" : "submission_review_updated", (actor, submissionId) =>
    decideSubmissionSuggestion({
      ...actor,
      accept,
      submissionId,
      suggestionId: requireFormId(getFormString(formData, "suggestionId"), "Suggestion"),
    })
  )
}

/**
 * Comments from the review form: the note written there becomes a comment,
 * and the reviewer's decision stays as it is.
 *
 * @param formData - Submission id and the review note.
 * @returns Never returns; redirects to the refreshed submission or an error.
 */
export async function commentFromReviewAction(formData: FormData): Promise<void> {
  formData.set("body", getFormString(formData, "comment"))
  await createSubmissionCommentAction(formData)
}

/**
 * Applies a binding manager review transition with optimistic revision matching.
 * The service asks for review permission where the decision needs it, and the
 * database checks the reviewer.
 *
 * @param formData - Submission id, expected revision, transition, and review note.
 * @returns Never returns; redirects to the refreshed submission or an error.
 */
export async function transitionSubmissionAction(
  formData: FormData
): Promise<void> {
  await runSubmissionFormAction(formData, "submission_review_updated", (actor, submissionId) => {
    const transition = parseReviewTransition(getFormString(formData, "targetStatus"))
    const comment = getFormString(formData, "comment").trim()

    if ((transition === "needs_changes" || transition === "rejected") && !comment) {
      throw new ActionError(
        transition === "needs_changes"
          ? "Add a note explaining the requested changes."
          : "Add a note explaining why the submission was rejected."
      )
    }

    if (comment.length > 2_000) {
      throw new ActionError("Review comments must be 2,000 characters or fewer.")
    }

    return transitionInternalSubmission({
      ...actor,
      submissionId,
      expectedRevision: parseExpectedRevision(getFormString(formData, "expectedRevision")),
      targetStatus: transition,
      comment: comment || undefined,
    })
  }, openNextInQueue)
}

// Once a decision takes the submission out of the queue, the reviewer moves on
// to the oldest one still waiting, as their queue lists it. One still waiting
// (an approval of several) or an empty queue keeps them where they were.
async function openNextInQueue(actor: ActionActor, result: unknown): Promise<{ code: ActionFeedbackCode; path: string } | undefined> {
  const decided = result as Submission | undefined

  if (!decided || decided.status === "submitted" || decided.status === "in_review") {
    return undefined
  }

  const submissionId = decided.id
  const { submissions } = await listSubmissionPage({
    ...actor,
    page: 1,
    pageSize: 2,
    sort: { direction: "asc", key: "updated" },
    statuses: ["submitted", "in_review"],
    withTotal: false,
  })
  const next = submissions.find((submission) => submission.id !== submissionId)

  return next ? { code: "submission_reviewed_next", path: getSubmissionPath(next.id) } : undefined
}

/**
 * Adds an immutable comment to a visible non-draft submission.
 *
 * @param formData - Submission id and comment body.
 * @returns Never returns; redirects to the refreshed submission or an error.
 */
export async function createSubmissionCommentAction(
  formData: FormData
): Promise<void> {
  await runSubmissionFormAction(formData, "comment_added", (actor, submissionId) => {
    const body = getFormString(formData, "body").trim()

    if (!body) {
      throw new ActionError("Comment is required.")
    }

    if (body.length > 2_000) {
      throw new ActionError("Comments must be 2,000 characters or fewer.")
    }

    return createInternalSubmissionComment({ ...actor, submissionId, body })
  })
}

// Runs one service call on the submission as the signed-in member, and
// redirects back to it with how it went.
async function runSubmissionFormAction(
  formData: FormData,
  feedback: ActionFeedbackCode,
  run: (actor: ActionActor, submissionId: string) => Promise<unknown>,
  // Where to go once it worked, when not back to the same submission.
  then?: (actor: ActionActor, result: unknown) => Promise<{ code: ActionFeedbackCode; path: string } | undefined>
): Promise<never> {
  const submissionId = getFormString(formData, "submissionId")
  const submissionPath = getSubmissionPath(submissionId)

  return runFormAction({
    event: `submission_${feedback}_action`,
    log: { submissionId },
    path: submissionPath,
    success: feedback,
    run: async () => {
      const { actor } = await loadActionContext(NO_ORGANIZATION)

      const result = await run(actor, requireFormId(submissionId, "Submission id"))
      revalidatePath("/submissions")
      revalidatePath(submissionPath)
      return then?.(actor, result)
    },
  })
}

function readAnswers(
  formData: FormData,
  submissionId: string
): { expectedRevision: number; submissionId: string; values: ReturnType<typeof parseGeneratedDocumentAnswers> } {
  return {
    submissionId,
    expectedRevision: parseExpectedRevision(getFormString(formData, "expectedRevision")),
    values: parseGeneratedDocumentAnswers(formData),
  }
}

function parseExpectedRevision(value: string): number {
  const revision = Number(value)

  if (!Number.isInteger(revision) || revision < 1) {
    throw new ActionError("Submission revision must be a positive integer.")
  }

  return revision
}

function parseReviewTransition(value: string): SubmissionReviewTransition {
  if (
    value === "needs_changes" ||
    value === "approved" ||
    value === "rejected" ||
    value === "completed"
  ) {
    return value
  }

  throw new ActionError("Choose a valid review action.")
}

function getSubmissionPath(submissionId: string): string {
  const identifier = submissionId.trim()
  return identifier
    ? `/submissions/${encodeURIComponent(identifier)}`
    : "/submissions"
}
