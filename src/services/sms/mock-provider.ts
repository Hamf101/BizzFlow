import type {
  SendSmsInput,
  SendSmsResult,
  SmsProvider,
} from "@/services/sms/contracts"

/**
 * In-memory Mock SMS Provider for local development and unit tests.
 */
export class MockSmsProvider implements SmsProvider {
  readonly sentMessages: SendSmsInput[] = []
  private shouldFail = false
  private failureReason = "Mock SMS delivery failure."

  /**
   * Configures mock provider to fail subsequent calls (used in tests).
   */
  setFailureMode(fail: boolean, reason = "Mock SMS delivery failure."): void {
    this.shouldFail = fail
    this.failureReason = reason
  }

  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    if (this.shouldFail) {
      console.warn("mock_sms_failed", { reference: input.reference, recipientPhone: input.recipientPhone })
      return {
        success: false,
        error: this.failureReason,
      }
    }

    this.sentMessages.push(input)
    const messageId = `mock-msg-${this.sentMessages.length}`

    console.info("mock_sms_sent", {
      reference: input.reference,
      recipientPhone: input.recipientPhone,
      messageId,
      textLength: input.message.length,
    })

    return {
      success: true,
      messageId,
    }
  }
}
