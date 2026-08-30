import {
  capturePostHogEvent,
  type AnalyticsEventName,
  type AnalyticsEventProperties,
} from "@/lib/posthog"

/**
 * Records one allowlisted product event without delaying the caller.
 *
 * @param name - Stable event name.
 * @param properties - Allowlisted stable outcome or route metadata.
 */
export function trackEvent(
  name: AnalyticsEventName,
  properties?: AnalyticsEventProperties
): void {
  void capturePostHogEvent(name, properties)
}
