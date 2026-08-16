/**
 * Error type raised by organization service operations.
 */
export class OrganizationServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates a service error with an HTTP-style status code.
   *
   * @param message - User-safe error message.
   * @param statusCode - HTTP-style status code for route/action translation.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "OrganizationServiceError"
    this.statusCode = statusCode
  }
}
