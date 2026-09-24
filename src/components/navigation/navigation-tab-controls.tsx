"use client"

import type {
  HTMLAttributes,
  KeyboardEvent,
  ReactElement,
  ReactNode,
} from "react"

import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/**
 * Wraps one sidebar tab. The whole tab drags to a new place, and a right click
 * (or a long press, the menu key, or Shift+F10) opens its menu where the
 * pointer is: the link's own actions, then Rename for the owner, then Move up
 * and Move down. Alt with an arrow key moves a focused tab one place.
 *
 * @param props - The tab, its neighbours, and the drag its parent coordinates.
 * @returns The tab with its drag behaviour and right-click menu.
 */
export function NavigationTabControls({
  canRename,
  children,
  disabled,
  dragProps,
  dragging,
  href,
  next,
  onMove,
  onRename,
  previous,
  register,
}: {
  canRename: boolean
  children: ReactNode
  disabled: boolean
  /** Pointer handlers from the parent, which moves the other tabs aside. */
  dragProps: HTMLAttributes<HTMLDivElement>
  dragging: boolean
  href: string
  next?: string
  onMove: (target: string) => void
  onRename: () => void
  previous?: string
  register: (element: HTMLDivElement | null) => void
}): ReactElement {
  function moveWithKeyboard(event: KeyboardEvent<HTMLDivElement>): void {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
      return
    }

    event.preventDefault()
    const target = event.key === "ArrowUp" ? previous : next

    if (target && !disabled) {
      onMove(target)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        {...dragProps}
        className={cn(
          // The tab itself is the handle, so a press must not select its text
          // or pan the sidebar.
          "relative min-w-0 touch-none rounded-[8px] select-none",
          dragging && "z-10 bg-card shadow-lg"
        )}
        data-dragging={dragging || undefined}
        data-navigation-href={href}
        onKeyDown={moveWithKeyboard}
        ref={register}
      >
        {children}
      </ContextMenuTrigger>
      <DropdownMenuContent className="w-44">
        <DropdownMenuItem
          onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
        >
          Open in new tab
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            void navigator.clipboard?.writeText(
              new URL(href, window.location.origin).toString()
            )
          }
        >
          Copy link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {canRename ? (
          <DropdownMenuItem disabled={disabled} onClick={onRename}>
            Rename
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          disabled={!previous || disabled}
          onClick={() => previous && onMove(previous)}
        >
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!next || disabled}
          onClick={() => next && onMove(next)}
        >
          Move down
        </DropdownMenuItem>
      </DropdownMenuContent>
    </ContextMenu>
  )
}
