import type { ReactElement, ReactNode } from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export type AuthPageCardProps = {
  title: ReactNode
  description: ReactNode
  children?: ReactNode
  footer: ReactNode
  footerClassName?: string
}

/**
 * Renders the shared card frame used by authentication server pages.
 *
 * @param props - Page-specific heading, body, footer, and optional footer style.
 * @returns A consistently sized authentication card.
 */
export function AuthPageCard({
  title,
  description,
  children,
  footer,
  footerClassName,
}: AuthPageCardProps): ReactElement {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {children !== undefined && <CardContent>{children}</CardContent>}
      <CardFooter className={footerClassName}>{footer}</CardFooter>
    </Card>
  )
}
