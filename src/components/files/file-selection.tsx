"use client"

import { createContext, type ReactElement, type ReactNode, useContext, useMemo } from "react"

import type { FileLifecycleAction } from "@/components/files/file-row-menu"
import type { MoveDestination } from "@/components/files/move-to-dialog"
import {
  SelectableItem,
  type SelectionState,
  SelectionProvider,
  useOpensOnRightClick,
  useSelection,
} from "@/components/data/selection"

export { useOpensOnRightClick }

/** One item the open folder shows, with the changes its member may make. */
export type SelectableFile = {
  id: string
  kind: "document" | "folder"
  labels: readonly FileLifecycleAction["label"][]
}

type FileExtras = {
  /** Every folder the member may move items into, for "Move to…". */
  destinations: readonly MoveDestination[]
  /** The folder these items are in, or null at the top level. */
  folderId: string | null
  lifecycle: "active" | "archived" | "trash"
}

type FileSelectionState = SelectionState<SelectableFile> & FileExtras

const FileExtrasContext = createContext<FileExtras | null>(null)

/**
 * Keeps the open folder's selection (see SelectionProvider), along with the
 * folders items may move to and the lifecycle view the folder is in.
 *
 * @param props - Everything in the folder, the ids it draws in order, and its
 *   lifecycle view.
 * @returns The selection around the workspace.
 */
export function FileSelection({
  children,
  destinations,
  folderId,
  items,
  lifecycle,
  shown,
}: {
  children: ReactNode
  destinations: readonly MoveDestination[]
  folderId: string | null
  items: readonly SelectableFile[]
  lifecycle: FileExtras["lifecycle"]
  shown: readonly string[]
}): ReactElement {
  const extras = useMemo(() => ({ destinations, folderId, lifecycle }), [destinations, folderId, lifecycle])

  return (
    <SelectionProvider items={items} scope={`${folderId ?? ""}:${lifecycle}`} shown={shown}>
      <FileExtrasContext.Provider value={extras}>{children}</FileExtrasContext.Provider>
    </SelectionProvider>
  )
}

/**
 * Reads the Files workspace's selection.
 *
 * @returns The selection, or null outside the Files workspace.
 */
export function useFileSelection(): FileSelectionState | null {
  const selection = useSelection<SelectableFile>()
  const extras = useContext(FileExtrasContext)

  return useMemo(() => (selection && extras ? { ...selection, ...extras } : null), [selection, extras])
}

/**
 * A List row or an Icons tile that joins the selection (see SelectableItem).
 *
 * @param props - The element to draw, its item, and its own attributes.
 * @returns The row or tile.
 */
export function SelectableFileItem(props: Omit<Parameters<typeof SelectableItem>[0], "checkSlot">): ReactElement {
  return <SelectableItem {...props} checkSlot="file-check" />
}
