import type { ReactElement, ReactNode } from "react"

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
 * @returns A consistently sized authentication card with a centered header.
 */
export function AuthPageCard({
  title,
  description,
  children,
  footer,
  footerClassName,
}: AuthPageCardProps): ReactElement {
  return (
    // See-through, so the backdrop shows behind it; it rises in at every step.
    // No blur: redrawing one behind the moving pieces costs frames.
    <Card className="relative z-10 w-full max-w-md bg-card/75 duration-500 animate-in fade-in-0 slide-in-from-bottom-2">
      <div className="flex flex-col items-center gap-2.5 px-(--card-spacing) pt-2 text-center">
        <span className="editorial-kicker text-muted-foreground">
          Document studio
        </span>
        <h1 className="font-editorial text-xl leading-snug font-semibold">
          {title}
        </h1>
        {description !== undefined && (
          <p className="max-w-xs text-sm text-balance text-muted-foreground">{description}</p>
        )}
      </div>
      {children !== undefined && <CardContent>{children}</CardContent>}
      <CardFooter className={footerClassName}>{footer}</CardFooter>
    </Card>
  )
}
