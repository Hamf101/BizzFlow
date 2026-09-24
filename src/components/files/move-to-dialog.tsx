"use client"

import { ChevronLeft, ChevronRight, Folder, FolderOpen } from "lucide-react"
import { type ReactElement, useState, useTransition } from "react"

import { moveFilesAction } from "@/app/(dashboard)/documents/actions"
import type { SelectableFile } from "@/components/files/file-selection"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { bizflowToast } from "@/components/ui/toaster"

/** One folder an item can move into. */
export type MoveDestination = {
  id: string
  name: string
  parentFolderId: string | null
}

const ROW =
  "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
const TOP = "Files"

/**
 * Asks where a selection should go, one folder at a time as Finder does, then
 * moves it with an Undo toast. A folder's own branch is never offered.
 *
 * @param props - The items to move, every folder they may move into, the
 *   folder they are in now, and the open state.
 * @returns The move dialog.
 */
export function MoveToDialog({
  destinations,
  folderId,
  items,
  onOpenChange,
  open,
}: {
  destinations: readonly MoveDestination[]
  folderId: string | null
  items: readonly SelectableFile[]
  onOpenChange: (open: boolean) => void
  open: boolean
}): ReactElement {
  const [browsing, setBrowsing] = useState<string | null>(folderId)
  const [, startTransition] = useTransition()
  const allowed = withoutOwnBranch(destinations, items)
  const here = childrenOf(browsing, allowed)

  function move(destinationFolderId: string | null): void {
    onOpenChange(false)
    startTransition(async () => {
      try {
        const result = await moveFilesAction({
          destinationFolderId,
          documentIds: items
            .filter((item: SelectableFile) => item.kind === "document")
            .map((item: SelectableFile) => item.id),
          folderIds: items
            .filter((item: SelectableFile) => item.kind === "folder")
            .map((item: SelectableFile) => item.id),
        })

        announce(result, destinationFolderId, folderId, destinations)
      } catch {
        bizflowToast.error("Those files could not be moved. Try again.")
      }
    })
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader>
          <DialogTitle>Move {describeItems(items)}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          {browsing === null ? null : (
            <button
              aria-label="Back"
              className="grid size-7 place-items-center rounded-[8px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() => setBrowsing(parentOf(browsing, destinations))}
              type="button"
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </button>
          )}
          <span className="truncate">
            {browsing === null ? TOP : pathOf(byId(browsing, destinations), destinations)}
          </span>
        </div>
        <ul className="-mx-1 max-h-72 min-h-40 overflow-y-auto px-1">
          {here.map((folder: MoveDestination) => (
            <li key={folder.id}>
              <button className={ROW} onClick={() => setBrowsing(folder.id)} type="button">
                <Folder aria-hidden="true" className="size-4 text-muted-foreground" />
                <span className="truncate">{folder.name}</span>
                <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
              </button>
            </li>
          ))}
          {here.length === 0 ? (
            <li className="px-2.5 py-2 text-sm text-muted-foreground">No folders here.</li>
          ) : null}
        </ul>
        <div className="flex justify-end">
          <Button disabled={browsing === folderId} onClick={() => move(browsing)}>
            <FolderOpen aria-hidden="true" />
            Move here
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Names what is moving, such as "3 items" or the one item's kind.
 *
 * @param items - The items to move.
 * @returns The phrase that follows "Move".
 */
function describeItems(items: readonly SelectableFile[]): string {
  return items.length === 1
    ? items[0]?.kind === "folder"
      ? "folder"
      : "file"
    : `${items.length} items`
}

/**
 * Keeps a folder's own branch out of the picker, which no move may enter.
 *
 * @param destinations - Every folder the member may move into.
 * @param items - The items being moved.
 * @returns The folders that can take them.
 */
function withoutOwnBranch(
  destinations: readonly MoveDestination[],
  items: readonly SelectableFile[]
): MoveDestination[] {
  const moving = new Set(
    items
      .filter((item: SelectableFile) => item.kind === "folder")
      .map((item: SelectableFile) => item.id)
  )

  return destinations.filter((folder: MoveDestination) => {
    for (
      let at: MoveDestination | null = folder;
      at;
      at = at.parentFolderId ? byId(at.parentFolderId, destinations) : null
    ) {
      if (moving.has(at.id)) {
        return false
      }
    }

    return true
  })
}

function byId(
  id: string,
  destinations: readonly MoveDestination[]
): MoveDestination | null {
  return destinations.find((folder: MoveDestination) => folder.id === id) ?? null
}

function parentOf(id: string, destinations: readonly MoveDestination[]): string | null {
  return byId(id, destinations)?.parentFolderId ?? null
}

/**
 * Lists one folder's subfolders in the order Files shows them.
 *
 * @param parentFolderId - The folder being browsed, or null for the top level.
 * @param destinations - The folders that can take the items.
 * @returns Its subfolders, by name.
 */
function childrenOf(
  parentFolderId: string | null,
  destinations: readonly MoveDestination[]
): MoveDestination[] {
  return destinations
    .filter((folder: MoveDestination) => folder.parentFolderId === parentFolderId)
    .sort((left: MoveDestination, right: MoveDestination) =>
      left.name.localeCompare(right.name)
    )
}

/**
 * Writes a folder's place as a path, such as "Clients › 2026".
 *
 * @param folder - The folder to name, or null for the top level.
 * @param destinations - Every folder, to walk back up the tree.
 * @returns The path, from the top level down.
 */
function pathOf(
  folder: MoveDestination | null,
  destinations: readonly MoveDestination[]
): string {
  const names: string[] = []

  for (
    let at = folder;
    at;
    at = at.parentFolderId ? byId(at.parentFolderId, destinations) : null
  ) {
    names.unshift(at.name)
  }

  return names.join(" › ") || TOP
}

/**
 * Says where the items went and offers to put them back.
 *
 * @param result - What moved and what could not.
 * @param destinationFolderId - Where they went.
 * @param from - Where they were, for Undo.
 * @param destinations - Every folder, to name the destination.
 */
function announce(
  result: { documentIds: string[]; failed: number; folderIds: string[] },
  destinationFolderId: string | null,
  from: string | null,
  destinations: readonly MoveDestination[]
): void {
  if (result.documentIds.length + result.folderIds.length === 0) {
    bizflowToast.error("Those files could not be moved. Try again.")
    return
  }

  const destination =
    destinationFolderId === null
      ? TOP
      : (byId(destinationFolderId, destinations)?.name ?? TOP)

  bizflowToast.success(`Moved to ${destination}`, {
    action: {
      label: "Undo",
      onClick: () => {
        moveFilesAction({
          destinationFolderId: from,
          documentIds: result.documentIds,
          folderIds: result.folderIds,
        })
          .then(() => bizflowToast.success("Undone"))
          .catch(() => bizflowToast.error("That could not be undone."))
      },
    },
    description:
      result.failed > 0
        ? "The rest changed since you looked, or aren't yours to move."
        : undefined,
  })
}
