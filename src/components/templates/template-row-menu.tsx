"use client"

import { Copy, Ellipsis, Link2, Pencil } from "lucide-react"
import Link from "next/link"
import type { ReactElement } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Keeps a template's actions behind one quiet button on its card: edit, public
 * links once it is published, and duplicate.
 *
 * @param props - The template and the action that duplicates it.
 * @returns The card's action button and its menu.
 */
export function TemplateRowMenu({
  duplicateAction,
  published,
  templateId,
  title,
}: {
  duplicateAction: (formData: FormData) => Promise<void>
  published: boolean
  templateId: string
  title: string
}): ReactElement {
  const templatePath = `/templates/${encodeURIComponent(templateId)}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`Actions for ${title}`}
            className="size-8 rounded-[8px] text-muted-foreground"
            size="icon"
            type="button"
            variant="ghost"
          >
            <Ellipsis aria-hidden="true" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem render={<Link href={`${templatePath}/edit`} />}>
          <Pencil aria-hidden="true" />
          Edit
        </DropdownMenuItem>
        {published ? (
          <DropdownMenuItem render={<Link href={`${templatePath}/links`} />}>
            <Link2 aria-hidden="true" />
            Public links
          </DropdownMenuItem>
        ) : null}
        <form action={duplicateAction}>
          <input name="templateId" type="hidden" value={templateId} />
          {/* The menu stays open until the copy's editor opens, so closing it
              cannot unmount this form mid-submit. */}
          <DropdownMenuItem
            closeOnClick={false}
            nativeButton
            render={<button className="w-full" type="submit" />}
          >
            <Copy aria-hidden="true" />
            Duplicate
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
