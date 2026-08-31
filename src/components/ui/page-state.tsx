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
  context?: string
  label: string
  variant?: "list" | "overview" | "split"
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
  context,
  label,
  variant = "list",
}: PageSkeletonProps): ReactElement {
  return (
    <div
      aria-live="polite"
      className={cn("grid gap-6", className)}
      data-slot="page-skeleton"
      data-variant={variant}
      role="status"
    >
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="grid animate-pulse gap-5 motion-reduce:animate-none"
        data-slot="page-skeleton-content"
      >
        {context ? (
          <span
            className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
            data-slot="page-skeleton-context"
          >
            {context}
          </span>
        ) : null}
        <div className="grid gap-2">
          <div className="h-7 w-44 max-w-2/3 rounded-md bg-muted" />
          <div className="h-3.5 w-80 max-w-full rounded-md bg-muted/70" />
        </div>
        <PageSkeletonGeometry variant={variant} />
      </div>
    </div>
  )
}

function PageSkeletonGeometry({
  variant,
}: {
  variant: NonNullable<PageSkeletonProps["variant"]>
}): ReactElement {
  if (variant === "overview") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-24 rounded-2xl bg-secondary/45 sm:col-span-2" />
        <div className="h-32 rounded-2xl bg-card/45" />
        <div className="h-32 rounded-2xl bg-card/45" />
      </div>
    )
  }

  if (variant === "split") {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <PageSkeletonSection />
        <PageSkeletonSection />
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="hidden h-10 w-3/5 rounded-xl bg-secondary/45 sm:block" />
      <div className="grid rounded-2xl bg-card/35 px-3">
        <PageSkeletonRow />
        <PageSkeletonRow />
        <PageSkeletonRow className="hidden sm:grid" />
      </div>
    </div>
  )
}

function PageSkeletonRow({ className }: { className?: string }): ReactElement {
  return (
    <div
      className={cn(
        "grid min-h-16 grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-4 border-t border-border/70 first:border-t-0 sm:grid-cols-[2.25rem_minmax(0,1fr)_4.5rem]",
        className
      )}
      data-slot="page-skeleton-row"
    >
      <div className="hidden size-9 rounded-[10px] bg-secondary/70 sm:block" />
      <div className="grid gap-2">
        <div className="h-3 w-3/5 rounded-md bg-muted" />
        <div className="hidden h-2.5 w-2/5 rounded-md bg-muted/60 sm:block" />
      </div>
      <div className="h-2.5 w-14 justify-self-end rounded-md bg-muted/50" />
    </div>
  )
}

function PageSkeletonSection(): ReactElement {
  return (
    <div className="grid min-h-36 content-start gap-4 rounded-2xl bg-card/40 p-5">
      <div className="h-4 w-2/5 rounded-md bg-muted" />
      <div className="h-3 w-4/5 rounded-md bg-muted/65" />
      <div className="h-3 w-3/5 rounded-md bg-muted/50" />
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
          "rounded-2xl bg-destructive/5 px-4 py-5 sm:px-5",
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
