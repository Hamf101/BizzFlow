"use client"

import dynamic from "next/dynamic"
import type { ReactElement, ReactNode } from "react"
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

const toastClassNames = {
  actionButton:
    "min-h-11 rounded-[8px] bg-primary px-3 text-sm font-medium text-primary-foreground",
  cancelButton:
    "min-h-11 rounded-[8px] bg-secondary px-3 text-sm font-medium text-secondary-foreground",
  closeButton:
    "size-11 rounded-[8px] border border-border bg-card text-foreground",
  description: "text-sm text-muted-foreground",
  error: "border-destructive/50 text-destructive",
  info: "border-border text-foreground",
  loading: "border-primary/30 text-foreground",
  success: "border-primary/40 text-foreground",
  title: "text-sm font-medium text-foreground",
  toast:
    "flex w-full items-start gap-3 rounded-[10px] border border-border bg-card p-4 text-card-foreground shadow-lg",
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
 * Renders BizFlow's single application-level transient feedback surface.
 *
 * @returns The configured Sonner toaster using Editorial Ledger tokens.
 */
export function BizFlowToaster(): ReactElement<ToasterProps> {
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
