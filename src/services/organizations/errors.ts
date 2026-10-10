import { ServiceError } from "@/services/service-error"

/**
 * Error type raised by organization service operations.
 */
export class OrganizationServiceError extends ServiceError {
  override readonly name = "OrganizationServiceError"
}
