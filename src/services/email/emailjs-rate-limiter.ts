export type EmailJsRateLimiterDeps = {
  now?: () => number
  wait?: (durationMs: number) => Promise<void>
}

/** Function that resolves when an EmailJS request may start. */
export type ReserveEmailJsSendSlot = () => Promise<void>

/**
 * Creates a FIFO reservation gate for EmailJS's one-request-per-second limit.
 *
 * @param minimumIntervalMs - Minimum elapsed time between request starts.
 * @param deps - Optional clock and delay implementations for deterministic tests.
 * @returns An async function that reserves the next available request slot.
 * @throws Error when an injected delay implementation rejects.
 */
export function createEmailJsRateLimiter(
  minimumIntervalMs: number,
  deps: EmailJsRateLimiterDeps = {}
): ReserveEmailJsSendSlot {
  const now = deps.now ?? Date.now
  const wait =
    deps.wait ??
    ((durationMs: number): Promise<void> =>
      new Promise((resolve: () => void): void => {
        setTimeout(resolve, durationMs)
      }))
  let queue: Promise<void> = Promise.resolve()
  let nextAvailableAt = 0

  return async (): Promise<void> => {
    const previousReservation = queue
    let releaseReservation: (() => void) | undefined

    queue = new Promise((resolve: () => void): void => {
      releaseReservation = resolve
    })

    await previousReservation

    try {
      const delayMs = Math.max(0, nextAvailableAt - now())

      if (delayMs > 0) {
        await wait(delayMs)
      }

      nextAvailableAt = now() + minimumIntervalMs
    } finally {
      releaseReservation?.()
    }
  }
}
