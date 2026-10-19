"use client"

import { FilePlus2, FileSpreadsheet, FolderPlus, Plus } from "lucide-react"
import Link from "next/link"
import { type ReactElement, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/** The folder form a New menu opens: its action, hidden fields, and title. */
export type NewFolderForm = {
  action: (formData: FormData) => Promise<void>
  fields: Readonly<Record<string, string>>
  /** "New folder" at the top of Files, "New subfolder" inside a folder. */
  label: string
}

/**
 * Starts something new in the current location: a document, a sheet that
 * opens at once, or a folder named in a small dialog.
 *
 * @param props - Where a new document starts, how to start a sheet, and the folder form, when allowed.
 * @returns The New button, its menu, and the folder dialog.
 */
export function NewFileMenu({
  addDocumentHref,
  newFolder,
  newSheet,
}: {
  addDocumentHref: string | null
  newFolder: NewFolderForm | null
  /** Creates an empty sheet here and opens it. */
  newSheet: (() => Promise<void>) | null
}): ReactElement {
  const [naming, setNaming] = useState(false)
  const [starting, startSheet] = useTransition()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button className="h-11 rounded-lg px-4 font-normal" type="button">
              <Plus aria-hidden="true" data-icon="inline-start" />
              <span className="max-sm:sr-only">New</span>
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-48">
          {addDocumentHref ? (
            <DropdownMenuItem render={<Link href={addDocumentHref} />}>
              <FilePlus2 aria-hidden="true" />
              Document
            </DropdownMenuItem>
          ) : null}
          {newSheet ? (
            <DropdownMenuItem disabled={starting} onClick={() => startSheet(newSheet)}>
              <FileSpreadsheet aria-hidden="true" />
              Sheet
            </DropdownMenuItem>
          ) : null}
          {newFolder ? (
            <DropdownMenuItem onClick={() => setNaming(true)}>
              <FolderPlus aria-hidden="true" />
              Folder
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {newFolder ? (
        <Dialog onOpenChange={setNaming} open={naming}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{newFolder.label}</DialogTitle>
            </DialogHeader>
            {/* Files stays on the same page once the folder exists, so the
                dialog closes itself; the form's data is already sent by then. */}
            <form
              action={newFolder.action}
              className="grid gap-5"
              onSubmit={() => setNaming(false)}
            >
              {Object.entries(newFolder.fields).map(([fieldName, value]) => (
                <input key={fieldName} name={fieldName} type="hidden" value={value} />
              ))}
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="new-folder-name">Name</FieldLabel>
                  <Input
                    autoFocus
                    id="new-folder-name"
                    maxLength={120}
                    minLength={1}
                    name="name"
                    required
                    type="text"
                  />
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button type="submit">Create folder</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
