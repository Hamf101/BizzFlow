/** What the channel carries when something is shared with the member. */
export type SharedMessage = { actorName: string; count?: number; id: string; kind: "document" | "folder" | "template"; level: string; name: string }

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
    (message.kind === "document" || message.kind === "folder" || message.kind === "template") &&
    typeof message.level === "string" &&
    typeof message.name === "string"
  ) {
    const count = typeof message.count === "number" && message.count > 1 ? { count: message.count } : {}

    return { actorName: message.actorName, ...count, id: message.id, kind: message.kind, level: message.level, name: message.name }
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
  const editor = message.level === "contributor" || message.level === "editor"

  if (message.count) {
    return {
      detail: editor ? "You can edit them." : "You can view them.",
      href: message.kind === "template" ? "/templates" : "/documents",
      title: `${message.actorName} shared ${message.count} items with you`,
    }
  }

  const what = message.kind === "document" ? "" : `the ${message.kind} `
  const title = `${message.actorName} shared ${what}“${message.name}” with you`

  if (message.kind === "template") {
    return {
      detail: editor ? "You can edit it." : message.level === "user" ? "You can make documents from it." : "You can view it.",
      href: editor ? `/templates/${message.id}/edit` : "/templates",
      title,
    }
  }

  return {
    detail: editor ? "You can edit it." : "You can view it.",
    href: message.kind === "folder" ? `/documents?folderId=${message.id}` : `/documents/${message.id}`,
    title,
  }
}

const SOUND_KEY = "bizflow.notice-sound"
const SOUND_CHANGED = "bizflow-notice-sound"

/**
 * Whether this device chimes when something is shared. On until turned off,
 * and on again if the browser will not say.
 *
 * @returns True unless this device has turned it off.
 */
export function noticeSoundOn(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off"
  } catch {
    return true
  }
}

/**
 * Turns the chime on or off for this device only.
 *
 * @param on - Whether to chime.
 */
export function setNoticeSound(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off")
  } catch {
    // Nowhere to keep it; the choice lasts until the page closes.
  }

  window.dispatchEvent(new Event(SOUND_CHANGED))
}

/**
 * Calls back when the choice changes here or in another tab.
 *
 * @param onChange - What to do.
 * @returns A way to stop listening.
 */
export function watchNoticeSound(onChange: () => void): () => void {
  window.addEventListener(SOUND_CHANGED, onChange)
  window.addEventListener("storage", onChange)

  return () => {
    window.removeEventListener(SOUND_CHANGED, onChange)
    window.removeEventListener("storage", onChange)
  }
}

/** A short two-note chime made in the browser; no audio file to ship. Silent where the browser blocks sound. */
export function playChime(): void {
  if (!noticeSoundOn()) {
    return
  }

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
