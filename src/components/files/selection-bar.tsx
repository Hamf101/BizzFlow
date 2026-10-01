"use client"

import { FolderInput, UserPlus } from "lucide-react"
import { type ReactElement, useState } from "react"

import { BAR_BUTTON, SelectionBarShell } from "@/components/data/selection-bar"
import {
  ACTION_ICONS,
  describeBulk,
  type FileLifecycleAction,
  useSelectionChanges,
} from "@/components/files/file-row-menu"
import { shareableResources, useFileSelection } from "@/components/files/file-selection"
import { MoveToDialog } from "@/components/files/move-to-dialog"
import { ShareDialog } from "@/components/sharing/share-dialog"

type Shown = { count: number; labels: FileLifecycleAction["label"][] }

/**
 * The Files selection's bar (see SelectionBarShell): Move, and the lifecycle
 * changes every selected item allows. On a phone each change is an icon.
 *
 * @returns The selection bar.
 */
export function SelectionBar(): ReactElement {
  const selection = useFileSelection()
  const targets = selection
    ? selection.items.filter((item) => selection.selected.has(item.id))
    : []
  const open = targets.length > 0
  const { labels, run } = useSelectionChanges(open ? targets : null)
  const [moving, setMoving] = useState(false)
  const [sharing, setSharing] = useState(false)
  const share = shareableResources(targets)
  // Only active items move, which is exactly where Archive is offered.
  const moves = labels.includes("Archive")
  // What the bar last showed, so it keeps its words while it sinks away.
  const [shown, setShown] = useState<Shown>({ count: 0, labels: [] })

  if (open && (shown.count !== targets.length || shown.labels.join() !== labels.join())) {
    setShown({ count: targets.length, labels })
  }

  return (
    <SelectionBarShell count={shown.count} onClear={selection?.clear} open={open}>
      {share ? (
        <button
          aria-label={`Share ${share.length} ${share.length === 1 ? "item" : "items"}`}
          className={BAR_BUTTON}
          onClick={() => setSharing(true)}
          type="button"
        >
          <UserPlus aria-hidden="true" className="size-4 opacity-80" />
          <span className="max-md:hidden">Share</span>
        </button>
      ) : null}
      {moves ? (
        <button
          aria-label={`Move ${shown.count} ${shown.count === 1 ? "item" : "items"}`}
          className={BAR_BUTTON}
          onClick={() => setMoving(true)}
          type="button"
        >
          <FolderInput aria-hidden="true" className="size-4 opacity-80" />
          <span className="max-md:hidden">Move</span>
        </button>
      ) : null}
      {shown.labels.map((label: FileLifecycleAction["label"]) => {
        const Icon = ACTION_ICONS[label]

        return (
          <button
            aria-label={describeBulk(label, shown.count)}
            className={BAR_BUTTON}
            key={label}
            onClick={() => run(label)}
            type="button"
          >
            <Icon aria-hidden="true" className="size-4 opacity-80" />
            <span className="max-md:hidden">{label}</span>
          </button>
        )
      })}
      {share ? <ShareDialog name="" onOpenChange={setSharing} open={sharing} resources={share} /> : null}
      {selection && moves ? (
        <MoveToDialog
          destinations={selection.destinations}
          folderId={selection.folderId}
          items={targets}
          onOpenChange={setMoving}
          open={moving}
        />
      ) : null}
    </SelectionBarShell>
  )
}
