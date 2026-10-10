import { getSmsEnv, isProductionRuntime } from "@/lib/env"
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
 * @throws Error when termii has no key, or the mock is selected in production.
 */
export function getSmsProvider(deps: SmsFactoryDeps = {}): SmsProvider {
  if (deps.smsProvider) {
    return deps.smsProvider
  }

  const env = getSmsEnv()

  if (env.SMS_PROVIDER === "termii") {
    if (!env.TERMII_API_KEY) {
      return refuse("SMS_PROVIDER=termii requires TERMII_API_KEY.")
    }

    return new TermiiSmsProvider(env, { fetchImpl: deps.fetchImpl })
  }

  // The mock reports every message as sent, so in production it would hide
  // that no SMS ever leaves the server.
  if (isProductionRuntime()) {
    return refuse("The mock SMS provider cannot run in production. Set SMS_PROVIDER=termii.")
  }

  if (!singletonMockProvider) {
    singletonMockProvider = new MockSmsProvider()
  }

  return singletonMockProvider
}

function refuse(reason: string): never {
  console.error("sms_provider_misconfigured", { reason })
  throw new Error(`Invalid SMS environment: ${reason}`)
}

/**
 * Resets the singleton mock provider (used between tests).
 */
export function resetSmsProviderState(): void {
  singletonMockProvider = null
}
