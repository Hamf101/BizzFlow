import { ServiceError } from "@/services/service-error"

/** Error raised by internal-submission service operations. */
export class SubmissionServiceError extends ServiceError {
  override readonly name = "SubmissionServiceError"
}
