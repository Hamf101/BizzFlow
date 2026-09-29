"use client"

import { Copy, Ellipsis, Link2, Pencil } from "lucide-react"
import Link from "next/link"
import { type ReactElement, useState } from "react"

import { useOpensOnRightClick } from "@/components/data/selection"
import {
  CategoryDialog,
  CHANGE_ICONS,
  describeTemplateChange,
  type TemplateChangeLabel,
  useTemplateChanges,
  useTemplateSelection,
} from "@/components/templates/template-selection"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { DocumentTemplateStatus } from "@/types/template"

/**
 * Keeps a template's actions behind one quiet button on its card, and on a
 * right-click anywhere on it: edit, public links once it is published,
 * duplicate, archive, and file under a category; an archived template offers
 * restore. When the card is part of a selection, the menu acts on every
 * selected template instead, offering only what all of them allow.
 *
 * @param props - The template, its state, and the action that duplicates it.
 * @returns The card's action button, its menus, and the category dialog.
 */
export function TemplateRowMenu({
  duplicateAction,
  status,
  templateId,
  title,
}: {
  duplicateAction: (formData: FormData) => Promise<void>
  status: DocumentTemplateStatus
  templateId: string
  title: string
}): ReactElement {
  const selection = useTemplateSelection()
  const [filing, setFiling] = useState(false)
  const opensOnRightClick = useOpensOnRightClick()
  const inSelection = selection !== null && selection.selected.size > 1 && selection.selected.has(templateId)
  const targets = inSelection
    ? selection.items.filter((template) => selection.selected.has(template.id))
    : [{ id: templateId, status }]
  const changes = useTemplateChanges(targets)
  const templatePath = `/templates/${encodeURIComponent(templateId)}`

  function change(label: TemplateChangeLabel): ReactElement {
    const Icon = CHANGE_ICONS[label]

    return (
      <DropdownMenuItem key={label} onClick={() => (label === "Category" ? setFiling(true) : changes.run(label))}>
        <Icon aria-hidden="true" />
        {inSelection ? describeTemplateChange(label, targets.length) : label === "Category" ? "Category…" : label}
      </DropdownMenuItem>
    )
  }

  const items = inSelection ? (
    changes.labels.length > 0 ? (
      changes.labels.map(change)
    ) : (
      <DropdownMenuItem disabled>No change fits every selected template</DropdownMenuItem>
    )
  ) : status === "archived" ? (
    change("Restore")
  ) : (
    <>
      <DropdownMenuItem render={<Link href={`${templatePath}/edit`} />}>
        <Pencil aria-hidden="true" />
        Edit
      </DropdownMenuItem>
      {status === "published" ? (
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
      {change("Archive")}
      {change("Category")}
    </>
  )

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`Actions for ${title}`}
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
      {opensOnRightClick ? <DropdownMenuContent className="w-52">{items}</DropdownMenuContent> : null}
      <CategoryDialog
        count={targets.length}
        onChoose={(category) => changes.run("Category", category)}
        onOpenChange={setFiling}
        open={filing}
      />
    </>
  )
}
