/** User-safe failure raised by immutable generated-document finalization. */
export class GeneratedDocumentFinalizationServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates a finalization failure safe to translate at an API boundary.
   *
   * @param message - Stable message that contains no document or provider data.
   * @param statusCode - HTTP-style status code for route translation.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "GeneratedDocumentFinalizationServiceError"
    this.statusCode = statusCode
  }
}
