"use client"

import type { ReactElement } from "react"

import {
  ACTION_ICONS,
  describeBulk,
  type FileLifecycleAction,
  useSelectionChanges,
} from "@/components/files/file-row-menu"
import { useFileSelection } from "@/components/files/file-selection"
import { MOBILE_TAB_BAR_HEIGHT_CLASS } from "@/components/navigation/mobile-tab-bar"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The bar's short names; each button's full name still says what it does.
const SHORT_LABELS: Record<FileLifecycleAction["label"], string> = {
  Archive: "Archive",
  "Move to Trash": "Trash",
  Restore: "Restore",
}

/**
 * While a phone selects, pins the count with Select all and Done over the top
 * bar, and turns the tab bar into the selection's actions: each change every
 * selected item allows, with Undo after. Both bars float over the page, so
 * nothing moves under the finger that started selecting.
 *
 * @returns The two bars, or nothing while no phone selects.
 */
export function PhoneSelectionBars(): ReactElement | null {
  const selection = useFileSelection()
  const targets = selection?.phoneSelecting
    ? selection.items.filter((item) => selection.selected.has(item.id))
    : []
  const { labels, run } = useSelectionChanges(targets.length > 0 ? targets : null)

  if (!selection || targets.length === 0) {
    return null
  }

  return (
    <>
      {/* Covers the phone's top bar, whose 54px account button makes it 71px. */}
      <div
        className="fixed inset-x-0 top-0 z-50 flex min-h-[4.5rem] items-center gap-1 border-b border-border bg-card px-4 py-2 md:hidden"
        data-slot="phone-selection-header"
      >
        <p
          aria-live="polite"
          className="mr-auto text-xl leading-none font-medium tracking-[-0.01em]"
        >
          {targets.length} selected
        </p>
        <Button
          className="px-2 text-[15px] font-normal text-primary"
          onClick={selection.selectAll}
          type="button"
          variant="ghost"
        >
          Select all
        </Button>
        <Button
          className="px-2 text-[15px] font-semibold text-primary"
          onClick={selection.clear}
          type="button"
          variant="ghost"
        >
          Done
        </Button>
      </div>
      <nav
        aria-label="Selection actions"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {labels.length > 0 ? (
          <ul
            className={cn("grid", MOBILE_TAB_BAR_HEIGHT_CLASS)}
            style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}
          >
            {labels.map((label: FileLifecycleAction["label"]) => {
              const Icon = ACTION_ICONS[label]

              return (
                <li className="contents" key={label}>
                  <button
                    aria-label={describeBulk(label, targets.length)}
                    className="flex flex-col items-center justify-center gap-1 text-[10px] leading-none font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
                    onClick={() => run(label)}
                    type="button"
                  >
                    <Icon aria-hidden="true" className="size-5" />
                    {SHORT_LABELS[label]}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p
            className={cn(
              "grid place-items-center text-xs text-muted-foreground",
              MOBILE_TAB_BAR_HEIGHT_CLASS
            )}
          >
            No change fits every selected item
          </p>
        )}
      </nav>
    </>
  )
}
