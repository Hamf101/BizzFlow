"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"
import type { ComponentProps, ReactElement } from "react"

/**
 * Wraps the app in the class-based next-themes provider.
 *
 * @param props - next-themes provider configuration and children.
 * @returns The theme context provider used by the root layout.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>): ReactElement {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
