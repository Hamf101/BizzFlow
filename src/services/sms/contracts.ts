/** Payload passed when sending one SMS message. */
export type SendSmsInput = {
  /** Recipient phone number in E.164 format (e.g. +14155552671). */
  recipientPhone: string
  /** Text content of the SMS message. */
  message: string
  /** Unique reference for delivery tracking and idempotency. */
  reference: string
}

/** Result returned by an SMS provider dispatch attempt. */
export type SendSmsResult = {
  /** Whether the message was accepted by the provider. */
  success: boolean
  /** Provider message ID if successfully accepted. */
  messageId?: string
  /** Error message if delivery failed. */
  error?: string
}

/** Port contract that all SMS infrastructure providers implement. */
export type SmsProvider = {
  /**
   * Sends one SMS message via the underlying provider.
   *
   * @param input - Recipient phone number, message text, and reference.
   * @returns Success status, message ID, or error message.
   */
  sendSms(input: SendSmsInput): Promise<SendSmsResult>
}
