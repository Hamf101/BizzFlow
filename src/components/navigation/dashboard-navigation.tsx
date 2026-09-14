"use client"

import { usePathname } from "next/navigation"
import {
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from "react"

import { IntentPrefetchLink } from "@/components/navigation/intent-prefetch-link"
import { getVisibleNavigationItems } from "@/components/navigation/navigation-items"
import { useNavigationPreferences } from "@/components/navigation/navigation-preferences-provider"
import { NavigationTabControls } from "@/components/navigation/navigation-tab-controls"
import { RenameNavigationDialog } from "@/components/navigation/rename-navigation-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { OrganizationPermissionSubject } from "@/lib/permissions"
import { cn } from "@/lib/utils"

/** How far a mouse or pen travels before a press becomes a drag, in pixels. */
const DRAG_THRESHOLD = 6

/** How long a finger rests on a tab before it can drag it, in milliseconds. */
const TOUCH_HOLD_MS = 250

/** How long the other tabs take to slide aside, in milliseconds. */
const SHIFT_MS = 160

const SHIFT_EASING = "cubic-bezier(0.2, 0, 0, 1)"

/** One press on a tab, from pointer down until it lets go. */
type Gesture = {
  /** Whether the press may become a drag; a finger must rest first. */
  armed: boolean
  /** How far below the tab's top the pointer took hold of it. */
  grab: number
  href: string
  pointerId: number
  started: boolean
  startX: number
  startY: number
  timer: number | null
  /** The pointer's latest height on screen. */
  y: number
}

/**
 * Renders the route-aware dashboard navigation using the Editorial Ledger style.
 *
 * Where a workspace's preferences are available, each tab drags to a new place
 * while the others slide aside, and a right click opens the tab's menu.
 *
 * @returns A compact navigation rail with a visible current-page marker.
 */
export function DashboardNavigation({
  collapsed = false,
  role,
}: {
  collapsed?: boolean
  role: OrganizationPermissionSubject | null
}): ReactElement {
  const pathname = usePathname()
  const customization = useNavigationPreferences()
  const navigationItems = getVisibleNavigationItems(
    role,
    customization?.preferences
  )
  // The order shown while a tab is being dragged, before it is saved.
  const [draft, setDraft] = useState<{ href: string; order: string[] } | null>(
    null
  )
  const [renaming, setRenaming] = useState<{
    href: string
    label: string
  } | null>(null)
  const navigation = useRef<HTMLElement>(null)
  const tabs = useRef(new Map<string, HTMLDivElement>())
  const gesture = useRef<Gesture | null>(null)
  const latestDraft = useRef(draft)
  const slotsBefore = useRef<Map<string, number> | null>(null)
  const suppressClick = useRef(false)
  const canDrag = Boolean(customization) && !customization?.saving
  const savedOrder = navigationItems.map((item) => item.href)
  const itemsByHref = new Map(navigationItems.map((item) => [item.href, item]))
  const shownItems = draft
    ? draft.order.flatMap((href) => itemsByHref.get(href) ?? [])
    : navigationItems

  // The tabs a drag passed have moved to new slots; slide each from where it
  // was, then keep the dragged tab under the pointer.
  useLayoutEffect(() => {
    const before = slotsBefore.current
    slotsBefore.current = null

    if (before && !prefersReducedMotion()) {
      for (const [href, top] of before) {
        const tab = tabs.current.get(href)
        const shift = tab ? top - tab.offsetTop : 0

        if (tab && shift !== 0 && href !== gesture.current?.href) {
          slide(tab, `translateY(${shift}px)`)
        }
      }
    }

    followPointer(
      navigation.current,
      gesture.current ? tabs.current.get(gesture.current.href) : undefined,
      gesture.current
    )
  }, [draft])

  function saveOrder(order: string[]): void {
    if (!customization) {
      return
    }

    // Preserve hidden destinations so later permission changes do not discard preferences.
    const hidden = customization.preferences.order.filter(
      (href) => !order.includes(href)
    )
    const nextOrder = [...order, ...hidden]
    void customization.save(nextOrder, nextOrder)
  }

  function move(href: string, target: string): void {
    if (!customization || customization.saving || href === target) {
      return
    }

    const order = [...savedOrder]
    const from = order.indexOf(href)
    const to = order.indexOf(target)

    if (from < 0 || to < 0) {
      return
    }

    order.splice(from, 1)
    order.splice(to, 0, href)
    saveOrder(order)
  }

  function showDraft(next: { href: string; order: string[] } | null): void {
    latestDraft.current = next
    setDraft(next)
  }

  function endGesture(commit: boolean): void {
    const ended = gesture.current
    gesture.current = null

    if (ended?.timer) {
      window.clearTimeout(ended.timer)
    }

    if (!ended?.started) {
      return
    }

    const tab = tabs.current.get(ended.href)

    // Let the tab settle into its slot rather than jump there.
    if (tab) {
      const lifted = tab.style.transform
      tab.style.transform = ""

      if (lifted && !prefersReducedMotion()) {
        slide(tab, lifted)
      }
    }

    const order = latestDraft.current?.order
    showDraft(null)
    // A drag ends with a click on the tab it dropped; that click must not open it.
    suppressClick.current = true
    window.setTimeout(() => {
      suppressClick.current = false
    }, 0)

    if (commit && order && order.join() !== savedOrder.join()) {
      saveOrder(order)
    }
  }

  const dragProps = {
    onClickCapture(event: MouseEvent<HTMLDivElement>): void {
      if (suppressClick.current) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    onPointerCancel(event: PointerEvent<HTMLDivElement>): void {
      if (gesture.current?.pointerId === event.pointerId) {
        endGesture(false)
      }
    },
    onPointerDown(event: PointerEvent<HTMLDivElement>): void {
      const href = event.currentTarget.dataset.navigationHref
      const tab = href ? tabs.current.get(href) : undefined
      const nav = navigation.current

      // Only a plain primary press drags; Ctrl-click is a right click on a Mac.
      if (!canDrag || !href || !tab || !nav || event.button !== 0 || event.ctrlKey) {
        return
      }

      // A press whose pointer was lost elsewhere never ended; start afresh.
      endGesture(false)
      const touch = event.pointerType === "touch"
      const pressed: Gesture = {
        armed: !touch,
        grab: event.clientY - nav.getBoundingClientRect().top - tab.offsetTop,
        href,
        pointerId: event.pointerId,
        started: false,
        startX: event.clientX,
        startY: event.clientY,
        timer: null,
        y: event.clientY,
      }

      if (touch) {
        pressed.timer = window.setTimeout(() => {
          pressed.armed = true
        }, TOUCH_HOLD_MS)
      }

      gesture.current = pressed
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>): void {
      const current = gesture.current
      const nav = navigation.current

      if (!current || !nav || current.pointerId !== event.pointerId) {
        return
      }

      current.y = event.clientY

      if (!current.started) {
        const travelled = Math.hypot(
          event.clientX - current.startX,
          event.clientY - current.startY
        )

        if (travelled < DRAG_THRESHOLD) {
          return
        }

        // A finger that moves before it rests is tapping or scrolling.
        if (!current.armed) {
          endGesture(false)
          return
        }

        current.started = true
        // From here every move reaches this tab, wherever the pointer goes.
        if (typeof event.currentTarget.setPointerCapture === "function") {
          event.currentTarget.setPointerCapture(event.pointerId)
        }
        showDraft({ href: current.href, order: savedOrder })
      }

      event.preventDefault()
      const order = latestDraft.current?.order ?? savedOrder
      const next = orderUnderPointer(order, current, nav, tabs.current)

      if (next.join() === order.join()) {
        followPointer(nav, tabs.current.get(current.href), current)
        return
      }

      slotsBefore.current = new Map(
        order.map((href) => [href, tabs.current.get(href)?.offsetTop ?? 0])
      )
      showDraft({ href: current.href, order: next })
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>): void {
      if (gesture.current?.pointerId === event.pointerId) {
        endGesture(true)
      }
    },
  }

  return (
    <TooltipProvider>
      <nav
        aria-label="Primary navigation"
        className={cn("relative flex flex-col gap-1", draft && "cursor-grabbing")}
        ref={navigation}
      >
        {shownItems.map((item, index) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`)
          const Icon = item.icon
          const navigationLink = (
            <IntentPrefetchLink
              aria-current={isActive ? "page" : undefined}
              aria-label={collapsed ? item.label : undefined}
              className={cn(
                "group relative flex min-h-11 items-center gap-3 rounded-[8px] px-3 py-2 text-sm text-foreground/80 transition-colors motion-reduce:transition-none",
                "hover:bg-secondary/70 hover:text-foreground",
                isActive && "bg-secondary text-secondary-foreground",
                collapsed &&
                  "md:size-11 md:self-center md:justify-center md:p-0"
              )}
              // The pointer drag below moves tabs; the browser's own link drag
              // would take the press away from it.
              draggable={false}
              href={item.href}
            >
              <Icon
                className={cn(
                  "size-4 text-foreground/80 transition-colors",
                  isActive && "text-primary",
                  collapsed && "md:size-5"
                )}
              />
              <span
                className={cn(
                  "truncate motion-reduce:transform-none motion-reduce:transition-none md:transition-[opacity,transform] md:duration-150",
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
            </IntentPrefetchLink>
          )

          const tab = (
            <Tooltip disabled={!collapsed || draft !== null}>
              <TooltipTrigger render={navigationLink} />
              <TooltipContent className="hidden md:inline-flex" side="right">
                {item.label}
              </TooltipContent>
            </Tooltip>
          )

          if (!customization) {
            return <div key={item.href}>{tab}</div>
          }

          return (
            <NavigationTabControls
              canRename={customization.preferences.canRename}
              disabled={customization.saving}
              dragProps={dragProps}
              dragging={draft?.href === item.href}
              href={item.href}
              key={item.href}
              next={draft ? undefined : navigationItems[index + 1]?.href}
              onMove={(target) => move(item.href, target)}
              onRename={() => setRenaming(item)}
              previous={draft ? undefined : navigationItems[index - 1]?.href}
              register={(element) => {
                if (element) {
                  tabs.current.set(item.href, element)
                } else {
                  tabs.current.delete(item.href)
                }
              }}
            >
              {tab}
            </NavigationTabControls>
          )
        })}
      </nav>
      {customization?.error && !renaming ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {customization.error}
        </p>
      ) : null}
      {customization?.saving ? (
        <p className="sr-only" role="status">
          Saving tab preferences…
        </p>
      ) : null}
      {renaming && customization ? (
        <RenameNavigationDialog
          error={customization.error}
          key={renaming.href}
          label={renaming.label}
          onClose={() => setRenaming(null)}
          onSave={(label) =>
            customization.save({
              expectedRevision: customization.preferences.revision,
              href: renaming.href,
              label,
            })
          }
          saving={customization.saving}
        />
      ) : null}
    </TooltipProvider>
  )
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/** Slides a tab from a transform back to its own slot. */
function slide(tab: HTMLElement, from: string): void {
  if (typeof tab.animate === "function") {
    tab.animate([{ transform: from }, { transform: "translateY(0)" }], {
      duration: SHIFT_MS,
      easing: SHIFT_EASING,
    })
  }
}

/** Keeps the dragged tab under the pointer, wherever its slot now is. */
function followPointer(
  nav: HTMLElement | null,
  tab: HTMLElement | undefined,
  gesture: Gesture | null
): void {
  if (!nav || !tab || !gesture?.started) {
    return
  }

  const offset =
    gesture.y - nav.getBoundingClientRect().top - gesture.grab - tab.offsetTop
  tab.style.transform = `translateY(${offset}px)`
}

/**
 * Places the dragged tab after every other tab whose middle sits above the
 * dragged tab's middle. Slots are read without transforms, so tabs still
 * sliding aside do not make the order flicker.
 */
function orderUnderPointer(
  order: readonly string[],
  gesture: Gesture,
  nav: HTMLElement,
  tabs: ReadonlyMap<string, HTMLElement>
): string[] {
  const dragged = tabs.get(gesture.href)
  const middle =
    gesture.y -
    nav.getBoundingClientRect().top -
    gesture.grab +
    (dragged?.offsetHeight ?? 0) / 2
  const others = order.filter((href) => href !== gesture.href)
  const index = others.filter((href) => {
    const tab = tabs.get(href)

    return tab !== undefined && tab.offsetTop + tab.offsetHeight / 2 < middle
  }).length

  return [...others.slice(0, index), gesture.href, ...others.slice(index)]
}
