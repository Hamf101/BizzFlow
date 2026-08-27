import {
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  ListChecks,
  ScrollText,
  SendToBack,
  Settings,
  Users,
} from "lucide-react"
import type { ComponentType } from "react"

import {
  canPerformOrganizationAction,
  type OrganizationPermissionAction,
  type OrganizationRole,
} from "@/lib/permissions"

/** One dashboard destination. */
export type NavigationItem = {
  href: string
  icon: ComponentType<{ className?: string }>
  label: string
  /** Short form used where the tab bar has no room for the full label. */
  shortLabel?: string
  /**
   * Permission the destination's page enforces. Omitted where every active
   * member may open it — the dashboard, and the personal settings page.
   */
  requiredAction?: OrganizationPermissionAction
}

/**
 * Every dashboard destination, in sidebar order.
 *
 * `requiredAction` mirrors what each page actually enforces, so navigation can
 * be filtered rather than offering a member a route they will bounce off.
 */
export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  {
    href: "/people",
    icon: Users,
    label: "People",
    requiredAction: "people:view",
  },
  {
    href: "/documents",
    icon: FileText,
    label: "Documents",
    shortLabel: "Docs",
    requiredAction: "documents:view",
  },
  {
    href: "/templates",
    icon: ScrollText,
    label: "Templates",
    requiredAction: "templates:view",
  },
  {
    href: "/submissions",
    icon: SendToBack,
    label: "Submissions",
    shortLabel: "Subs",
    requiredAction: "submissions:view",
  },
  { href: "/tasks", icon: ListChecks, label: "Tasks", requiredAction: "tasks:view" },
  {
    href: "/audit-log",
    icon: ClipboardCheck,
    label: "Audit log",
    shortLabel: "Audit",
    requiredAction: "audit_logs:view",
  },
  { href: "/settings", icon: Settings, label: "Settings" },
]

/**
 * Destinations promoted to the mobile tab bar, in bar order.
 *
 * A member who cannot reach one of these — an external reviewer has neither
 * Templates nor Tasks — has the gap filled from the remaining available
 * destinations, so the bar is never short.
 */
const MOBILE_PRIMARY_HREFS: readonly string[] = [
  "/dashboard",
  "/documents",
  "/templates",
  "/tasks",
]

/** How many destinations sit in the bar before the "More" trigger. */
const MOBILE_PRIMARY_COUNT = MOBILE_PRIMARY_HREFS.length

/**
 * Filters the destinations to those an actor's role can actually open.
 *
 * @param role - Active organization role, or null when there is no membership.
 * @returns Reachable destinations in sidebar order.
 */
export function getVisibleNavigationItems(
  role: OrganizationRole | null
): NavigationItem[] {
  if (!role) {
    return []
  }

  return NAVIGATION_ITEMS.filter(
    (item: NavigationItem): boolean =>
      !item.requiredAction ||
      canPerformOrganizationAction(role, item.requiredAction)
  )
}

/**
 * Splits the reachable destinations into the tab bar and the "More" sheet.
 *
 * @param role - Active organization role, or null when there is no membership.
 * @returns Bar destinations and the overflow behind "More".
 */
export function getMobileNavigationLayout(role: OrganizationRole | null): {
  primary: NavigationItem[]
  overflow: NavigationItem[]
} {
  const visible = getVisibleNavigationItems(role)
  const preferred = visible.filter((item: NavigationItem): boolean =>
    MOBILE_PRIMARY_HREFS.includes(item.href)
  )
  // Backfill from what is left so a restricted role still gets a full bar.
  const remainder = visible.filter(
    (item: NavigationItem): boolean => !preferred.includes(item)
  )
  const primary = [
    ...preferred,
    ...remainder.slice(0, Math.max(MOBILE_PRIMARY_COUNT - preferred.length, 0)),
  ]

  return {
    primary,
    overflow: visible.filter(
      (item: NavigationItem): boolean => !primary.includes(item)
    ),
  }
}
