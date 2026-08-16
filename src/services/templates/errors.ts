/** Error raised by template and generated-document domain operations. */
export class TemplateServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates an HTTP-translatable domain error.
   *
   * @param message - User-safe error message.
   * @param statusCode - HTTP-style status code for the calling route or action.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "TemplateServiceError"
    this.statusCode = statusCode
  }
}
