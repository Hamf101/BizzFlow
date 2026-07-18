/**
 * Error type raised by document service operations.
 */
export class DocumentServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates a document service error with an HTTP-style status code.
   *
   * @param message - User-safe error message.
   * @param statusCode - HTTP-style status code for route/action translation.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "DocumentServiceError"
    this.statusCode = statusCode
  }
}
