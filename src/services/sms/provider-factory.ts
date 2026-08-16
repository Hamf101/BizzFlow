import { getSmsEnv } from "@/lib/env"
import type { SmsProvider } from "@/services/sms/contracts"
import { MockSmsProvider } from "@/services/sms/mock-provider"
import { TermiiSmsProvider } from "@/services/sms/termii-provider"

export type SmsFactoryDeps = {
  smsProvider?: SmsProvider
  fetchImpl?: typeof fetch
}

let singletonMockProvider: MockSmsProvider | null = null

/**
 * Returns the active SMS infrastructure provider based on environment and overrides.
 *
 * @param deps - Optional provider override or custom fetch implementation.
 * @returns Active SmsProvider instance.
 */
export function getSmsProvider(deps: SmsFactoryDeps = {}): SmsProvider {
  if (deps.smsProvider) {
    return deps.smsProvider
  }

  const env = getSmsEnv()

  if (env.SMS_PROVIDER === "termii" && env.TERMII_API_KEY) {
    return new TermiiSmsProvider(env, { fetchImpl: deps.fetchImpl })
  }

  if (!singletonMockProvider) {
    singletonMockProvider = new MockSmsProvider()
  }

  return singletonMockProvider
}

/**
 * Resets the singleton mock provider (used between tests).
 */
export function resetSmsProviderState(): void {
  singletonMockProvider = null
}
