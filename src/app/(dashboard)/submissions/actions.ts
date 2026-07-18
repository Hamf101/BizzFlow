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
  createInternalSubmissionDraft,
  saveInternalSubmissionDraft,
  SubmissionServiceError,
  submitInternalSubmission,
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
 * Saves a namespaced answer patch using optimistic draft revision matching.
 *
 * @param formData - Submission identity, expected revision, and rendered fields.
 * @returns Never returns; redirects to the refreshed draft or an error.
 */
export async function saveSubmissionAction(formData: FormData): Promise<void> {
  await mutateSubmissionFromForm(formData, "save")
}

/**
 * Validates all required scalar and file fields, then atomically submits a draft.
 *
 * @param formData - Submission identity, expected revision, and rendered fields.
 * @returns Never returns; redirects to the immutable detail or an error.
 */
export async function submitSubmissionAction(formData: FormData): Promise<void> {
  await mutateSubmissionFromForm(formData, "submit")
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
          ? "Unable to save submission draft."
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
          ? "Submission draft saved."
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
