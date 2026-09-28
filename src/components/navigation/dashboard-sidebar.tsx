"use client"

import { PanelLeftClose, Search } from "lucide-react"
import Link from "next/link"
import { useState, type MouseEvent, type ReactElement } from "react"

import { BizFlowMark } from "@/components/brand/bizflow-mark"
import {
  DashboardAccountMenu,
  type DashboardAccount,
} from "@/components/navigation/dashboard-account-menu"
import { DashboardNavigation } from "@/components/navigation/dashboard-navigation"
import { SearchShortcut, WorkspaceSearchTrigger } from "@/components/search/workspace-search"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type DashboardSidebarProps = {
  account: DashboardAccount
  signOutAction: () => Promise<void>
}

/**
 * Renders the responsive dashboard sidebar and owns its desktop collapse state.
 *
 * @param props - Signed-in account details and the server sign-out action.
 * @returns The dashboard's primary navigation and account controls.
 */
export function DashboardSidebar({
  account,
  signOutAction,
}: DashboardSidebarProps): ReactElement {
  const [collapsed, setCollapsed] = useState(false)

  function expandFromEmptyRail(event: MouseEvent<HTMLElement>): void {
    if (!collapsed || !(event.target instanceof Element)) {
      return
    }

    const interactiveElement = event.target.closest(
      "a, button, input, select, textarea, [role='menuitem']"
    )

    if (!interactiveElement) {
      setCollapsed(false)
    }
  }

  return (
    <aside
      className={cn(
        // Hidden below md: at 375px this aside was ~500px of chrome above every
        // page heading. Mobile navigation is the bottom tab bar instead.
        "hidden flex-col gap-6 px-4 pt-5 pb-4 transition-[width] duration-200 md:flex md:w-[232px] md:shrink-0 md:pt-6",
        // Collapsed, the rail is one 44px column: the logo and every tab keep
        // their size and place, and only the words beside them go. While it
        // widens, what doesn't fit yet is cut off rather than squeezed in.
        "md:overflow-x-clip",
        collapsed && "md:w-[76px] md:cursor-e-resize"
      )}
      data-collapsed={collapsed}
      onClick={expandFromEmptyRail}
    >
      <div className="flex items-center justify-between gap-2">
        <Link
          aria-label="BizFlow dashboard"
          className="inline-flex shrink-0 items-center gap-2.5 rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          href="/dashboard"
        >
          <BizFlowMark className="size-11 shrink-0" />
          <span
            className={cn(
              "font-editorial text-xl leading-none font-semibold tracking-[-0.02em]",
              collapsed && "md:hidden"
            )}
          >
            BizFlow
          </span>
        </Link>

        {collapsed ? (
          <button
            className="sr-only"
            onClick={() => setCollapsed(false)}
            type="button"
          >
            Expand sidebar
          </button>
        ) : (
          <Button
            aria-label="Collapse sidebar"
            className="hidden md:inline-flex"
            onClick={() => setCollapsed(true)}
            size="icon-sm"
            title="Collapse sidebar"
            type="button"
            variant="ghost"
          >
            <PanelLeftClose aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className={cn("hidden md:block", collapsed && "md:hidden")}>
        <span className="editorial-kicker font-semibold text-primary">
          Workspace
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {account.permissionSubject ? (
          // Drawn as a tab, so it keeps the tabs' square and place.
          <WorkspaceSearchTrigger
            aria-label={collapsed ? "Search" : undefined}
            className={cn(
              "flex h-11 items-center rounded-[8px] pr-3 text-sm text-foreground/80 outline-none transition-colors hover:bg-secondary/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none",
              collapsed && "md:w-11 md:pr-0"
            )}
            title={collapsed ? "Search" : undefined}
          >
            <span className="grid size-11 shrink-0 place-items-center">
              <Search aria-hidden="true" className="size-5" />
            </span>
            <span className={cn("flex-1 truncate text-left", collapsed && "md:hidden")}>
              Search
            </span>
            <SearchShortcut className={cn(collapsed && "md:hidden")} />
          </WorkspaceSearchTrigger>
        ) : null}
        <DashboardNavigation
          collapsed={collapsed}
          role={account.permissionSubject}
        />
      </div>

      <div className="mt-auto border-t border-border/70 pt-3">
        <DashboardAccountMenu
          account={account}
          collapsed={collapsed}
          signOutAction={signOutAction}
        />
      </div>
    </aside>
  )
}
