"use client"

import { Loader2 } from "lucide-react"
import { useLinkStatus } from "next/link"
import { usePathname } from "next/navigation"
import type { ReactElement } from "react"

import { IntentPrefetchLink } from "@/components/navigation/intent-prefetch-link"
import { getVisibleNavigationItems } from "@/components/navigation/navigation-items"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { OrganizationRole } from "@/lib/permissions"
import { cn } from "@/lib/utils"

/**
 * Shows a spinner on the link currently being navigated to, giving an immediate
 * response to the click while the destination page's server data loads.
 *
 * @returns A spinner while the parent link's navigation is pending.
 */
function NavPendingIndicator({
  collapsed,
}: {
  collapsed: boolean
}): ReactElement | null {
  const { pending } = useLinkStatus()

  if (!pending) {
    return null
  }

  return (
    <Loader2
      aria-hidden="true"
      className={cn(
        "ml-auto size-3.5 animate-spin text-muted-foreground",
        collapsed && "md:absolute md:right-1 md:bottom-1 md:ml-0 md:size-3"
      )}
    />
  )
}

/**
 * Renders the route-aware dashboard navigation using the Editorial Ledger style.
 *
 * @returns A compact navigation rail with a visible current-page marker.
 */
export function DashboardNavigation({
  collapsed = false,
  role,
}: {
  collapsed?: boolean
  role: OrganizationRole | null
}): ReactElement {
  const pathname = usePathname()
  const navigationItems = getVisibleNavigationItems(role)

  return (
    <TooltipProvider>
      <nav aria-label="Primary navigation" className="flex flex-col gap-1">
        {navigationItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`)
          const Icon = item.icon
          const navigationLink = (
            <IntentPrefetchLink
              aria-label={collapsed ? item.label : undefined}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-[8px] px-3 py-2 text-sm text-muted-foreground transition-colors",
                "hover:bg-secondary/70 hover:text-foreground",
                isActive && "bg-secondary text-secondary-foreground",
                collapsed &&
                  "md:size-11 md:self-center md:justify-center md:p-0"
              )}
              href={item.href}
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
                  isActive && "text-primary",
                  collapsed && "md:size-5"
                )}
              />
              <span
                className={cn(
                  "overflow-hidden whitespace-nowrap md:transition-[opacity,transform] md:duration-150",
                  isActive && "font-medium",
                  collapsed
                    ? "md:w-0 md:-translate-x-1 md:opacity-0"
                    : "md:translate-x-0 md:opacity-100"
                )}
                style={{
                  transitionDelay: collapsed ? "0ms" : "100ms",
                }}
              >
                {item.label}
              </span>
              <NavPendingIndicator collapsed={collapsed} />
            </IntentPrefetchLink>
          )

          return (
            <Tooltip disabled={!collapsed} key={item.href}>
              <TooltipTrigger render={navigationLink} />
              <TooltipContent className="hidden md:inline-flex" side="right">
                {item.label}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </nav>
    </TooltipProvider>
  )
}
