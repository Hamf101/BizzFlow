import type { AdminSupabaseClient } from "@/lib/supabase/admin"
import type {
  createSafeSubmissionFilename,
  createSignedSubmissionDownloadUrl,
  createSignedSubmissionUploadUrl,
  deleteSubmissionStorageObject,
  normalizeSubmissionOriginalFilename,
  validateSubmissionUploadRequest,
  verifySubmissionUpload,
} from "@/services/submission-storage-service"
import type {
  normalizeSubmissionDraftAnswers,
  validateSubmissionForSubmit,
} from "@/services/submissions/validation"
import type {
  Submission,
  SubmissionAnswers,
  SubmissionFile,
} from "@/types/submission"
import type {
  SubmissionActivityEvent,
  SubmissionComment,
  SubmissionReviewTransition,
} from "@/types/submission-review"

/** Narrow trusted Supabase client used by submission services. */
export type SubmissionServiceClient = Pick<
  AdminSupabaseClient,
  "from" | "rpc"
>

/** Submission with its single-file field allocations. */
export type SubmissionDetail = {
  submission: Submission
  files: SubmissionFile[]
  comments: SubmissionComment[]
  activity: SubmissionActivityEvent[]
}

/** Actor and tenant identifiers shared by submission calls. */
export type SubmissionActorInput = {
  actorUserId: string
  organizationId: string
}

/** Input for listing submissions visible to one actor. */
export type ListInternalSubmissionsInput = SubmissionActorInput

/** Input for loading one visible submission. */
export type GetInternalSubmissionInput = SubmissionActorInput & {
  submissionId: string
}

/** Input for starting a draft from a published template. */
export type CreateInternalSubmissionDraftInput = SubmissionActorInput & {
  submissionId: string
  templateId: string
  title: string
}

/** Input for saving a form patch into an existing draft. */
export type SaveInternalSubmissionDraftInput = GetInternalSubmissionInput & {
  expectedRevision: number
  values: unknown
}

/** Input for submitting the latest form patch. */
export type SubmitInternalSubmissionInput = GetInternalSubmissionInput & {
  expectedRevision: number
  values: unknown
}

/** Input for assigning or reassigning a submission review. */
export type AssignInternalSubmissionInput = GetInternalSubmissionInput & {
  expectedRevision: number
  assignedTo: string
}

/** Input for one binding submission review state change. */
export type TransitionInternalSubmissionInput =
  GetInternalSubmissionInput & {
    expectedRevision: number
    targetStatus: SubmissionReviewTransition
    comment?: string | null
  }

/** Input for an immutable general submission comment. */
export type CreateInternalSubmissionCommentInput =
  GetInternalSubmissionInput & {
    body: string
  }

/** Input for allocating or resuming a single-file template field. */
export type AllocateInternalSubmissionFileInput = GetInternalSubmissionInput & {
  expectedRevision: number
  fieldKey: string
  originalFilename: string
  contentType: string
  byteSize: number
  checksumSha256: string
}

/** Signed upload details for one persisted file allocation. */
export type AllocateInternalSubmissionFileResponse = {
  file: SubmissionFile
  uploadUrl: string
  expiresInSeconds: number
}

/** Input for byte-verifying and completing a file allocation. */
export type CompleteInternalSubmissionFileInput = GetInternalSubmissionInput & {
  fileId: string
}

/** Completed available file returned after provider verification. */
export type CompleteInternalSubmissionFileResponse = {
  file: SubmissionFile
}

/** Input for superseding a pending or available file in an editable draft. */
export type SupersedeInternalSubmissionFileInput =
  GetInternalSubmissionInput & {
    fileId: string
  }

/** Tombstone identity retained for recoverable cloud-object cleanup. */
export type SupersedeInternalSubmissionFileResponse = {
  fileId: string
  storageKey: string
}

/** Input for downloading an available submission file. */
export type CreateInternalSubmissionFileDownloadUrlInput =
  GetInternalSubmissionInput & {
    fileId: string
  }

/** Signed private download details for one available file. */
export type CreateInternalSubmissionFileDownloadUrlResponse = {
  downloadUrl: string
  expiresInSeconds: number
}

/** Optional dependencies accepted by submission services and focused tests. */
export type SubmissionServiceDeps = {
  client?: SubmissionServiceClient
  createId?: () => string
  now?: () => Date
  normalizeSubmissionDraftAnswers?: typeof normalizeSubmissionDraftAnswers
  validateSubmissionForSubmit?: typeof validateSubmissionForSubmit
  normalizeSubmissionOriginalFilename?: typeof normalizeSubmissionOriginalFilename
  createSafeSubmissionFilename?: typeof createSafeSubmissionFilename
  validateSubmissionUploadRequest?: typeof validateSubmissionUploadRequest
  createSignedSubmissionUploadUrl?: typeof createSignedSubmissionUploadUrl
  verifySubmissionUpload?: typeof verifySubmissionUpload
  deleteSubmissionStorageObject?: typeof deleteSubmissionStorageObject
  createSignedSubmissionDownloadUrl?: typeof createSignedSubmissionDownloadUrl
}

/** Full normalized values sent to mutation RPCs. */
export type NormalizedSubmissionMutation = {
  submission: Submission
  values: SubmissionAnswers
}

/** Scalar values permitted in operation logs. */
export type SubmissionLogValue =
  | string
  | number
  | boolean
  | null
  | undefined
