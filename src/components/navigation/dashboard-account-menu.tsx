"use client"

import {
  ChevronUp,
  LogOut,
  Moon,
  Settings,
  Sun,
  Users,
} from "lucide-react"
import Link from "next/link"
import { useTheme } from "next-themes"
import type { ReactElement } from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { OrganizationRole } from "@/lib/permissions"
import { cn } from "@/lib/utils"

export type DashboardAccount = {
  displayName: string
  email: string
  organizationName: string | null
  role: OrganizationRole | null
}

type DashboardAccountMenuProps = {
  account: DashboardAccount
  collapsed: boolean
  signOutAction: () => Promise<void>
}

const roleLabels: Record<OrganizationRole, string> = {
  external_reviewer: "External reviewer",
  manager: "Manager",
  owner_admin: "Owner admin",
  staff: "Staff",
}

/**
 * Builds a short, stable avatar label from a member's display name.
 *
 * @param displayName - The visible account name.
 * @returns One or two uppercase initials.
 */
function getAccountInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean)

  if (words.length === 0) {
    return "?"
  }

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase()
}

/**
 * Renders the signed-in member identity and the account actions supported by BizFlow.
 *
 * @param props - Account identity, sidebar state, and the server sign-out action.
 * @returns A profile trigger with settings, team, appearance, and sign-out actions.
 */
export function DashboardAccountMenu({
  account,
  collapsed,
  signOutAction,
}: DashboardAccountMenuProps): ReactElement {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const roleLabel = account.role ? roleLabels[account.role] : null

  function toggleTheme(): void {
    setTheme(isDark ? "light" : "dark")
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Open account menu for ${account.displayName}`}
        className={cn(
          "group flex w-full items-center gap-2.5 rounded-[12px] border border-transparent p-2 text-left outline-none transition-colors",
          "hover:border-border hover:bg-card focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 data-popup-open:border-border data-popup-open:bg-card",
          collapsed && "md:justify-center md:px-1.5"
        )}
        title={collapsed ? account.displayName : undefined}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {getAccountInitials(account.displayName)}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 transition-[opacity,transform] duration-150",
            collapsed
              ? "md:w-0 md:flex-none md:-translate-x-1 md:overflow-hidden md:opacity-0"
              : "md:translate-x-0 md:opacity-100 md:delay-100"
          )}
        >
          <span className="block truncate text-sm font-medium text-foreground">
            {account.displayName}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {account.organizationName ?? account.email}
          </span>
        </span>
        <ChevronUp
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-[opacity,transform] duration-150 group-data-popup-open:rotate-180",
            collapsed
              ? "md:w-0 md:-translate-x-1 md:opacity-0"
              : "md:translate-x-0 md:opacity-100 md:delay-100"
          )}
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="w-[min(18rem,calc(100vw-2rem))] p-1.5"
        side="top"
        sideOffset={8}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-2 font-normal">
            <span className="block truncate text-sm font-medium text-foreground">
              {account.displayName}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {account.email}
            </span>
            {account.organizationName && (
              <span className="mt-2 block truncate text-xs text-muted-foreground">
                {account.organizationName}
                {roleLabel ? ` · ${roleLabel}` : ""}
              </span>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem render={<Link href="/settings" />}>
          <Settings aria-hidden="true" />
          Profile & preferences
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/people" />}>
          <Users aria-hidden="true" />
          People & permissions
        </DropdownMenuItem>
        <DropdownMenuItem onClick={toggleTheme}>
          {isDark ? (
            <Sun aria-hidden="true" />
          ) : (
            <Moon aria-hidden="true" />
          )}
          Appearance
          <span className="ml-auto text-xs text-muted-foreground">
            {isDark ? "Dark" : "Light"}
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <form action={signOutAction}>
          <DropdownMenuItem
            className="w-full"
            nativeButton
            render={<button type="submit" />}
          >
            <LogOut aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
