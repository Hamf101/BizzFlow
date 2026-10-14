"use client"

import { Pencil } from "lucide-react"
import { type ReactElement, useState } from "react"
import { useFormStatus } from "react-dom"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { GeneratedDocumentWorkflowStatus } from "@/types/template"

/**
 * What a sent document offers: its sender may take it back to edit while it
 * awaits signatures; once completed it is fixed, and anyone who may make
 * documents edits a copy instead.
 *
 * @param input - What the member may do, and where the document stands.
 * @returns Whether Edit and Edit a copy are offered.
 */
export function signedDocumentActions(input: {
  canCopy: boolean
  canFill: boolean
  canSend: boolean
  workflowStatus: GeneratedDocumentWorkflowStatus
}): { copy: boolean; edit: boolean } {
  return {
    copy: input.canCopy && input.workflowStatus === "completed",
    edit: input.canFill && input.canSend && input.workflowStatus === "awaiting_signatures",
  }
}

/**
 * Edit, for a document awaiting signatures, behind a confirmation that says
 * what editing cancels.
 *
 * @param props - The cancel action, the document, and how many have signed.
 * @returns The Edit button and its confirmation.
 */
export function EditSentDocumentButton({
  action,
  documentId,
  signedCount,
}: {
  action: (formData: FormData) => Promise<void>
  documentId: string
  signedCount: number
}): ReactElement {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button className="h-10 px-4" onClick={() => setOpen(true)} type="button">
        <Pencil />
        Edit
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Edit this document?</DialogTitle>
            <DialogDescription>
              {signedCount === 0
                ? "Signing links already sent will stop working."
                : `${signedCount} ${signedCount === 1 ? "signature" : "signatures"} so far will be cancelled. Everyone you sent it to will need to sign again.`}
            </DialogDescription>
          </DialogHeader>
          <form action={action}>
            <input name="documentId" type="hidden" value={documentId} />
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <ConfirmButton />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ConfirmButton(): ReactElement {
  const { pending } = useFormStatus()

  return (
    <Button disabled={pending} type="submit">
      Edit document
    </Button>
  )
}
