"use client"

import { Check } from "lucide-react"
import {
  createContext,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"

/** What a selection offers, whatever the workspace it sits in. */
export type SelectionState<T extends { id: string } = { id: string }> = {
  clear: () => void
  extend: (id: string) => void
  /** Press and hold: adds the item, and on a phone starts selecting. */
  hold: (id: string) => void
  items: readonly T[]
  /** The screen is phone-narrow, where the tab bar shows. */
  narrow: boolean
  only: (id: string) => void
  /** A phone selects after a press and hold: taps tick, the bar holds actions. */
  phoneSelecting: boolean
  selectAll: () => void
  selected: ReadonlySet<string>
  /** The items drawn here, in order: what a run and ⌘A cover. */
  shown: readonly string[]
  toggle: (id: string) => void
}

const SelectionContext = createContext<SelectionState | null>(null)
// True inside a List row or an Icons tile, whose right-click opens its menu.
const OpensOnRightClickContext = createContext(false)

// The widths that show the phone's tab bar, as Tailwind's `max-md` does.
const NARROW = "(width < 48rem)"

function subscribeToWidth(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

// A navigation unmounts the workspace, so each list's selection waits here
// until the member comes back to it. Only the effect below writes, so nothing
// is ever kept on the server, and a cleared selection is dropped rather than
// held. A reload starts fresh, which is what reloading means.
const remembered = new Map<string, { byHold: boolean; selected: ReadonlySet<string> }>()

/**
 * Keeps a list's selection the way Finder does: ⌘- or Ctrl-click adds or
 * removes an item, Shift-click adds the run from the last one, ⌘A takes what
 * the list shows, Escape clears, and a right-click outside the selection
 * selects only that item. On a phone, press and hold starts a selection and
 * taps then tick items until Done. A plain click still opens.
 *
 * @param props - Where the list is (so coming back finds the same selection),
 *   everything in it, and the ids it draws in order.
 * @returns The selection around the workspace.
 */
export function SelectionProvider<T extends { id: string }>({
  children,
  items,
  scope,
  shown,
}: {
  children: ReactNode
  items: readonly T[]
  /** Names this list and view; a selection is kept per scope while away. */
  scope: string
  shown: readonly string[]
}): ReactElement {
  const here = scope
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => remembered.get(here)?.selected ?? new Set()
  )
  const [anchor, setAnchor] = useState<string | null>(null)
  // A press and hold began this selection, which is what puts a phone into
  // selecting; a mouse selection on a narrow window stays as on a desktop.
  const [byHold, setByHold] = useState(() => remembered.get(here)?.byHold ?? false)
  const narrow = useSyncExternalStore(
    subscribeToWidth,
    () => window.matchMedia(NARROW).matches,
    () => false
  )

  useEffect(() => {
    if (selected.size === 0) {
      remembered.delete(here)
    } else {
      remembered.set(here, { byHold, selected })
    }
  }, [byHold, here, selected])

  function toggle(id: string): void {
    setSelected((current: ReadonlySet<string>) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
    setAnchor(id)
  }

  function extend(id: string): void {
    const from = anchor === null ? -1 : shown.indexOf(anchor)
    const to = shown.indexOf(id)

    if (from < 0 || to < 0) {
      toggle(id)
      return
    }

    const run = shown.slice(Math.min(from, to), Math.max(from, to) + 1)
    setSelected((current: ReadonlySet<string>) => new Set([...current, ...run]))
  }

  // An item that leaves the folder leaves the selection with it. A search
  // narrows what is drawn, not what is in the folder, so it keeps them both.
  const present = new Set(items.map((item: T) => item.id))
  const current: ReadonlySet<string> = new Set(
    [...selected].filter((id: string) => present.has(id))
  )

  return (
    <SelectionContext.Provider
      value={{
        clear: () => {
          setSelected(new Set())
          setAnchor(null)
          setByHold(false)
        },
        extend,
        hold: (id: string) => {
          setSelected((previous: ReadonlySet<string>) => new Set([...previous, id]))
          setAnchor(id)
          setByHold(true)
        },
        items,
        narrow,
        only: (id: string) => {
          setSelected(new Set([id]))
          setAnchor(id)
          setByHold(false)
        },
        phoneSelecting: narrow && byHold && current.size > 0,
        selectAll: () => setSelected(new Set(shown)),
        selected: current,
        shown,
        toggle,
      }}
    >
      {children}
    </SelectionContext.Provider>
  )
}

/**
 * Reads the workspace's selection.
 *
 * @returns The selection, or null outside a selectable workspace.
 */
export function useSelection<T extends { id: string } = { id: string }>(): SelectionState<T> | null {
  return useContext(SelectionContext) as SelectionState<T> | null
}

/**
 * Says whether a menu sits in a row or tile that also opens it on right-click.
 *
 * @returns True inside a List row or an Icons tile.
 */
export function useOpensOnRightClick(): boolean {
  return useContext(OpensOnRightClickContext)
}

/**
 * A row or a tile that joins the selection on a ⌘-, Ctrl-, or
 * Shift-click, takes ⌘A and Escape while focus is inside it, and opens its
 * item's menu on right-click. On a phone, press and hold selects it instead,
 * and while the phone selects, a tap ticks it behind a round check.
 *
 * @param props - The element to draw, its item, and its own attributes.
 * @returns The row or tile.
 */
export function SelectableItem({
  as: Element = "div",
  checkSlot,
  children,
  className,
  itemId,
  role,
  slot,
  style,
}: {
  as?: "div" | "li"
  /** The data-slot of the round check a phone shows while selecting. */
  checkSlot: string
  children: ReactNode
  className?: string
  itemId: string
  role?: string
  slot: string
  style?: CSSProperties
}): ReactElement {
  const selection = useContext(SelectionContext)
  const isSelected = selection?.selected.has(itemId) ?? false
  const ticking = selection?.phoneSelecting ?? false
  // What last pressed this item, and whether that press was held to select it,
  // so the click that ends the hold is not taken for a tap.
  const pointer = useRef("mouse")
  const held = useRef(false)

  function handleClick(event: MouseEvent<HTMLElement>): void {
    if (!selection) {
      return
    }

    const adds = event.metaKey || event.ctrlKey
    // While a phone selects, a tap ticks or unticks instead of opening.
    const taps = ticking && pointer.current === "touch"

    if (!adds && !event.shiftKey && !taps) {
      return
    }

    // A modified click or a tap selects instead of opening.
    event.preventDefault()
    event.stopPropagation()

    if (taps) {
      if (held.current) {
        held.current = false
      } else {
        selection.toggle(itemId)
      }
    } else if (adds) {
      selection.toggle(itemId)
    } else {
      selection.extend(itemId)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (!selection) {
      return
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault()
      selection.selectAll()
    } else if (event.key === "Escape" && selection.selected.size > 0) {
      selection.clear()
    }
  }

  function handleContextMenu(): void {
    // A phone's press and hold is handled when the menu tries to open.
    if (pointer.current === "touch" && selection?.narrow) {
      return
    }

    // The menu acts on the selection, so an item outside it becomes the selection.
    if (selection && !isSelected) {
      selection.only(itemId)
    }
  }

  return (
    <ContextMenu
      onOpenChange={(open, details) => {
        // On a phone, press and hold selects instead of opening the menu.
        if (open && pointer.current === "touch" && selection?.narrow) {
          details.cancel()
          held.current = true
          selection.hold(itemId)
        }
      }}
    >
      <ContextMenuTrigger
        // Rows carry their state; a list item cannot, so a tile says it instead.
        aria-selected={Element === "div" && isSelected ? true : undefined}
        // A selected item keeps its tint under the pointer.
        className={cn(
          className,
          isSelected && "bg-secondary/70 hover:bg-secondary/70",
          ticking && "relative"
        )}
        data-selected={isSelected || undefined}
        data-slot={slot}
        onClickCapture={handleClick}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          pointer.current = event.pointerType
          held.current = false
        }}
        render={<Element />}
        role={role}
        style={style}
      >
        <OpensOnRightClickContext.Provider value={true}>
          {children}
        </OpensOnRightClickContext.Provider>
        {ticking ? (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute grid size-[22px] place-items-center rounded-full border-[1.5px] md:hidden",
              Element === "li" ? "top-2 left-2" : "top-1/2 left-0.5 -translate-y-1/2",
              isSelected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/45 bg-background"
            )}
            data-slot={checkSlot}
          >
            {isSelected ? <Check className="size-3.5" strokeWidth={3} /> : null}
          </span>
        ) : null}
        {Element === "li" && isSelected ? <span className="sr-only">Selected</span> : null}
      </ContextMenuTrigger>
    </ContextMenu>
  )
}
