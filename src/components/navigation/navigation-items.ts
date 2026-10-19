import { ClipboardCheck, Folder, ListChecks, Settings } from "lucide-react"
import type { ComponentType } from "react"

import { DashboardIcon, FlowIcon, PeopleIcon, SubmissionsIcon, TemplatesIcon } from "@/components/navigation/nav-icons"
import type { NavigationPreferences } from "@/types/navigation"

import {
  canPerformOrganizationAction,
  type OrganizationPermissionAction,
  type OrganizationPermissionSubject,
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
  /** Open to every member, but only once there is a workspace to work in. */
  needsOrganization?: true
}

/**
 * Every dashboard destination, in sidebar order.
 *
 * `requiredAction` mirrors what each page actually enforces, so navigation can
 * be filtered rather than offering a member a route they will bounce off.
 */
export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { href: "/dashboard", icon: DashboardIcon, label: "Dashboard" },
  { href: "/flow", icon: FlowIcon, label: "Flow", needsOrganization: true },
  {
    href: "/people",
    icon: PeopleIcon,
    label: "People",
    requiredAction: "people:view",
  },
  {
    href: "/documents",
    icon: Folder,
    label: "Files",
    requiredAction: "documents:view",
  },
  {
    href: "/templates",
    icon: TemplatesIcon,
    label: "Templates",
    requiredAction: "templates:view",
  },
  {
    href: "/submissions",
    icon: SubmissionsIcon,
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
 * @returns Reachable destinations in sidebar order, including universal pages before setup.
 */
export function getVisibleNavigationItems(
  role: OrganizationPermissionSubject | null,
  preferences?: Pick<NavigationPreferences, "labels" | "order">
): NavigationItem[] {
  if (!role) {
    return NAVIGATION_ITEMS.filter(
      (item: NavigationItem): boolean => !item.requiredAction && !item.needsOrganization
    )
  }

  const visible = NAVIGATION_ITEMS.filter(
    (item: NavigationItem): boolean => !item.requiredAction || canPerformOrganizationAction(role, item.requiredAction)
  ).map((item) => {
    const label = preferences?.labels[item.href as keyof NavigationPreferences["labels"]]
    return label ? { ...item, label, shortLabel: label } : item
  })
  const order = preferences?.order ?? []
  return visible.sort((a, b) => {
    const rank = (href: string): number => { const index = order.indexOf(href); return index < 0 ? order.length : index }
    return rank(a.href) - rank(b.href)
  })
}

/**
 * Splits the reachable destinations into the tab bar and the "More" sheet.
 *
 * @param role - Active organization role, or null when there is no membership.
 * @returns Bar destinations and the overflow behind "More".
 */
export function getMobileNavigationLayout(
  role: OrganizationPermissionSubject | null,
  preferences?: Pick<NavigationPreferences, "labels" | "order">
): {
  primary: NavigationItem[]
  overflow: NavigationItem[]
} {
  const visible = getVisibleNavigationItems(role, preferences)
  if (preferences?.order.length) return { primary: visible.slice(0, MOBILE_PRIMARY_COUNT), overflow: visible.slice(MOBILE_PRIMARY_COUNT) }
  // A reviewer's day is the queue, so Submissions takes Templates' place.
  const hrefs =
    role && canPerformOrganizationAction(role, "submissions:review")
      ? MOBILE_PRIMARY_HREFS.map((href) => (href === "/templates" ? "/submissions" : href))
      : MOBILE_PRIMARY_HREFS
  const preferred = visible.filter((item: NavigationItem): boolean =>
    hrefs.includes(item.href)
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
