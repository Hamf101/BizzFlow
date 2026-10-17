"use client"

import { Copy, Ellipsis, Link2, Pencil, Send, Trash2, UserPlus } from "lucide-react"
import Link from "next/link"
import { type ReactElement, useState } from "react"

import { purgeTemplateAction } from "@/app/(dashboard)/templates/actions"
import { useOpensOnRightClick } from "@/components/data/selection"
import { PurgeRequestForm } from "@/components/documents/purge-request-form"
import {
  CategoryDialog,
  CHANGE_ICONS,
  describeTemplateChange,
  shareableTemplates,
  type TemplateChangeLabel,
  useTemplateChanges,
  useTemplateSelection,
} from "@/components/templates/template-selection"
import { SendToAnswerDialog } from "@/components/editor/lazy-panels"
import { ShareDialog } from "@/components/sharing/share-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { DocumentTemplateStatus } from "@/types/template"

/**
 * Keeps a template's actions behind one quiet button on its card, and on a
 * right-click anywhere on it: edit, send to answer and public links once it is published,
 * duplicate, archive, move to Trash, and file under a category; an archived
 * template offers restore or Trash, and one in Trash restore or a permanent
 * deletion that first asks for its exact title. When the card is part of a
 * selection, the menu acts on every selected template instead, offering only
 * what all of them allow; deleting for good stays one template at a time.
 *
 * @param props - The template, its state, and the action that duplicates it.
 * @returns The card's action button, its menus, and the category dialog.
 */
export function TemplateRowMenu({
  canDuplicate,
  canEdit,
  duplicateAction,
  status,
  templateId,
  title,
  trashed,
}: {
  /** The viewer may make a copy of it. */
  canDuplicate: boolean
  /** The viewer may edit it, and so archive, file and share it. */
  canEdit: boolean
  duplicateAction: (formData: FormData) => Promise<void>
  status: DocumentTemplateStatus
  templateId: string
  title: string
  /** It is in Trash. */
  trashed: boolean
}): ReactElement {
  const selection = useTemplateSelection()
  const [filing, setFiling] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [asking, setAsking] = useState(false)
  const [purging, setPurging] = useState(false)
  const opensOnRightClick = useOpensOnRightClick()
  const inSelection = selection !== null && selection.selected.size > 1 && selection.selected.has(templateId)
  const targets = inSelection
    ? selection.items.filter((template) => selection.selected.has(template.id))
    : [{ canDuplicate, canEdit, id: templateId, status, trashed }]
  const changes = useTemplateChanges(targets)
  // The whole selection when the template is part of one, otherwise just the template.
  const share = shareableTemplates(targets)
  const shareItem = share ? (
    <DropdownMenuItem onClick={() => setSharing(true)}>
      <UserPlus aria-hidden="true" />
      {share.length > 1 ? `Share ${share.length} templates…` : "Share…"}
    </DropdownMenuItem>
  ) : null
  const templatePath = `/templates/${encodeURIComponent(templateId)}`

  function change(label: TemplateChangeLabel): ReactElement {
    const Icon = CHANGE_ICONS[label]

    return (
      <DropdownMenuItem
        key={label}
        onClick={() => (label === "Category" ? setFiling(true) : changes.run(label))}
        variant={label === "Move to Trash" ? "destructive" : "default"}
      >
        <Icon aria-hidden="true" />
        {inSelection ? describeTemplateChange(label, targets.length) : label === "Category" ? "Category…" : label}
      </DropdownMenuItem>
    )
  }

  const items = inSelection ? (
    changes.labels.length > 0 || share ? (
      <>
        {shareItem}
        {changes.labels.map(change)}
      </>
    ) : (
      <DropdownMenuItem disabled>No change fits every selected template</DropdownMenuItem>
    )
  ) : trashed ? (
    <>
      {change("Restore")}
      {canEdit ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setPurging(true)} variant="destructive">
            <Trash2 aria-hidden="true" />
            Delete permanently…
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  ) : status === "archived" ? (
    <>
      {change("Restore")}
      {canEdit ? change("Move to Trash") : null}
    </>
  ) : (
    <>
      {canEdit ? (
        <DropdownMenuItem render={<Link href={`${templatePath}/edit`} />}>
          <Pencil aria-hidden="true" />
          Edit
        </DropdownMenuItem>
      ) : null}
      {canEdit && status === "published" ? (
        <>
          <DropdownMenuItem onClick={() => setAsking(true)}>
            <Send aria-hidden="true" />
            Send to answer…
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href={`${templatePath}/links`} />}>
            <Link2 aria-hidden="true" />
            Public links
          </DropdownMenuItem>
        </>
      ) : null}
      {shareItem}
      {canDuplicate ? (
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
      ) : null}
      {canEdit ? change("Archive") : null}
      {canEdit ? change("Move to Trash") : null}
      {canEdit ? change("Category") : null}
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
                "size-8 rounded-md text-muted-foreground max-md:size-11",
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
      {asking ? <SendToAnswerDialog name={title} onOpenChange={setAsking} open source={{ kind: "template", templateId }} /> : null}
      {share ? <ShareDialog name={title} onOpenChange={setSharing} open={sharing} resources={share} /> : null}
      {trashed && canEdit ? (
        <Dialog onOpenChange={setPurging} open={purging}>
          <DialogContent>
            {/* The form below says what is lost, so the header only names it. */}
            <DialogHeader>
              <DialogTitle>Delete {title} permanently?</DialogTitle>
            </DialogHeader>
            <PurgeRequestForm
              action={purgeTemplateAction}
              confirmationFieldName="confirmationTitle"
              hiddenFields={{ templateId }}
              inDialog
              inputId={`purge-template-${templateId}`}
              resourceKind="template"
              resourceName={title}
            />
          </DialogContent>
        </Dialog>
      ) : null}
      <CategoryDialog
        count={targets.length}
        onChoose={(category) => changes.run("Category", category)}
        onOpenChange={setFiling}
        open={filing}
      />
    </>
  )
}
