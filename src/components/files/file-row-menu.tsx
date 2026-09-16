"use client"

import { Archive, Ellipsis, RotateCcw, Trash2 } from "lucide-react"
import { type ReactElement, type ReactNode, useState, useTransition } from "react"

import {
  changeFilesLifecycleAction,
  type FileLifecycleChange,
  type FileLifecycleResult,
} from "@/app/(dashboard)/documents/actions"
import {
  type SelectableFile,
  useFileSelection,
  useOpensOnRightClick,
} from "@/components/files/file-selection"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { bizflowToast } from "@/components/ui/toaster"
import { cn } from "@/lib/utils"

/** One lifecycle change a row offers, posted to its server action. */
export type FileLifecycleAction = {
  fields: Readonly<Record<string, string>>
  formAction: (formData: FormData) => Promise<void>
  label: "Archive" | "Move to Trash" | "Restore"
}

type LifecycleLabel = FileLifecycleAction["label"]
type Change = FileLifecycleChange["change"]

/** Each lifecycle change's icon, shared by the menus and the phone's bar. */
export const ACTION_ICONS = {
  Archive,
  "Move to Trash": Trash2,
  Restore: RotateCcw,
} as const

const BULK_ORDER: readonly LifecycleLabel[] = ["Archive", "Restore", "Move to Trash"]
const CHANGES: Record<LifecycleLabel, Change> = {
  Archive: "archive",
  "Move to Trash": "trash",
  Restore: "restore",
}
const DONE: Record<Change, string> = {
  archive: "archived",
  restore: "restored",
  trash: "moved to Trash",
}

/**
 * Names a change across several items, such as "Move 3 items to Trash".
 *
 * @param label - The change.
 * @param count - How many items it covers.
 * @returns The change's name with its count.
 */
export function describeBulk(label: LifecycleLabel, count: number): string {
  const items = `${count} ${count === 1 ? "item" : "items"}`

  return label === "Move to Trash" ? `Move ${items} to Trash` : `${label} ${items}`
}

// Undo puts things back where they were: a restore from Archived or Trash
// sends them back there.
function undoOf(change: Change, lifecycle: "active" | "archived" | "trash"): Change | null {
  if (change !== "restore") {
    return "restore"
  }

  if (lifecycle === "archived") {
    return "archive"
  }

  return lifecycle === "trash" ? "trash" : null
}

function announce(
  change: Change,
  result: FileLifecycleResult,
  lifecycle: "active" | "archived" | "trash"
): void {
  const count = result.documentIds.length + result.folderIds.length
  const noun = count === 1 ? "item" : "items"
  const title =
    result.failed > 0
      ? `${count} of ${count + result.failed} items ${DONE[change]}`
      : `${count} ${noun} ${DONE[change]}`
  const undo = count > 0 ? undoOf(change, lifecycle) : null

  bizflowToast.success(title, {
    action: undo
      ? {
          label: "Undo",
          onClick: () => {
            changeFilesLifecycleAction({
              change: undo,
              documentIds: result.documentIds,
              folderIds: result.folderIds,
            })
              .then(() => bizflowToast.success("Undone"))
              .catch(() => bizflowToast.error("That could not be undone."))
          },
        }
      : undefined,
    description:
      result.failed > 0 ? "The rest changed since you looked, or aren't yours to change." : undefined,
  })
}

/**
 * Offers the lifecycle changes every one of the given items allows, and runs
 * one of them across all of the items with an Undo toast.
 *
 * @param targets - The items to change together, or null for none.
 * @returns The changes they share, in menu order, and a way to run one.
 */
export function useSelectionChanges(targets: readonly SelectableFile[] | null): {
  labels: LifecycleLabel[]
  run: (label: LifecycleLabel) => void
} {
  const selection = useFileSelection()
  const [, startTransition] = useTransition()

  function run(label: LifecycleLabel): void {
    if (!selection || !targets) {
      return
    }

    const change = CHANGES[label]
    const lifecycle = selection.lifecycle
    const request = {
      change,
      documentIds: targets.filter((item) => item.kind === "document").map((item) => item.id),
      folderIds: targets.filter((item) => item.kind === "folder").map((item) => item.id),
    }

    selection.clear()
    startTransition(async () => {
      try {
        announce(change, await changeFilesLifecycleAction(request), lifecycle)
      } catch {
        bizflowToast.error("Those files could not be changed. Try again.")
      }
    })
  }

  return {
    labels: targets
      ? BULK_ORDER.filter((label: LifecycleLabel) =>
          targets.every((item) => item.labels.includes(label))
        )
      : [],
    run,
  }
}

/**
 * Keeps one folder's or document's lifecycle actions behind a quiet button:
 * archive, restore, and move to Trash, and in Trash a permanent deletion that
 * first asks for the item's exact name in a dialog. When the item is part of a
 * selection, the menu acts on every selected item instead, offering only what
 * all of them allow; deleting for good stays one item at a time.
 *
 * @param props - The item, its name, its lifecycle actions, and its purge form.
 * @returns The row's action button, its menu, and the purge dialog.
 */
export function FileRowMenu({
  actions,
  itemId,
  name,
  purgeForm,
}: {
  actions: readonly FileLifecycleAction[]
  itemId: string
  name: string
  purgeForm?: ReactNode
}): ReactElement {
  const [purging, setPurging] = useState(false)
  const selection = useFileSelection()
  const targets =
    selection && selection.selected.size > 1 && selection.selected.has(itemId)
      ? selection.items.filter((item) => selection.selected.has(item.id))
      : null
  const bulk = useSelectionChanges(targets)
  // The same items open from the ⋯ button and, in List and Icons, from a
  // right-click anywhere on the row or tile.
  const opensOnRightClick = useOpensOnRightClick()
  const items = targets ? (
    bulk.labels.length > 0 ? (
      bulk.labels.map((label: LifecycleLabel) => {
        const Icon = ACTION_ICONS[label]

        return (
          <DropdownMenuItem
            key={label}
            onClick={() => bulk.run(label)}
            variant={label === "Move to Trash" ? "destructive" : "default"}
          >
            <Icon aria-hidden="true" />
            {describeBulk(label, targets.length)}
          </DropdownMenuItem>
        )
      })
    ) : (
      <DropdownMenuItem disabled>No change fits every selected item</DropdownMenuItem>
    )
  ) : (
    <>
      {actions.map((action: FileLifecycleAction) => {
        const Icon = ACTION_ICONS[action.label]

        return (
          <form action={action.formAction} key={action.label}>
            {Object.entries(action.fields).map(([fieldName, value]) => (
              <input key={fieldName} name={fieldName} type="hidden" value={value} />
            ))}
            {/* The menu stays open until the page moves on, so closing it
                cannot unmount this form mid-submit. */}
            <DropdownMenuItem
              closeOnClick={false}
              nativeButton
              render={<button className="w-full" type="submit" />}
              variant={action.label === "Move to Trash" ? "destructive" : "default"}
            >
              <Icon aria-hidden="true" />
              {action.label}
            </DropdownMenuItem>
          </form>
        )
      })}
      {purgeForm ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setPurging(true)} variant="destructive">
            <Trash2 aria-hidden="true" />
            Delete permanently…
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  )

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`Actions for ${name}`}
              className={cn(
                "size-8 rounded-[8px] text-muted-foreground",
                // While a phone selects, its bar holds the actions.
                selection?.phoneSelecting && "invisible"
              )}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-52">
          {items}
        </DropdownMenuContent>
      </DropdownMenu>
      {opensOnRightClick ? (
        <DropdownMenuContent className="w-52">{items}</DropdownMenuContent>
      ) : null}
      {purgeForm ? (
        <Dialog onOpenChange={setPurging} open={purging}>
          <DialogContent>
            {/* The form below says what is lost, so the header only names it. */}
            <DialogHeader>
              <DialogTitle>Delete {name} permanently?</DialogTitle>
            </DialogHeader>
            {purgeForm}
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
