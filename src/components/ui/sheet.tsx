"use client"

import { Dialog } from "@base-ui/react/dialog"
import type { ComponentProps, ReactElement } from "react"

import { cn } from "@/lib/utils"

/**
 * Bottom sheet built on the Base UI dialog.
 *
 * Exists for the mobile navigation: below `md` the sidebar is hidden and the
 * destinations that do not fit the tab bar live here. It enters from the bottom
 * because that is where the trigger is, and it respects the safe-area inset so
 * the last row is not under a home indicator.
 */
export const Sheet = Dialog.Root
export const SheetTrigger = Dialog.Trigger

/**
 * Renders the sheet surface with its backdrop.
 *
 * @param props - Dialog popup props; children are the sheet's content.
 * @returns The portalled sheet.
 */
export function SheetContent({
  children,
  className,
  ...props
}: ComponentProps<typeof Dialog.Popup>): ReactElement {
  return (
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/35 backdrop-blur-[2px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <Dialog.Popup
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[80svh] flex-col gap-1 overflow-y-auto rounded-t-[18px] border border-b-0 border-border bg-card p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_32px_rgba(37,35,41,0.14)] outline-none transition-transform duration-250 data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full",
          className
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className="mx-auto mb-2 h-1 w-9 shrink-0 rounded-full bg-border"
        />
        {children}
      </Dialog.Popup>
    </Dialog.Portal>
  )
}

/**
 * Accessible title for the sheet. Required — a dialog without one is unusable
 * with a screen reader.
 *
 * @param props - Dialog title props.
 * @returns The sheet's heading.
 */
export function SheetTitle({
  className,
  ...props
}: ComponentProps<typeof Dialog.Title>): ReactElement {
  return (
    <Dialog.Title
      className={cn(
        "px-2 pb-1 font-mono text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase",
        className
      )}
      {...props}
    />
  )
}
