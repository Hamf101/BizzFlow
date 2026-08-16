export function trackEvent(name: string, properties?: Record<string, unknown>) {
  if (typeof window !== 'undefined') {
    // Dynamically import to avoid SSR issues
    import('posthog-js').then(({ default: posthog }) => {
      if (posthog.__loaded) posthog.capture(name, properties)
    }).catch(() => { /* PostHog not available */ })
  }
}
