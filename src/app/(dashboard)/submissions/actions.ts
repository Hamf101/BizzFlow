"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  GeneratedDocumentFormDataError,
  parseGeneratedDocumentAnswers,
} from "@/components/documents/generated-document-form-data"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import {
  buildFeedbackRedirect,
  getActionErrorFeedbackCode,
  type ActionFeedbackCode,
} from "@/lib/action-result"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import {
  canPerformOrganizationAction,
  type OrganizationPermissionAction,
} from "@/lib/permissions"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  assignInternalSubmission,
  createInternalSubmissionComment,
  createInternalSubmissionDraft,
  decideSubmissionSuggestion,
  dismissSubmissionChangesRequest,
  saveInternalSubmissionDraft,
  setInternalSubmissionReviewers,
  shareInternalSubmission,
  submitInternalSubmission,
  suggestSubmissionAnswers,
  transitionInternalSubmission,
  type SubmissionReviewTransition,
} from "@/services/submission-service"
import type { OrganizationContext } from "@/types/organization"

type SubmissionActionContext = {
  actorUserId: string
  context: OrganizationContext
}

class SubmissionActionError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = "SubmissionActionError"
    this.statusCode = statusCode
  }
}

/**
 * Starts an internal submission draft from an immutable published template.
 *
 * @param formData - Template identifier and user-facing submission title.
 * @returns Never returns; redirects to the draft or a user-safe error.
 */
export async function createSubmissionAction(formData: FormData): Promise<void> {
  const startedAt = Date.now()
  let submissionId = ""

  try {
    const actionContext = await loadSubmissionActionContext(
      "submissions:create"
    )
    const submission = await createInternalSubmissionDraft({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      submissionId: requireIdentifier(
        getFormString(formData, "submissionId"),
        "Submission id"
      ),
      templateId: requireIdentifier(
        getFormString(formData, "templateId"),
        "Template id"
      ),
      title: getFormString(formData, "title"),
    })
    submissionId = submission.id
    revalidatePath("/submissions")
    console.info("submission_create_action_completed", {
      durationMs: Date.now() - startedAt,
      organizationId: actionContext.context.organization.id,
      submissionId,
    })
  } catch (error: unknown) {
    handleSubmissionActionFailure({
      error,
      eventName: "submission_create_action_failed",
      nextPath: "/submissions/new",
      startedAt,
      submissionId,
    })
  }

  redirect(
    buildFeedbackRedirect(getSubmissionPath(submissionId), "submission_created")
  )
}

/**
 * Saves a namespaced answer patch using optimistic editable-state matching.
 *
 * @param formData - Submission identity, expected revision, and rendered fields.
 * @returns Never returns; redirects to the refreshed submission or an error.
 */
export async function saveSubmissionAction(formData: FormData): Promise<void> {
  await mutateSubmissionFromForm(formData, "save")
}

/**
 * Validates all required scalar and file fields, then atomically submits work.
 *
 * @param formData - Submission identity, expected revision, and rendered fields.
 * @returns Never returns; redirects to the immutable detail or an error.
 */
export async function submitSubmissionAction(formData: FormData): Promise<void> {
  await mutateSubmissionFromForm(formData, "submit")
}

/**
 * Assigns an eligible organization member to a submission review.
 *
 * @param formData - Submission id, expected revision, and assignee user id.
 * @returns Never returns; redirects to the refreshed submission or an error.
 */
export async function assignSubmissionAction(formData: FormData): Promise<void> {
  const submissionId = getFormString(formData, "submissionId")
  const submissionPath = getSubmissionPath(submissionId)
  const startedAt = Date.now()

  try {
    const actionContext = await loadSubmissionActionContext(
      "submissions:assign"
    )
    const assignedTo = requireIdentifier(
      getFormString(formData, "assignedTo"),
      "Assignee"
    )
    await assignInternalSubmission({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      submissionId: requireIdentifier(submissionId, "Submission id"),
      expectedRevision: parseExpectedRevision(
        getFormString(formData, "expectedRevision")
      ),
      assignedTo,
    })

    revalidateSubmissionPaths(submissionId)
    console.info("submission_assign_action_completed", {
      assignedTo,
      durationMs: Date.now() - startedAt,
      organizationId: actionContext.context.organization.id,
      submissionId,
    })
  } catch (error: unknown) {
    handleSubmissionActionFailure({
      error,
      eventName: "submission_assign_action_failed",
      nextPath: submissionPath,
      startedAt,
      submissionId,
    })
  }

  redirect(buildFeedbackRedirect(submissionPath, "submission_assigned"))
}

/**
 * Names the reviewers of a submission and how many of them must approve. This
 * starts the review when it has not started.
 *
 * @param formData - Submission id, expected revision, the reviewers, and the approvals needed (blank for everyone).
 * @returns Never returns; redirects to the refreshed submission or an error.
 */
export async function setSubmissionReviewersAction(formData: FormData): Promise<void> {
  const submissionId = getFormString(formData, "submissionId")
  const submissionPath = getSubmissionPath(submissionId)
  const startedAt = Date.now()

  try {
    const actionContext = await loadSubmissionActionContext("submissions:assign")
    const needed = getFormString(formData, "requiredApprovals").trim()

    await setInternalSubmissionReviewers({
      actorUserId: actionContext.actorUserId,
      expectedRevision: parseExpectedRevision(getFormString(formData, "expectedRevision")),
      organizationId: actionContext.context.organization.id,
      requiredApprovals: needed ? Number(needed) : null,
      reviewerIds: formData.getAll("reviewerIds").map((id) => String(id)),
      submissionId: requireIdentifier(submissionId, "Submission id"),
    })

    revalidateSubmissionPaths(submissionId)
  } catch (error: unknown) {
    handleSubmissionActionFailure({
      error,
      eventName: "submission_reviewers_action_failed",
      nextPath: submissionPath,
      startedAt,
      submissionId,
    })
  }

  redirect(buildFeedbackRedirect(submissionPath, "submission_assigned"))
}

/**
 * Sets one reviewer's change request aside, with a note, and optionally
 * approves in the same step. Only the person who assigned the reviewers may.
 *
 * @param formData - Submission id, expected revision, the reviewer, the note, and `alsoApprove`.
 * @returns Never returns; redirects to the refreshed submission or an error.
 */
export async function dismissChangesRequestAction(formData: FormData): Promise<void> {
  const submissionId = getFormString(formData, "submissionId")
  const submissionPath = getSubmissionPath(submissionId)
  const startedAt = Date.now()

  try {
    const actionContext = await loadSubmissionActionContext("submissions:review")
    const comment = getFormString(formData, "comment").trim()

    if (!comment) {
      throw new SubmissionActionError("Add a note saying why the change request is set aside.")
    }

    await dismissSubmissionChangesRequest({
      actorUserId: actionContext.actorUserId,
      alsoApprove: getFormString(formData, "alsoApprove") === "yes",
      comment,
      expectedRevision: parseExpectedRevision(getFormString(formData, "expectedRevision")),
      organizationId: actionContext.context.organization.id,
      reviewerUserId: requireIdentifier(getFormString(formData, "reviewerUserId"), "Reviewer"),
      submissionId: requireIdentifier(submissionId, "Submission id"),
    })

    revalidateSubmissionPaths(submissionId)
  } catch (error: unknown) {
    handleSubmissionActionFailure({
      error,
      eventName: "submission_dismiss_action_failed",
      nextPath: submissionPath,
      startedAt,
      submissionId,
    })
  }

  redirect(buildFeedbackRedirect(submissionPath, "submission_review_updated"))
}

/**
 * Sets who a submission is shared with beyond its reviewers. The database
 * decides whether this person may.
 *
 * @param formData - Submission id and everyone it should be shared with.
 * @returns Never returns; redirects to the refreshed submission or an error.
 */
export async function shareSubmissionAction(formData: FormData): Promise<void> {
  await runSubmissionFormAction(formData, "submissions:view", "submission_shared", (actor, submissionId) =>
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
  await runSubmissionFormAction(formData, "submissions:review", "changes_suggested", (actor, submissionId) =>
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

  await runSubmissionFormAction(formData, "submissions:edit", accept ? "changes_saved" : "submission_review_updated", (actor, submissionId) =>
    decideSubmissionSuggestion({
      ...actor,
      accept,
      submissionId,
      suggestionId: requireIdentifier(getFormString(formData, "suggestionId"), "Suggestion"),
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
 *
 * @param formData - Submission id, expected revision, transition, and review note.
 * @returns Never returns; redirects to the refreshed submission or an error.
 */
export async function transitionSubmissionAction(
  formData: FormData
): Promise<void> {
  const submissionId = getFormString(formData, "submissionId")
  const submissionPath = getSubmissionPath(submissionId)
  const startedAt = Date.now()
  let transition: SubmissionReviewTransition | null = null

  try {
    // Whoever can see submissions gets this far; the service asks for review
    // permission where the decision needs it, and the database checks the reviewer.
    const actionContext = await loadSubmissionActionContext(
      "submissions:view"
    )
    transition = parseReviewTransition(getFormString(formData, "targetStatus"))
    const comment = getFormString(formData, "comment").trim()

    if (
      (transition === "needs_changes" || transition === "rejected") &&
      !comment
    ) {
      throw new SubmissionActionError(
        transition === "needs_changes"
          ? "Add a note explaining the requested changes."
          : "Add a note explaining why the submission was rejected."
      )
    }

    if (comment.length > 2_000) {
      throw new SubmissionActionError(
        "Review comments must be 2,000 characters or fewer."
      )
    }

    await transitionInternalSubmission({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      submissionId: requireIdentifier(submissionId, "Submission id"),
      expectedRevision: parseExpectedRevision(
        getFormString(formData, "expectedRevision")
      ),
      targetStatus: transition,
      comment: comment || undefined,
    })

    revalidateSubmissionPaths(submissionId)
    console.info("submission_transition_action_completed", {
      durationMs: Date.now() - startedAt,
      organizationId: actionContext.context.organization.id,
      submissionId,
      transition,
    })
  } catch (error: unknown) {
    handleSubmissionActionFailure({
      error,
      eventName: "submission_transition_action_failed",
      nextPath: submissionPath,
      startedAt,
      submissionId,
    })
  }

  redirect(
    buildFeedbackRedirect(submissionPath, "submission_review_updated")
  )
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
  const submissionId = getFormString(formData, "submissionId")
  const submissionPath = getSubmissionPath(submissionId)
  const startedAt = Date.now()

  try {
    const actionContext = await loadSubmissionActionContext(
      "submission_comments:create"
    )
    const body = getFormString(formData, "body").trim()

    if (!body) {
      throw new SubmissionActionError("Comment is required.")
    }

    if (body.length > 2_000) {
      throw new SubmissionActionError(
        "Comments must be 2,000 characters or fewer."
      )
    }

    await createInternalSubmissionComment({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      submissionId: requireIdentifier(submissionId, "Submission id"),
      body,
    })

    revalidateSubmissionPaths(submissionId)
    console.info("submission_comment_action_completed", {
      durationMs: Date.now() - startedAt,
      organizationId: actionContext.context.organization.id,
      submissionId,
    })
  } catch (error: unknown) {
    handleSubmissionActionFailure({
      error,
      eventName: "submission_comment_action_failed",
      nextPath: submissionPath,
      startedAt,
      submissionId,
    })
  }

  redirect(buildFeedbackRedirect(submissionPath, "comment_added"))
}

async function mutateSubmissionFromForm(
  formData: FormData,
  operation: "save" | "submit"
): Promise<never> {
  const submissionId = getFormString(formData, "submissionId")
  const submissionPath = getSubmissionPath(submissionId)
  const startedAt = Date.now()

  try {
    const actionContext = await loadSubmissionActionContext("submissions:edit")
    const input = {
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      submissionId: requireIdentifier(submissionId, "Submission id"),
      expectedRevision: parseExpectedRevision(
        getFormString(formData, "expectedRevision")
      ),
      values: parseGeneratedDocumentAnswers(formData),
    }

    if (operation === "save") {
      await saveInternalSubmissionDraft(input)
    } else {
      await submitInternalSubmission(input)
    }

    revalidateSubmissionPaths(submissionId)
    console.info(`submission_${operation}_action_completed`, {
      durationMs: Date.now() - startedAt,
      organizationId: actionContext.context.organization.id,
      submissionId,
    })
  } catch (error: unknown) {
    handleSubmissionActionFailure({
      error,
      eventName: `submission_${operation}_action_failed`,
      nextPath: submissionPath,
      startedAt,
      submissionId,
    })
  }

  redirect(
    buildFeedbackRedirect(
      submissionPath,
      operation === "save" ? "changes_saved" : "submission_submitted"
    )
  )
}

// Parses the submission, runs one service call as the signed-in member, and
// redirects back with how it went.
async function runSubmissionFormAction(
  formData: FormData,
  permission: OrganizationPermissionAction,
  feedback: ActionFeedbackCode,
  run: (actor: { actorUserId: string; organizationId: string }, submissionId: string) => Promise<unknown>
): Promise<never> {
  const submissionId = getFormString(formData, "submissionId")
  const submissionPath = getSubmissionPath(submissionId)
  const startedAt = Date.now()

  try {
    const { actorUserId, context } = await loadSubmissionActionContext(permission)

    await run({ actorUserId, organizationId: context.organization.id }, requireIdentifier(submissionId, "Submission id"))
    revalidateSubmissionPaths(submissionId)
  } catch (error: unknown) {
    handleSubmissionActionFailure({ error, eventName: `submission_${feedback}_action_failed`, nextPath: submissionPath, startedAt, submissionId })
  }

  redirect(buildFeedbackRedirect(submissionPath, feedback))
}

async function loadSubmissionActionContext(
  permission: OrganizationPermissionAction
): Promise<SubmissionActionContext> {
  const user = await getAuthenticatedUser()
  const context = await getCurrentOrganizationContext(user.id)

  if (!context) {
    throw new SubmissionActionError(
      "Create an organization before managing submissions.",
      428
    )
  }

  if (!canPerformOrganizationAction(context.membership, permission)) {
    throw new SubmissionActionError(
      "You do not have permission to perform this submission action.",
      403
    )
  }

  return { actorUserId: user.id, context }
}

function parseExpectedRevision(value: string): number {
  const revision = Number(value)

  if (!Number.isInteger(revision) || revision < 1) {
    throw new SubmissionActionError(
      "Submission revision must be a positive integer."
    )
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

  throw new SubmissionActionError("Choose a valid review action.")
}

function requireIdentifier(value: string, label: string): string {
  const identifier = value.trim()

  if (!identifier) {
    throw new SubmissionActionError(`${label} is required.`)
  }

  return identifier
}

function getSubmissionPath(submissionId: string): string {
  const identifier = submissionId.trim()
  return identifier
    ? `/submissions/${encodeURIComponent(identifier)}`
    : "/submissions"
}

function revalidateSubmissionPaths(submissionId: string): void {
  revalidatePath("/submissions")
  revalidatePath(getSubmissionPath(submissionId))
}

function handleSubmissionActionFailure(input: {
  error: unknown
  eventName: string
  nextPath: string
  startedAt: number
  submissionId: string
}): never {
  if (input.error instanceof AuthenticationError) {
    redirect(buildRedirect("/login", { next: input.nextPath }))
  }

  const reason =
    input.error instanceof Error
      ? input.error.message
      : "Unknown submission action error"
  console.warn(input.eventName, {
    durationMs: Date.now() - input.startedAt,
    reason,
    submissionId: input.submissionId,
  })
  redirect(
    buildFeedbackRedirect(
      input.nextPath,
      input.error instanceof GeneratedDocumentFormDataError
        ? "invalid_input"
        : getActionErrorFeedbackCode(input.error)
    )
  )
}
