"use client"

import {
  createContext,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useContext,
  useState,
} from "react"

import type { FileLifecycleAction } from "@/components/files/file-row-menu"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"

/** One item the open folder shows, with the changes its member may make. */
export type SelectableFile = {
  id: string
  kind: "document" | "folder"
  labels: readonly FileLifecycleAction["label"][]
}

type FileSelectionState = {
  clear: () => void
  extend: (id: string) => void
  items: readonly SelectableFile[]
  lifecycle: "active" | "archived" | "trash"
  only: (id: string) => void
  selectAll: () => void
  selected: ReadonlySet<string>
  toggle: (id: string) => void
}

const FileSelectionContext = createContext<FileSelectionState | null>(null)
// True inside a List row or an Icons tile, whose right-click opens its menu.
const OpensOnRightClickContext = createContext(false)

/**
 * Keeps the open folder's selection the way Finder does: ⌘- or Ctrl-click
 * adds or removes an item, Shift-click adds the run from the last one, ⌘A
 * takes the whole folder, Escape clears, and a right-click outside the
 * selection selects only that item. A plain click still opens.
 *
 * @param props - The folder's items in the order shown, and its lifecycle view.
 * @returns The selection around the workspace.
 */
export function FileSelection({
  children,
  items,
  lifecycle,
}: {
  children: ReactNode
  items: readonly SelectableFile[]
  lifecycle: FileSelectionState["lifecycle"]
}): ReactElement {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [anchor, setAnchor] = useState<string | null>(null)

  function toggle(id: string): void {
    setSelected((current: ReadonlySet<string>) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
    setAnchor(id)
  }

  function extend(id: string): void {
    const ids = items.map((item: SelectableFile) => item.id)
    const from = anchor === null ? -1 : ids.indexOf(anchor)
    const to = ids.indexOf(id)

    if (from < 0 || to < 0) {
      toggle(id)
      return
    }

    const run = ids.slice(Math.min(from, to), Math.max(from, to) + 1)
    setSelected((current: ReadonlySet<string>) => new Set([...current, ...run]))
  }

  // An item that leaves the folder leaves the selection with it.
  const present = new Set(items.map((item: SelectableFile) => item.id))
  const current: ReadonlySet<string> = new Set(
    [...selected].filter((id: string) => present.has(id))
  )

  return (
    <FileSelectionContext.Provider
      value={{
        clear: () => {
          setSelected(new Set())
          setAnchor(null)
        },
        extend,
        items,
        lifecycle,
        only: (id: string) => {
          setSelected(new Set([id]))
          setAnchor(id)
        },
        selectAll: () => setSelected(new Set(present)),
        selected: current,
        toggle,
      }}
    >
      {children}
    </FileSelectionContext.Provider>
  )
}

/**
 * Reads the Files workspace's selection.
 *
 * @returns The selection, or null outside the Files workspace.
 */
export function useFileSelection(): FileSelectionState | null {
  return useContext(FileSelectionContext)
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
 * Says how many items are selected, beside the title, once any are.
 *
 * @returns A polite live region holding the count.
 */
export function SelectedCount(): ReactElement {
  const count = useContext(FileSelectionContext)?.selected.size ?? 0

  return (
    <span
      aria-live="polite"
      className="ml-2 text-base font-normal tracking-normal text-muted-foreground"
      data-slot="file-selected-count"
    >
      {count > 0 ? `· ${count} selected` : null}
    </span>
  )
}

/**
 * A List row or an Icons tile that joins the selection on a ⌘-, Ctrl-, or
 * Shift-click, takes ⌘A and Escape while focus is inside it, and opens its
 * item's menu on right-click.
 *
 * @param props - The element to draw, its item, and its own attributes.
 * @returns The row or tile.
 */
export function SelectableFileItem({
  as: Element = "div",
  children,
  className,
  itemId,
  role,
  slot,
  style,
}: {
  as?: "div" | "li"
  children: ReactNode
  className?: string
  itemId: string
  role?: string
  slot: string
  style?: CSSProperties
}): ReactElement {
  const selection = useContext(FileSelectionContext)
  const isSelected = selection?.selected.has(itemId) ?? false

  function handleClick(event: MouseEvent<HTMLElement>): void {
    const adds = event.metaKey || event.ctrlKey

    if (!selection || (!adds && !event.shiftKey)) {
      return
    }

    // A modified click selects instead of opening.
    event.preventDefault()
    event.stopPropagation()

    if (adds) {
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
    // The menu acts on the selection, so an item outside it becomes the selection.
    if (selection && !isSelected) {
      selection.only(itemId)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        // Rows carry their state; a list item cannot, so a tile says it instead.
        aria-selected={Element === "div" && isSelected ? true : undefined}
        // A selected item keeps its tint under the pointer.
        className={cn(className, isSelected && "bg-secondary/70 hover:bg-secondary/70")}
        data-selected={isSelected || undefined}
        data-slot={slot}
        onClickCapture={handleClick}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        render={<Element />}
        role={role}
        style={style}
      >
        <OpensOnRightClickContext.Provider value={true}>
          {children}
        </OpensOnRightClickContext.Provider>
        {Element === "li" && isSelected ? <span className="sr-only">Selected</span> : null}
      </ContextMenuTrigger>
    </ContextMenu>
  )
}
