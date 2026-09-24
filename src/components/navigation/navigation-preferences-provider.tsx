"use client"

import { createContext, useContext, useRef, useState, type ReactElement, type ReactNode } from "react"
import { updateNavigationAction } from "@/app/(dashboard)/navigation-actions"
import type { NavigationPreferences } from "@/types/navigation"

type NavigationCustomization = {
  preferences: NavigationPreferences
  saving: boolean
  error: string | null
  save: (change: unknown, optimisticOrder?: string[]) => Promise<boolean>
}
const NavigationContext = createContext<NavigationCustomization | null>(null)

/** Shares saved navigation between desktop and mobile, rolling back failed saves. */
export function NavigationPreferencesProvider({ organizationId, initialPreferences, children }: {
  organizationId?: string
  initialPreferences?: NavigationPreferences
  children: ReactNode
}): ReactElement {
  const [preferences, setPreferences] = useState(initialPreferences)
  const [previousInitial, setPreviousInitial] = useState(initialPreferences)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  if (initialPreferences !== previousInitial) {
    setPreviousInitial(initialPreferences)
    setPreferences(initialPreferences)
  }

  async function save(change: unknown, optimisticOrder?: string[]): Promise<boolean> {
    if (!organizationId || !preferences || busy.current) return false
    busy.current = true
    setSaving(true)
    setError(null)
    const previous = preferences
    if (optimisticOrder) setPreferences({ ...preferences, order: optimisticOrder })
    try {
      const result = await updateNavigationAction({ organizationId, change })
      if (result.error !== undefined) throw new Error(result.error)
      setPreferences(result.preferences)
      return true
    } catch (error) {
      setPreferences(previous)
      setError(error instanceof Error ? error.message : "Unable to save navigation changes.")
      return false
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  return <NavigationContext.Provider value={preferences && organizationId ? { preferences, saving, error, save } : null}>{children}</NavigationContext.Provider>
}

/** Returns customization controls when a workspace's preferences are available. */
export function useNavigationPreferences(): NavigationCustomization | null {
  return useContext(NavigationContext)
}
