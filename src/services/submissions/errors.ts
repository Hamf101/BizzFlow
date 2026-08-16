/** Error raised by internal-submission service operations. */
export class SubmissionServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates an HTTP-translatable service error.
   *
   * @param message - User-safe rejection description.
   * @param statusCode - HTTP-style response status.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "SubmissionServiceError"
    this.statusCode = statusCode
  }
}
