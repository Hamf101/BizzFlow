"use client"

import type { ReactElement, ReactNode } from "react"
import { useFormStatus } from "react-dom"

import { createGeneratedDocumentAction } from "@/app/(dashboard)/documents/actions"

/**
 * Makes a document in one click and opens it, the way a word processor's New
 * does: blank, or a copy of a template. A blank one starts as "Untitled
 * document" and is renamed in the editor.
 *
 * @param props - Where it goes, how the button looks, and what it shows.
 * @returns A form whose single button creates the document.
 */
export function NewDocumentButton({
  children,
  className,
  folderId = null,
  templateId = null,
}: {
  children: ReactNode
  className?: string
  folderId?: string | null
  /** A published template to copy; blank when null. */
  templateId?: string | null
}): ReactElement {
  return (
    <form action={createGeneratedDocumentAction} className="contents">
      <input name="folderId" type="hidden" value={folderId ?? ""} />
      <input name="templateId" type="hidden" value={templateId ?? ""} />
      <Submit className={className}>{children}</Submit>
    </form>
  )
}

function Submit({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  const { pending } = useFormStatus()

  // Disabled while it works, so a double click makes one document, not two.
  return (
    <button aria-busy={pending} className={className} disabled={pending} type="submit">
      {children}
    </button>
  )
}
