"use client"

import {
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  Loader2,
  ScrollText,
  SendToBack,
  Users,
} from "lucide-react"
import Link, { useLinkStatus } from "next/link"
import { usePathname } from "next/navigation"
import type { ComponentType, ReactElement } from "react"

import { cn } from "@/lib/utils"

const navigationItems: ReadonlyArray<{
  href: string
  icon: ComponentType<{ className?: string }>
  label: string
}> = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/people", icon: Users, label: "People" },
  { href: "/documents", icon: FileText, label: "Documents" },
  { href: "/templates", icon: ScrollText, label: "Templates" },
  { href: "/submissions", icon: SendToBack, label: "Submissions" },
  { href: "/audit-log", icon: ClipboardCheck, label: "Audit log" },
]

/**
 * Shows a spinner on the link currently being navigated to, giving an immediate
 * response to the click while the destination page's server data loads.
 *
 * @returns A spinner while the parent link's navigation is pending.
 */
function NavPendingIndicator(): ReactElement | null {
  const { pending } = useLinkStatus()

  if (!pending) {
    return null
  }

  return (
    <Loader2
      aria-hidden="true"
      className="ml-auto size-3.5 animate-spin text-muted-foreground"
    />
  )
}

/**
 * Renders the route-aware dashboard navigation using the Editorial Ledger style.
 *
 * @returns A compact navigation rail with a visible current-page marker.
 */
export function DashboardNavigation(): ReactElement {
  const pathname = usePathname()

  return (
    <nav aria-label="Primary navigation" className="flex flex-col gap-1">
      {navigationItems.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`)
        const Icon = item.icon

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-[8px] px-3 py-2 text-sm text-muted-foreground transition-colors",
              "hover:bg-secondary/70 hover:text-foreground",
              isActive && "bg-secondary text-secondary-foreground"
            )}
            href={item.href}
            key={item.href}
          >
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-y-2 left-0 w-px bg-transparent",
                isActive && "bg-primary"
              )}
            />
            <Icon
              className={cn(
                "size-4 text-muted-foreground transition-colors",
                isActive && "text-primary"
              )}
            />
            <span className={cn(isActive && "font-medium")}>{item.label}</span>
            <NavPendingIndicator />
          </Link>
        )
      })}
    </nav>
  )
}
