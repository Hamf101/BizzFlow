"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  GeneratedDocumentFormDataError,
  parseGeneratedDocumentAnswers,
} from "@/components/documents/generated-document-form-data"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
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
  saveInternalSubmissionDraft,
  SubmissionServiceError,
  submitInternalSubmission,
  transitionInternalSubmission,
  type SubmissionReviewTransition,
} from "@/services/submission-service"
import type { OrganizationContext } from "@/types/organization"

type SubmissionActionContext = {
  actorUserId: string
  context: OrganizationContext
}

class SubmissionActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SubmissionActionError"
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
      fallback: "Unable to create submission draft.",
      nextPath: "/submissions/new",
      startedAt,
      submissionId,
    })
  }

  redirect(
    buildRedirect(getSubmissionPath(submissionId), {
      message: "Submission draft created.",
    })
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
      fallback: "Unable to assign this submission.",
      nextPath: submissionPath,
      startedAt,
      submissionId,
    })
  }

  redirect(
    buildRedirect(submissionPath, { message: "Submission assigned." })
  )
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
    const actionContext = await loadSubmissionActionContext(
      "submissions:review"
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
      fallback: "Unable to update this submission review.",
      nextPath: submissionPath,
      startedAt,
      submissionId,
    })
  }

  redirect(
    buildRedirect(submissionPath, {
      message: getTransitionSuccessMessage(transition),
    })
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
      fallback: "Unable to add this comment.",
      nextPath: submissionPath,
      startedAt,
      submissionId,
    })
  }

  redirect(buildRedirect(submissionPath, { message: "Comment added." }))
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
      fallback:
        operation === "save"
          ? "Unable to save this submission."
          : "Unable to submit this form.",
      nextPath: submissionPath,
      startedAt,
      submissionId,
    })
  }

  redirect(
    buildRedirect(submissionPath, {
      message:
        operation === "save"
          ? "Submission changes saved."
          : "Submission sent for review.",
    })
  )
}

async function loadSubmissionActionContext(
  permission: OrganizationPermissionAction
): Promise<SubmissionActionContext> {
  const user = await getAuthenticatedUser()
  const context = await getCurrentOrganizationContext(user.id)

  if (!context) {
    throw new SubmissionActionError(
      "Create an organization before managing submissions."
    )
  }

  if (!canPerformOrganizationAction(context.membership.role, permission)) {
    throw new SubmissionActionError(
      "You do not have permission to perform this submission action."
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

function getTransitionSuccessMessage(
  transition: SubmissionReviewTransition | null
): string {
  if (transition === "needs_changes") {
    return "Changes requested."
  }

  if (transition === "approved") {
    return "Submission approved."
  }

  if (transition === "rejected") {
    return "Submission rejected."
  }

  return "Submission marked complete."
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
  fallback: string
  nextPath: string
  startedAt: number
  submissionId: string
}): never {
  if (input.error instanceof AuthenticationError) {
    redirect(buildRedirect("/login", { next: input.nextPath }))
  }

  const message = getSubmissionActionErrorMessage(input.error, input.fallback)
  console.warn(input.eventName, {
    durationMs: Date.now() - input.startedAt,
    reason: message,
    submissionId: input.submissionId,
  })
  redirect(buildRedirect(input.nextPath, { error: message }))
}

function getSubmissionActionErrorMessage(
  error: unknown,
  fallback: string
): string {
  if (
    error instanceof SubmissionActionError ||
    error instanceof SubmissionServiceError ||
    error instanceof GeneratedDocumentFormDataError
  ) {
    return error.message
  }

  return fallback
}
