"use client"

import type { ReactElement, ReactNode } from "react"
import {
  Toaster,
  toast,
  type ExternalToast,
  type ToasterProps,
} from "sonner"

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
    return toast.success(title, options)
  },
  /** Shows a recoverable failed result without exposing raw server errors. */
  error(title: ReactNode, options?: ExternalToast): string | number {
    return toast.error(title, options)
  },
  /** Shows neutral workflow information. */
  info(title: ReactNode, options?: ExternalToast): string | number {
    return toast.info(title, options)
  },
  /** Shows an in-progress operation that can later be updated by id. */
  loading(title: ReactNode, options?: ExternalToast): string | number {
    return toast.loading(title, options)
  },
} as const

/**
 * Renders BizFlow's single application-level transient feedback surface.
 *
 * @returns The configured Sonner toaster using Editorial Ledger tokens.
 */
export function BizFlowToaster(): ReactElement<ToasterProps> {
  return (
    <Toaster
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
