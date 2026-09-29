/** What the channel carries when something is shared with the member. */
export type SharedMessage = { actorName: string; id: string; kind: "document" | "folder"; level: string; name: string }

/**
 * Reads a message off the member's channel, ignoring anything that is not a share.
 *
 * @param payload - Whatever arrived.
 * @returns The message, or null when it is not one this app sent.
 */
export function readSharedMessage(payload: unknown): SharedMessage | null {
  const message = payload as Partial<Record<keyof SharedMessage, unknown>> | null

  if (
    typeof message?.actorName === "string" &&
    typeof message.id === "string" &&
    (message.kind === "document" || message.kind === "folder") &&
    typeof message.level === "string" &&
    typeof message.name === "string"
  ) {
    return { actorName: message.actorName, id: message.id, kind: message.kind, level: message.level, name: message.name }
  }

  return null
}

/**
 * Words the pop-up and says where Open goes.
 *
 * @param message - The share.
 * @returns The sentence, a short line about what they can do, and the address to open.
 */
export function describeShare(message: SharedMessage): { detail: string; href: string; title: string } {
  const what = message.kind === "folder" ? "the folder" : ""
  const title = `${message.actorName} shared ${what ? `${what} ` : ""}“${message.name}” with you`

  return {
    detail: message.level === "contributor" ? "You can edit it." : "You can view it.",
    href: message.kind === "folder" ? `/documents?folderId=${message.id}` : `/documents/${message.id}`,
    title,
  }
}

/** A short two-note chime made in the browser; no audio file to ship. Silent where the browser blocks sound. */
export function playChime(): void {
  try {
    const context = new AudioContext()
    const start = context.currentTime

    for (const [index, frequency] of [880, 1320].entries()) {
      const tone = context.createOscillator()
      const volume = context.createGain()
      const at = start + index * 0.12

      tone.frequency.value = frequency
      volume.gain.setValueAtTime(0.0001, at)
      volume.gain.exponentialRampToValueAtTime(0.15, at + 0.02)
      volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.4)
      tone.connect(volume).connect(context.destination)
      tone.start(at)
      tone.stop(at + 0.45)
    }

    window.setTimeout(() => void context.close(), 1000)
  } catch {
    // Browsers keep audio off until the page has been touched; the pop-up still shows.
  }
}
