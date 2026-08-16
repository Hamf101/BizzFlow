import type { SendSmsInput, SendSmsResult } from "@/services/sms/contracts"
import { getSmsProvider, type SmsFactoryDeps } from "@/services/sms/provider-factory"

export type {
  SendSmsInput,
  SendSmsResult,
  SmsProvider,
} from "@/services/sms/contracts"
export type { SmsFactoryDeps } from "@/services/sms/provider-factory"

/**
 * High-level helper function to dispatch an SMS message using the active provider.
 *
 * @param input - Recipient phone number, message text, and delivery reference.
 * @param deps - Optional provider override or custom fetch implementation.
 * @returns Delivery result status.
 */
export async function sendSms(
  input: SendSmsInput,
  deps: SmsFactoryDeps = {}
): Promise<SendSmsResult> {
  const provider = getSmsProvider(deps)
  return provider.sendSms(input)
}
