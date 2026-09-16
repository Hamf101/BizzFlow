"use client"

import dynamic from "next/dynamic"
import { type ReactElement, type ReactNode, useEffect } from "react"
import type { ExternalToast, ToasterProps } from "sonner"

type SonnerModule = typeof import("sonner")
type ToastChannel = "error" | "info" | "loading" | "success"

let sonnerPromise: Promise<SonnerModule> | undefined
let toastSequence = 0

function loadSonner(): Promise<SonnerModule> {
  sonnerPromise ??= import("sonner")
  return sonnerPromise
}

const DeferredToaster = dynamic(
  async () => {
    const { Toaster } = await loadSonner()
    return Toaster
  },
  { ssr: false }
)

function showToast(
  channel: ToastChannel,
  title: ReactNode,
  options?: ExternalToast
): string | number {
  const id = options?.id ?? `bizflow-toast-${++toastSequence}`
  const announcedTitle = <span role="status">{title}</span>

  void loadSonner()
    .then(({ toast }) => toast[channel](announcedTitle, { ...options, id }))
    .catch(() => undefined)

  return id
}

// Undo and the cross are a word and a mark on the toast, never boxes of
// their own: the message leads, and Undo sits quietly after it.
const TOAST_TEXT_BUTTON =
  "-my-1 shrink-0 rounded-[6px] px-1.5 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/35"

const toastClassNames = {
  actionButton: `${TOAST_TEXT_BUTTON} text-primary hover:text-primary/75`,
  cancelButton: `${TOAST_TEXT_BUTTON} text-muted-foreground hover:text-foreground`,
  closeButton:
    "order-last -my-1 -mr-1 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35",
  content: "min-w-0 flex-1",
  description: "text-sm text-muted-foreground",
  error: "border-destructive/50 text-destructive",
  info: "border-border text-foreground",
  loading: "border-primary/30 text-foreground",
  success: "border-primary/40 text-foreground",
  title: "text-sm font-medium text-foreground",
  toast:
    "flex w-full items-center gap-3 rounded-[12px] border border-border bg-card py-3 pr-3 pl-4 text-card-foreground shadow-lg",
} as const

/** Semantic toast entry points used by the fixed-copy feedback registry. */
export const bizflowToast = {
  /** Shows a successful authoritative result. */
  success(title: ReactNode, options?: ExternalToast): string | number {
    return showToast("success", title, options)
  },
  /** Shows a recoverable failed result without exposing raw server errors. */
  error(title: ReactNode, options?: ExternalToast): string | number {
    return showToast("error", title, options)
  },
  /** Shows neutral workflow information. */
  info(title: ReactNode, options?: ExternalToast): string | number {
    return showToast("info", title, options)
  },
  /** Shows an in-progress operation that can later be updated by id. */
  loading(title: ReactNode, options?: ExternalToast): string | number {
    return showToast("loading", title, options)
  },
} as const

/**
 * Names a field the browser refused to submit, by its label where it has one.
 *
 * @param field - The first invalid control of the submission.
 * @returns A short sentence for the toast.
 */
function describeInvalidField(
  field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): string {
  const label = field.labels?.[0]?.textContent?.replace(/\s*\*$/, "").trim()

  return field.validity.valueMissing && label
    ? `${label} is required.`
    : field.validationMessage
}

/**
 * Renders BizFlow's single application-level transient feedback surface.
 * Every form's missing or malformed field is reported here too, in place of
 * the browser's validation bubble.
 *
 * @returns The configured Sonner toaster using Editorial Ledger tokens.
 */
export function BizFlowToaster(): ReactElement<ToasterProps> {
  useEffect(() => {
    // One submission fires `invalid` at every bad field; the first one speaks.
    let reported = false

    function reportInvalidField(event: Event): void {
      const field = event.target

      if (
        !(field instanceof HTMLInputElement) &&
        !(field instanceof HTMLSelectElement) &&
        !(field instanceof HTMLTextAreaElement)
      ) {
        return
      }

      event.preventDefault()

      if (reported) {
        return
      }

      reported = true
      setTimeout(() => {
        reported = false
      })
      field.focus()
      bizflowToast.error(describeInvalidField(field), { id: "invalid-field" })
    }

    // `invalid` does not bubble, so only a capturing listener hears every form.
    document.addEventListener("invalid", reportInvalidField, true)

    return () => document.removeEventListener("invalid", reportInvalidField, true)
  }, [])

  return (
    <DeferredToaster
      closeButton
      duration={5_000}
      position="top-center"
      richColors={false}
      toastOptions={{
        classNames: toastClassNames,
        closeButtonAriaLabel: "Dismiss notification",
        unstyled: true,
      }}
    />
  )
}
