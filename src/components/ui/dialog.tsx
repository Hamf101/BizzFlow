"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"
import type { ComponentProps, ReactElement } from "react"

import { cn } from "@/lib/utils"

/**
 * Groups the parts of a modal dialog without adding application behavior.
 *
 * @param props - Base UI dialog root properties.
 * @returns The dialog context provider.
 */
function Dialog(props: DialogPrimitive.Root.Props): ReactElement {
  return <DialogPrimitive.Root {...props} />
}

/**
 * Opens its owning dialog while preserving Base UI focus-return behavior.
 *
 * @param props - Base UI trigger properties.
 * @returns The dialog trigger button or rendered trigger element.
 */
function DialogTrigger(props: DialogPrimitive.Trigger.Props): ReactElement {
  return (
    <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
  )
}

/**
 * Portals dialog chrome outside the current layout stacking context.
 *
 * @param props - Base UI portal properties.
 * @returns The dialog portal.
 */
function DialogPortal(props: DialogPrimitive.Portal.Props): ReactElement {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

/**
 * Closes its owning dialog and restores focus according to Base UI semantics.
 *
 * @param props - Base UI close-control properties.
 * @returns The close control.
 */
function DialogClose(props: DialogPrimitive.Close.Props): ReactElement {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

/**
 * Renders the dimmed modal backdrop using Editorial Ledger tokens.
 *
 * @param props - Base UI backdrop properties.
 * @returns The animated backdrop.
 */
function DialogBackdrop({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props): ReactElement {
  return (
    <DialogPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-foreground/40 backdrop-blur-[3px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none",
        className
      )}
      data-slot="dialog-backdrop"
      {...props}
    />
  )
}

/**
 * Renders a centred, labelled dialog surface with an optional icon close control.
 *
 * Callers must include `DialogTitle` and should include `DialogDescription` when
 * the action has a consequence. Mutation and authorization remain caller-owned.
 *
 * @param props - Base UI popup properties plus optional close-button visibility.
 * @returns The portalled dialog surface and backdrop.
 */
function DialogContent({
  children,
  className,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}): ReactElement {
  return (
    <DialogPortal>
      <DialogBackdrop />
      <DialogPrimitive.Viewport
        className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4 sm:p-6"
        data-slot="dialog-viewport"
      >
        <DialogPrimitive.Popup
          className={cn(
            "relative grid w-full max-w-lg gap-5 rounded-[18px] bg-card p-5 text-card-foreground shadow-[0_18px_60px_rgba(37,35,41,0.22)] ring-1 ring-border/80 outline-none transition-[opacity,transform] duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] data-[ending-style]:translate-y-1 data-[ending-style]:scale-[0.985] data-[ending-style]:opacity-0 data-[starting-style]:translate-y-1 data-[starting-style]:scale-[0.985] data-[starting-style]:opacity-0 motion-reduce:transform-none motion-reduce:transition-none sm:p-6",
            className
          )}
          data-slot="dialog-content"
          {...props}
        >
          {children}
          {showCloseButton ? (
            <DialogPrimitive.Close
              aria-label="Close dialog"
              className="absolute top-3 right-3 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors duration-150 hover:bg-secondary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none md:size-8"
              data-slot="dialog-close"
            >
              <XIcon aria-hidden="true" />
            </DialogPrimitive.Close>
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPortal>
  )
}

/**
 * Groups a dialog title and description with compact vertical rhythm.
 *
 * @param props - Native div properties.
 * @returns The dialog header region.
 */
function DialogHeader({
  className,
  ...props
}: ComponentProps<"div">): ReactElement {
  return (
    <div
      className={cn("grid gap-2 pr-8 text-left", className)}
      data-slot="dialog-header"
      {...props}
    />
  )
}

/**
 * Groups dialog actions with the safe action first in document order.
 *
 * @param props - Native div properties.
 * @returns The responsive dialog footer region.
 */
function DialogFooter({
  className,
  ...props
}: ComponentProps<"div">): ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end",
        className
      )}
      data-slot="dialog-footer"
      {...props}
    />
  )
}

/**
 * Supplies the accessible name for the dialog.
 *
 * @param props - Base UI title properties.
 * @returns The dialog heading.
 */
function DialogTitle({
  className,
  ...props
}: DialogPrimitive.Title.Props): ReactElement {
  return (
    <DialogPrimitive.Title
      className={cn(
        "text-xl leading-tight font-semibold tracking-[-0.02em] text-balance sm:text-2xl",
        className
      )}
      data-slot="dialog-title"
      {...props}
    />
  )
}

/**
 * Supplies optional consequence or supporting copy for the dialog.
 *
 * @param props - Base UI description properties.
 * @returns The dialog description.
 */
function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props): ReactElement {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm leading-6 text-muted-foreground", className)}
      data-slot="dialog-description"
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
