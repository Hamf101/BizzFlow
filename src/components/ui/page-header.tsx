import type { ReactElement, ReactNode } from "react"

import { cn } from "@/lib/utils"

type PageHeaderProps = {
  action?: ReactNode
  className?: string
  description?: string
  title: string
}

/**
 * Renders a route's single semantic heading, supporting copy, and authorized action.
 *
 * The caller owns permission checks and supplies the action only when allowed. This
 * component contains no route, data-fetching, or authorization logic.
 *
 * @param props - Safe display copy, an optional action, and optional layout classes.
 * @returns A responsive Editorial Ledger page header.
 */
function PageHeader({
  action,
  className,
  description,
  title,
}: PageHeaderProps): ReactElement {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
      data-slot="page-header"
    >
      <div className="grid min-w-0 gap-1.5" data-slot="page-header-copy">
        <h1 className="text-2xl leading-tight font-semibold tracking-normal text-balance">
          {title}
        </h1>
        {description ? (
          <p
            className="max-w-2xl text-sm leading-6 text-muted-foreground"
            data-slot="page-header-description"
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? (
        <div
          className="flex w-full shrink-0 items-center [&>*]:w-full sm:w-auto sm:[&>*]:w-auto"
          data-slot="page-header-action"
        >
          {action}
        </div>
      ) : null}
    </header>
  )
}

export { PageHeader }
export type { PageHeaderProps }
