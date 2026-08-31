import type { ReactElement, ReactNode } from "react"

import { cn } from "@/lib/utils"

type PageStateProps = {
  action?: ReactNode
  className?: string
  description?: string
  title: string
}

type PageSkeletonProps = {
  className?: string
  label: string
}

/**
 * Renders generic route-shaped loading geometry with an assistive status label.
 *
 * Placeholder blocks are intentionally generic and hidden from assistive technology
 * so they reveal neither tenant data nor an unauthorized record shape.
 *
 * @param props - A safe loading label and optional layout classes.
 * @returns An accessible, reduced-motion-safe page skeleton.
 */
function PageSkeleton({
  className,
  label,
}: PageSkeletonProps): ReactElement {
  return (
    <div
      aria-live="polite"
      className={cn("grid gap-6", className)}
      data-slot="page-skeleton"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="grid animate-pulse gap-6 motion-reduce:animate-none"
        data-slot="page-skeleton-content"
      >
        <div className="grid gap-2 border-b border-border/60 pb-5">
          <div className="h-7 w-44 max-w-2/3 rounded-md bg-muted" />
          <div className="h-4 w-80 max-w-full rounded-md bg-muted/80" />
        </div>
        <div className="grid gap-3">
          <div className="h-11 rounded-[10px] bg-muted/70" />
          <div className="h-11 rounded-[10px] bg-muted/55" />
          <div className="h-11 rounded-[10px] bg-muted/40" />
        </div>
      </div>
    </div>
  )
}

function PageStateSurface({
  action,
  className,
  description,
  slot,
  title,
  tone,
}: PageStateProps & {
  slot: "empty-state" | "error-state"
  tone: "empty" | "error"
}): ReactElement {
  return (
    <section
      className={cn(
        "grid gap-3 text-left",
        tone === "empty" &&
          "min-h-44 content-center border-y border-border/60 py-10",
        tone === "error" &&
          "border-l-2 border-destructive/45 py-2 pl-4",
        className
      )}
      data-slot={slot}
      role={tone === "error" ? "alert" : undefined}
    >
      <div className="grid max-w-xl gap-1.5">
        <h2 className="text-lg leading-snug font-semibold text-balance">
          {title}
        </h2>
        {description ? (
          <p className="text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? (
        <div
          className="flex w-full items-center pt-1 [&>*]:w-full sm:w-auto sm:[&>*]:w-auto"
          data-slot="page-state-action"
        >
          {action}
        </div>
      ) : null}
    </section>
  )
}

/**
 * Renders a specific empty collection message and caller-authorized next action.
 *
 * @param props - Safe title, optional explanation, action, and layout classes.
 * @returns A quiet, content-first empty state.
 */
function EmptyState(props: PageStateProps): ReactElement {
  return <PageStateSurface {...props} slot="empty-state" tone="empty" />
}

/**
 * Renders a safe recoverable-error message and caller-owned recovery action.
 *
 * This surface accepts display copy rather than an exception object. Capturing and
 * redacting the original error remains the responsibility of the route boundary.
 *
 * @param props - Safe title, optional explanation, action, and layout classes.
 * @returns An announced inline recovery state.
 */
function ErrorState(props: PageStateProps): ReactElement {
  return <PageStateSurface {...props} slot="error-state" tone="error" />
}

export { EmptyState, ErrorState, PageSkeleton }
export type { PageSkeletonProps, PageStateProps }
