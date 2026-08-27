import Link from "next/link"
import type { ReactElement } from "react"

import { BizFlowWordmark } from "@/components/brand/bizflow-mark"
import {
  DashboardAccountMenu,
  type DashboardAccount,
} from "@/components/navigation/dashboard-account-menu"

/**
 * Compact header shown only below `md`, where the sidebar is hidden.
 *
 * The sidebar carried the wordmark and the account menu as well as the
 * navigation, so hiding it on mobile would otherwise take sign-out and the
 * theme control with it. Navigation itself lives in the bottom tab bar.
 *
 * @param props - Signed-in account details and the server sign-out action.
 * @returns A sticky mobile header.
 */
export function MobileTopBar({
  account,
  signOutAction,
}: {
  account: DashboardAccount
  signOutAction: () => Promise<void>
}): ReactElement {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-canvas/95 px-4 py-2 backdrop-blur-sm md:hidden">
      <Link
        aria-label="BizFlow dashboard"
        className="inline-flex min-w-0 rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        href="/dashboard"
      >
        <BizFlowWordmark />
      </Link>
      <DashboardAccountMenu
        account={account}
        collapsed
        signOutAction={signOutAction}
      />
    </header>
  )
}
