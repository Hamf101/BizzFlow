import { ServiceError } from "@/services/service-error"

/**
 * Error type raised by document service operations.
 */
export class DocumentServiceError extends ServiceError {
  override readonly name = "DocumentServiceError"
}
