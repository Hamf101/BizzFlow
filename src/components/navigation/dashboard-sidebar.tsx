"use client"

import { PanelLeftClose } from "lucide-react"
import Link from "next/link"
import { useState, type MouseEvent, type ReactElement } from "react"

import { BizFlowMark, BizFlowWordmark } from "@/components/brand/bizflow-mark"
import {
  DashboardAccountMenu,
  type DashboardAccount,
} from "@/components/navigation/dashboard-account-menu"
import { DashboardNavigation } from "@/components/navigation/dashboard-navigation"
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
        "hidden flex-col gap-6 px-4 pt-5 pb-4 transition-[width,padding] duration-200 md:flex md:w-[232px] md:shrink-0 md:pt-6",
        collapsed && "md:w-[80px] md:cursor-e-resize md:px-3"
      )}
      data-collapsed={collapsed}
      onClick={expandFromEmptyRail}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2",
          collapsed && "md:flex-col"
        )}
      >
        <Link
          aria-label="BizFlow dashboard"
          className="inline-flex min-w-0 rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          href="/dashboard"
        >
          <span className={cn(collapsed && "md:hidden")}>
            <BizFlowWordmark />
          </span>
          <span
            className={cn(
              "hidden size-9 place-items-center rounded-[10px] border border-primary/15 bg-secondary text-primary shadow-[0_1px_0_rgba(37,35,41,0.05)]",
              collapsed && "md:grid"
            )}
          >
            <BizFlowMark className="size-6" />
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
        <span className="editorial-kicker text-muted-foreground">
          Workspace
        </span>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          Structured documents with a visible history.
        </p>
      </div>

      <DashboardNavigation collapsed={collapsed} role={account.role} />

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
