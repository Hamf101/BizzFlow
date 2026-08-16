/** Error raised when a generated document cannot be rendered as a PDF. */
export class DocumentPdfServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates a user-safe PDF rendering error.
   *
   * @param message - Safe rendering failure message.
   * @param statusCode - HTTP-style status code for route translation.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "DocumentPdfServiceError"
    this.statusCode = statusCode
  }
}
