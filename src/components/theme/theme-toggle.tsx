"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import type { ReactElement } from "react"

import { Button } from "@/components/ui/button"

/**
 * Switches between the light and dark themes and persists the choice.
 *
 * Icon visibility is driven purely by the `.dark` class that next-themes sets
 * on the document before hydration, so there is no theme flash and no
 * server/client markup mismatch to reconcile.
 *
 * @returns An icon button that toggles the active theme.
 */
export function ThemeToggle(): ReactElement {
  const { resolvedTheme, setTheme } = useTheme()

  function toggleTheme(): void {
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }

  return (
    <Button
      aria-label="Toggle color theme"
      onClick={toggleTheme}
      size="icon-sm"
      title="Toggle color theme"
      type="button"
      variant="outline"
    >
      <Moon className="dark:hidden" />
      <Sun className="hidden dark:block" />
      <span className="sr-only">Toggle color theme</span>
    </Button>
  )
}
