import type { ReactElement, ReactNode } from "react"

import { BizFlowMark } from "@/components/brand/bizflow-mark"
import { Card, CardContent, CardFooter } from "@/components/ui/card"

export type AuthPageCardProps = {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer: ReactNode
  footerClassName?: string
}

/**
 * Renders the shared card frame used by authentication server pages.
 *
 * @param props - Page-specific heading, body, footer, and optional footer style.
 * @returns A consistently sized authentication card with a centered brand header.
 */
export function AuthPageCard({
  title,
  description,
  children,
  footer,
  footerClassName,
}: AuthPageCardProps): ReactElement {
  return (
    <Card className="relative z-10 w-full max-w-md">
      <div className="flex flex-col items-center gap-2.5 px-(--card-spacing) pt-2 text-center">
        <span className="grid size-14 place-items-center rounded-[15px] border border-primary/15 bg-secondary text-primary shadow-[0_1px_0_rgba(37,35,41,0.05)]">
          <BizFlowMark className="size-7" />
        </span>
        <span className="editorial-kicker text-muted-foreground">
          Document studio
        </span>
        <h1 className="font-editorial text-xl leading-snug font-semibold">
          {title}
        </h1>
        {description !== undefined && (
          <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children !== undefined && <CardContent>{children}</CardContent>}
      <CardFooter className={footerClassName}>{footer}</CardFooter>
    </Card>
  )
}
