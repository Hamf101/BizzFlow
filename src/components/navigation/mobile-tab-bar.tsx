"use client"

import { Ellipsis } from "lucide-react"
import { usePathname } from "next/navigation"
import { useState, type ReactElement } from "react"

import { IntentPrefetchLink } from "@/components/navigation/intent-prefetch-link"
import {
  getMobileNavigationLayout,
  type NavigationItem,
} from "@/components/navigation/navigation-items"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { OrganizationRole } from "@/lib/permissions"
import { cn } from "@/lib/utils"

/** Height of the bar, mirrored by the layout's bottom padding. */
export const MOBILE_TAB_BAR_HEIGHT_CLASS = "h-14"

function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Bottom navigation for phones and small tablets.
 *
 * Below `md` the sidebar is hidden — at 375px it was roughly 500px of chrome
 * above every page heading. Four destinations sit in the thumb zone and the
 * rest live behind "More".
 *
 * The set is role-aware: an external reviewer has no Templates, Tasks or Audit
 * log, so those never appear and the bar backfills from what remains rather
 * than rendering a short row or a dead link.
 *
 * @param props - The viewer's active organization role.
 * @returns A fixed bottom bar, hidden from `md` upwards.
 */
export function MobileTabBar({
  role,
}: {
  role: OrganizationRole | null
}): ReactElement | null {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const { primary, overflow } = getMobileNavigationLayout(role)

  if (primary.length === 0) {
    return null
  }

  const overflowIsCurrent = overflow.some((item: NavigationItem): boolean =>
    isCurrent(pathname, item.href)
  )

  return (
    <nav
      aria-label="Mobile navigation"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-sm md:hidden",
        "pb-[env(safe-area-inset-bottom)]"
      )}
    >
      <ul
        className={cn("grid", MOBILE_TAB_BAR_HEIGHT_CLASS)}
        style={{
          gridTemplateColumns: `repeat(${primary.length + (overflow.length > 0 ? 1 : 0)}, minmax(0, 1fr))`,
        }}
      >
        {primary.map((item: NavigationItem) => {
          const current = isCurrent(pathname, item.href)
          const Icon = item.icon

          return (
            <li className="contents" key={item.href}>
              <IntentPrefetchLink
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 text-[10px] leading-none transition-colors",
                  current
                    ? "font-medium text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
                href={item.href}
              >
                <Icon className="size-5" />
                {item.shortLabel ?? item.label}
              </IntentPrefetchLink>
            </li>
          )
        })}

        {overflow.length > 0 && (
          <li className="contents">
            <Sheet onOpenChange={setMoreOpen} open={moreOpen}>
              <SheetTrigger
                className={cn(
                  "flex flex-col items-center justify-center gap-1 text-[10px] leading-none transition-colors",
                  overflowIsCurrent
                    ? "font-medium text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Ellipsis className="size-5" />
                More
              </SheetTrigger>
              <SheetContent>
                <SheetTitle>Everything else</SheetTitle>
                {overflow.map((item: NavigationItem) => {
                  const current = isCurrent(pathname, item.href)
                  const Icon = item.icon

                  return (
                    <IntentPrefetchLink
                      className={cn(
                        "flex h-11 items-center gap-3 rounded-[10px] px-3 text-sm transition-colors",
                        current
                          ? "bg-secondary font-medium text-secondary-foreground"
                          : "text-foreground hover:bg-secondary/60"
                      )}
                      href={item.href}
                      key={item.href}
                      onClick={() => setMoreOpen(false)}
                      aria-current={current ? "page" : undefined}
                    >
                      <Icon
                        className={cn(
                          "size-4",
                          current ? "text-secondary-foreground" : "text-muted-foreground"
                        )}
                      />
                      {item.label}
                    </IntentPrefetchLink>
                  )
                })}
              </SheetContent>
            </Sheet>
          </li>
        )}
      </ul>
    </nav>
  )
}
