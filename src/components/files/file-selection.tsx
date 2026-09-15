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
  selectAll: () => void
  selected: ReadonlySet<string>
  toggle: (id: string) => void
}

const FileSelectionContext = createContext<FileSelectionState | null>(null)

/**
 * Keeps the open folder's selection the way Finder does: ⌘- or Ctrl-click
 * adds or removes an item, Shift-click adds the run from the last one, ⌘A
 * takes the whole folder, and Escape clears. A plain click still opens.
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
        selectAll: () => setSelected(new Set(items.map((item: SelectableFile) => item.id))),
        selected,
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
 * Shift-click, and takes ⌘A and Escape while focus is inside it.
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

  return (
    <Element
      // Rows carry their state; a list item cannot, so a tile says it instead.
      aria-selected={Element === "div" && isSelected ? true : undefined}
      // A selected item keeps its tint under the pointer.
      className={cn(className, isSelected && "bg-secondary/70 hover:bg-secondary/70")}
      data-selected={isSelected || undefined}
      data-slot={slot}
      onClickCapture={handleClick}
      onKeyDown={handleKeyDown}
      role={role}
      style={style}
    >
      {children}
      {Element === "li" && isSelected ? <span className="sr-only">Selected</span> : null}
    </Element>
  )
}
