"use client"

import { Archive, Ellipsis, RotateCcw, Trash2 } from "lucide-react"
import { type ReactElement, type ReactNode, useState } from "react"

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

/** One lifecycle change a row offers, posted to its server action. */
export type FileLifecycleAction = {
  fields: Readonly<Record<string, string>>
  formAction: (formData: FormData) => Promise<void>
  label: "Archive" | "Move to Trash" | "Restore"
}

const ACTION_ICONS = {
  Archive,
  "Move to Trash": Trash2,
  Restore: RotateCcw,
} as const

/**
 * Keeps one folder's or document's lifecycle actions behind a quiet button:
 * archive, restore, and move to Trash, and in Trash a permanent deletion that
 * first asks for the item's exact name in a dialog.
 *
 * @param props - The item's name, its lifecycle actions, and its purge form.
 * @returns The row's action button, its menu, and the purge dialog.
 */
export function FileRowMenu({
  actions,
  name,
  purgeForm,
}: {
  actions: readonly FileLifecycleAction[]
  name: string
  purgeForm?: ReactNode
}): ReactElement {
  const [purging, setPurging] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`Actions for ${name}`}
              className="size-8 rounded-[8px] text-muted-foreground"
              size="icon"
              type="button"
              variant="ghost"
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-52">
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
              <DropdownMenuItem
                onClick={() => setPurging(true)}
                variant="destructive"
              >
                <Trash2 aria-hidden="true" />
                Delete permanently…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
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
