import type {
  CreateInternalSubmissionDraftInput,
  SaveInternalSubmissionDraftInput,
  SubmissionServiceDeps,
  SubmitInternalSubmissionInput,
} from "@/services/submissions/contracts"
import { SubmissionServiceError } from "@/services/submissions/errors"
import {
  assertEditableSubmissionDraft,
  createSubmissionDatabaseError,
  createSubmissionMutationError,
  getSubmissionById,
  getSubmissionClient,
  listSubmissionFiles,
  mergeAndNormalizeSubmissionAnswers,
  requireSubmissionPermission,
  runSubmissionOperation,
} from "@/services/submissions/shared"
import {
  validateSubmissionForSubmit as defaultValidateSubmissionForSubmit,
} from "@/services/submissions/validation"
import {
  parseSubmissionRow,
  type Submission,
} from "@/types/submission"
import { parseTemplateContent } from "@/types/template"

/**
 * Starts an internal draft from the exact current published template revision.
 *
 * @param input - Actor, tenant, template, and submission title.
 * @param deps - Optional trusted database and identifier dependencies.
 * @returns Created draft with its immutable template snapshot.
 * @throws SubmissionServiceError when access, validation, or persistence fails.
 */
export async function createInternalSubmissionDraft(
  input: CreateInternalSubmissionDraftInput,
  deps: SubmissionServiceDeps = {}
): Promise<Submission> {
  return runSubmissionOperation(
    "create_internal_submission_draft",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      templateId: input.templateId,
    },
    async (): Promise<Submission> => {
      const client = getSubmissionClient(deps)

      await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:create",
        "You cannot create internal submissions."
      )

      const title = normalizeSubmissionTitle(input.title)
      const { data: template, error: templateError } = await client
        .from("document_templates")
        .select("content")
        .eq("org_id", input.organizationId)
        .eq("id", input.templateId)
        .eq("status", "published")
        .maybeSingle()

      if (templateError) {
        throw createSubmissionDatabaseError(
          templateError,
          "Unable to load the submission template."
        )
      }

      if (!template) {
        throw new SubmissionServiceError(
          "Published submission template was not found.",
          404
        )
      }

      // Fail before mutation when a published snapshot cannot be rendered safely.
      parseTemplateContent(template.content)

      const submissionId = normalizeSubmissionId(input.submissionId)
      const { data, error } = await client.rpc(
        "create_internal_submission_draft",
        {
          target_org_id: input.organizationId,
          target_template_id: input.templateId,
          target_submission_id: submissionId,
          target_title: title,
          target_actor_user_id: input.actorUserId,
        }
      )

      if (error || !data) {
        throw createSubmissionMutationError(
          error,
          "Unable to create submission draft."
        )
      }

      return parseSubmissionRow(data)
    }
  )
}

/**
 * Saves a form patch as a full normalized draft answer object.
 *
 * Existing values are retained for omitted controls, including optional drawing
 * fields, while optimistic revision matching prevents stale overwrites.
 *
 * @param input - Actor, draft, revision, and untrusted form patch.
 * @param deps - Optional trusted database and validation dependencies.
 * @returns Updated draft with its next revision.
 * @throws SubmissionServiceError when ownership, revision, or validation fails.
 */
export async function saveInternalSubmissionDraft(
  input: SaveInternalSubmissionDraftInput,
  deps: SubmissionServiceDeps = {}
): Promise<Submission> {
  return runSubmissionOperation(
    "save_internal_submission_draft",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      submissionId: input.submissionId,
      expectedRevision: input.expectedRevision,
    },
    async (): Promise<Submission> => {
      const client = getSubmissionClient(deps)

      await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:edit",
        "You cannot edit internal submissions."
      )
      const submission = await getSubmissionById(
        client,
        input.organizationId,
        input.submissionId
      )
      assertEditableSubmissionDraft(
        submission,
        input.actorUserId,
        input.expectedRevision
      )
      const normalizedValues = await mergeAndNormalizeSubmissionAnswers(
        submission,
        input.values,
        deps
      )
      const { data, error } = await client.rpc(
        "save_internal_submission_draft",
        {
          target_org_id: input.organizationId,
          target_submission_id: input.submissionId,
          target_expected_revision: input.expectedRevision,
          target_values: normalizedValues,
          target_actor_user_id: input.actorUserId,
        }
      )

      if (error || !data) {
        throw createSubmissionMutationError(
          error,
          "Unable to save submission draft."
        )
      }

      return parseSubmissionRow(data)
    }
  )
}

/**
 * Validates every required snapshot field and atomically submits a draft.
 *
 * @param input - Actor, draft, revision, and latest untrusted form patch.
 * @param deps - Optional trusted database and validation dependencies.
 * @returns Submitted immutable record; an exact retry returns the same record.
 * @throws SubmissionServiceError when ownership, completeness, or persistence fails.
 */
export async function submitInternalSubmission(
  input: SubmitInternalSubmissionInput,
  deps: SubmissionServiceDeps = {}
): Promise<Submission> {
  return runSubmissionOperation(
    "submit_internal_submission",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      submissionId: input.submissionId,
      expectedRevision: input.expectedRevision,
    },
    async (): Promise<Submission> => {
      const client = getSubmissionClient(deps)

      await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:edit",
        "You cannot submit internal submissions."
      )
      const submission = await getSubmissionById(
        client,
        input.organizationId,
        input.submissionId
      )

      if (submission.createdBy !== input.actorUserId) {
        throw new SubmissionServiceError(
          "Only the submission creator may submit this draft.",
          403
        )
      }

      if (submission.status === "draft") {
        assertEditableSubmissionDraft(
          submission,
          input.actorUserId,
          input.expectedRevision
        )
      }

      const normalizedValues = await mergeAndNormalizeSubmissionAnswers(
        submission,
        input.values,
        deps
      )
      const files = await listSubmissionFiles(
        client,
        input.organizationId,
        input.submissionId
      )

      if (files.some((file): boolean => file.status === "upload_pending")) {
        throw new SubmissionServiceError(
          "Wait for pending file uploads before submitting.",
          409
        )
      }

      const availableFileFieldKeys = new Set(
        files
          .filter((file): boolean => file.status === "available")
          .map((file): string => file.fieldKey)
      )
      const validateForSubmit =
        deps.validateSubmissionForSubmit ??
        defaultValidateSubmissionForSubmit
      const completeValues = await validateForSubmit(
        submission.templateSnapshot,
        normalizedValues,
        availableFileFieldKeys
      )
      const { data, error } = await client.rpc(
        "submit_internal_submission",
        {
          target_org_id: input.organizationId,
          target_submission_id: input.submissionId,
          target_expected_revision: input.expectedRevision,
          target_values: completeValues,
          target_actor_user_id: input.actorUserId,
        }
      )

      if (error || !data) {
        throw createSubmissionMutationError(
          error,
          "Unable to submit internal submission."
        )
      }

      return parseSubmissionRow(data)
    }
  )
}

function normalizeSubmissionTitle(title: string): string {
  const normalizedTitle = title.trim().replace(/\s+/g, " ")

  if (normalizedTitle.length < 1 || normalizedTitle.length > 180) {
    throw new SubmissionServiceError(
      "Submission title must be between 1 and 180 characters.",
      400
    )
  }

  return normalizedTitle
}

function normalizeSubmissionId(submissionId: string): string {
  const normalizedSubmissionId = submissionId.trim().toLowerCase()

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      normalizedSubmissionId
    )
  ) {
    throw new SubmissionServiceError("Submission id must be a valid UUID.", 400)
  }

  return normalizedSubmissionId
}
