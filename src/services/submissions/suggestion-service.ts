import type {
  DecideSubmissionSuggestionInput,
  SubmissionServiceClient,
  SubmissionServiceDeps,
  SuggestSubmissionAnswersInput,
} from "@/services/submissions/contracts"
import { SubmissionServiceError } from "@/services/submissions/errors"
import {
  createSubmissionDatabaseError,
  createSubmissionMutationError,
  getSubmissionById,
  getSubmissionClient,
  mergeAndNormalizeSubmissionAnswers,
  requireSubmissionPermission,
  runSubmissionOperation,
} from "@/services/submissions/shared"
import { parseSubmissionRow, type Submission } from "@/types/submission"
import { parseSubmissionSuggestionRow, type SubmissionSuggestion } from "@/types/submission-review"

const SUGGESTION_COLUMNS =
  "id,field_key,previous_value,proposed_value,suggested_by,suggested_at,status,decided_by,decided_at"

// Typed answers only: drawings are the submitter's own mark, and files are uploads.
const SUGGESTABLE = new Set(["text_field", "date_field", "checkbox_field", "dropdown_field"])

/**
 * Keeps an owner's or manager's suggested answers on a submission they review.
 * Nothing changes until the person who submitted it accepts; only answers that
 * differ from what is there now are kept, one open suggestion per answer each.
 *
 * @param input - Actor, submission, and the form's untrusted answers.
 * @param deps - Optional trusted database and validation dependencies.
 * @returns How many answers were suggested.
 * @throws SubmissionServiceError when access, the answers, or persistence fails.
 */
export async function suggestSubmissionAnswers(
  input: SuggestSubmissionAnswersInput,
  deps: SubmissionServiceDeps = {}
): Promise<number> {
  return runSubmissionOperation(
    "suggest_submission_answers",
    { actorUserId: input.actorUserId, organizationId: input.organizationId, submissionId: input.submissionId },
    async (): Promise<number> => {
      const client = getSubmissionClient(deps)

      await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:review",
        "Only owners and managers reviewing it can suggest changes."
      )

      const submission = await getSubmissionById(client, input.organizationId, input.submissionId)
      const merged = await mergeAndNormalizeSubmissionAnswers(submission, input.values, deps)
      const changed = Object.fromEntries(
        suggestableKeys(submission)
          .filter((key) => key in merged && merged[key] !== submission.values[key])
          .map((key) => [key, merged[key]])
      )

      if (Object.keys(changed).length === 0) {
        throw new SubmissionServiceError("Change at least one answer to suggest it.", 400)
      }

      const { data, error } = await client.rpc("suggest_submission_answers", {
        target_actor_user_id: input.actorUserId,
        target_org_id: input.organizationId,
        target_submission_id: input.submissionId,
        target_values: changed,
      })

      if (error || typeof data !== "number") {
        throw createSubmissionMutationError(error, "Unable to keep the suggested changes.")
      }

      return data
    }
  )
}

/**
 * Accepts a suggested answer, which changes it, or declines it. Only the person
 * who submitted it may; the database holds that rule. Either way the
 * suggestion stays in the change trail.
 *
 * @param input - Actor, submission, the suggestion and the decision.
 * @param deps - Optional trusted database dependency.
 * @returns The submission, with its next revision when an answer changed.
 * @throws SubmissionServiceError when access or persistence fails.
 */
export async function decideSubmissionSuggestion(
  input: DecideSubmissionSuggestionInput,
  deps: SubmissionServiceDeps = {}
): Promise<Submission> {
  return runSubmissionOperation(
    "decide_submission_suggestion",
    {
      accept: input.accept,
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      submissionId: input.submissionId,
      suggestionId: input.suggestionId,
    },
    async (): Promise<Submission> => {
      const client = getSubmissionClient(deps)

      await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:edit",
        "You cannot change internal submissions."
      )

      const { data, error } = await client.rpc("decide_submission_suggestion", {
        target_accept: input.accept,
        target_actor_user_id: input.actorUserId,
        target_org_id: input.organizationId,
        target_submission_id: input.submissionId,
        target_suggestion_id: input.suggestionId,
      })

      if (error || !data) {
        throw createSubmissionMutationError(error, "Unable to decide on the suggestion.")
      }

      return parseSubmissionRow(data)
    }
  )
}

/**
 * Every suggested answer on a submission, oldest first.
 *
 * @param client - Trusted Supabase client.
 * @param submission - The submission, already known to be visible to the viewer.
 * @returns The change trail.
 * @throws SubmissionServiceError when the read fails.
 */
export async function listSubmissionSuggestions(
  client: SubmissionServiceClient,
  submission: Submission
): Promise<SubmissionSuggestion[]> {
  const { data, error } = await client
    .from("submission_answer_suggestions")
    .select(SUGGESTION_COLUMNS)
    .eq("org_id", submission.organizationId)
    .eq("submission_id", submission.id)
    .order("suggested_at", { ascending: true })

  if (error || !data) {
    throw createSubmissionDatabaseError(error, "Unable to load the suggested changes.")
  }

  return data.map(parseSubmissionSuggestionRow)
}

function suggestableKeys(submission: Submission): string[] {
  return submission.templateSnapshot.blocks.flatMap((block) =>
    SUGGESTABLE.has(block.type) && "fieldKey" in block ? [block.fieldKey] : []
  )
}
