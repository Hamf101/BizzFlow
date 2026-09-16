"use client"

import { Check, ChevronDown, SlidersHorizontal } from "lucide-react"
import Link from "next/link"
import { Fragment, type ReactElement, useId, useRef, useState } from "react"

import {
  deleteSavedViewAction,
  renameSavedViewAction,
  saveListViewAction,
} from "@/app/(dashboard)/saved-view-actions"
import type {
  ListOption,
  ListOptionSection,
} from "@/components/data/list-option"
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { SavedView, SavedViewList } from "@/types/saved-view"

/** A list's saved views, and the settings it shows now. */
export type ListSavedViews = {
  list: SavedViewList
  /** The list's canonical settings now, without a page. */
  query: string
  saved: readonly SavedView[]
}

/**
 * Keeps a list's secondary view settings behind one quiet button.
 *
 * A dot on the button shows that a hidden setting differs from the default,
 * so a changed view is never invisible. Every choice is a link to the view it
 * describes. With `views`, the menu opens on the member's saved views: the
 * current settings can be saved under a name, and a saved view that is
 * showing can be renamed or deleted.
 *
 * @param props - Button label, whether a hidden setting changed, the choices,
 *   and the list's saved views.
 * @returns The view-options button, its menu, and the naming dialog.
 */
export function ListViewMenu({
  adjusted,
  label,
  sections,
  views,
}: {
  adjusted: boolean
  label: string
  sections: readonly ListOptionSection[]
  views?: ListSavedViews
}): ReactElement {
  const [naming, setNaming] = useState<"rename" | "save" | null>(null)
  const deleteForm = useRef<HTMLFormElement>(null)
  const nameId = useId()
  const current = views?.saved.find(
    (view: SavedView): boolean => view.query === views.query
  )
  // A list in its default settings has nothing worth saving.
  const canSave = Boolean(views?.query) && !current
  const renaming = naming === "rename" && current !== undefined

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={adjusted ? `${label} (changed)` : label}
              className="relative size-11 rounded-[12px] bg-card"
              size="icon"
              type="button"
              variant="outline"
            >
              <SlidersHorizontal aria-hidden="true" />
              {adjusted ? (
                <span
                  aria-hidden="true"
                  className="absolute top-2 right-2 size-1.5 rounded-full bg-primary"
                />
              ) : null}
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-60">
          {views && (views.saved.length > 0 || canSave) ? (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel>Views</DropdownMenuLabel>
                {views.saved.map((view: SavedView) => (
                  <OptionItem
                    key={view.id}
                    option={{
                      href: viewHref(views.list, view.query),
                      label: view.name,
                      selected: view === current,
                    }}
                  />
                ))}
                {canSave ? (
                  <DropdownMenuItem onClick={() => setNaming("save")}>
                    <Check aria-hidden="true" className="invisible" />
                    Save this view…
                  </DropdownMenuItem>
                ) : null}
                {current ? (
                  <>
                    <DropdownMenuItem onClick={() => setNaming("rename")}>
                      <Check aria-hidden="true" className="invisible" />
                      Rename this view…
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => deleteForm.current?.requestSubmit()}>
                      <Check aria-hidden="true" className="invisible" />
                      Delete this view
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {sections.map((section: ListOptionSection, index: number) => (
            <Fragment key={section.label}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
                {section.options.map((option: ListOption) => (
                  <OptionItem key={option.href} option={option} />
                ))}
              </DropdownMenuGroup>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {views && current ? (
        <form action={deleteSavedViewAction} hidden ref={deleteForm}>
          <input name="list" type="hidden" value={views.list} />
          <input name="query" type="hidden" value={views.query} />
          <input name="viewId" type="hidden" value={current.id} />
        </form>
      ) : null}
      {views ? (
        <Dialog
          onOpenChange={(open: boolean) => {
            if (!open) setNaming(null)
          }}
          open={naming === "save" ? canSave : renaming}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{renaming ? "Rename this view" : "Save this view"}</DialogTitle>
            </DialogHeader>
            {/* The list reloads with the view, so the dialog closes itself;
                the form's data is already sent by then. */}
            <form
              action={renaming ? renameSavedViewAction : saveListViewAction}
              className="grid gap-5"
              key={naming ?? "closed"}
              onSubmit={() => setNaming(null)}
            >
              <input name="list" type="hidden" value={views.list} />
              <input name="query" type="hidden" value={views.query} />
              {renaming && current ? (
                <input name="viewId" type="hidden" value={current.id} />
              ) : null}
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={nameId}>Name</FieldLabel>
                  <Input
                    autoFocus
                    defaultValue={renaming && current ? current.name : ""}
                    id={nameId}
                    maxLength={40}
                    name="name"
                    required
                    type="text"
                  />
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button type="submit">{renaming ? "Rename view" : "Save view"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

/**
 * A list's title. Once there are saved views, it opens a menu of them, and a
 * saved view that is showing puts its own name in the title.
 *
 * @param props - The list's own name and its saved views.
 * @returns The title, or the title as a menu of views.
 */
export function ListViewTitle({
  title,
  views,
}: {
  title: string
  views: ListSavedViews
}): ReactElement {
  if (views.saved.length === 0) {
    return <>{title}</>
  }

  const current = views.saved.find(
    (view: SavedView): boolean => view.query === views.query
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="-ml-1.5 inline-flex items-center gap-1 rounded-[9px] px-1.5 py-0.5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/35 data-popup-open:bg-muted">
        {current?.name ?? title}
        <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <OptionItem
          option={{
            href: viewHref(views.list, ""),
            label: title,
            selected: !current && views.query === "",
          }}
        />
        {views.saved.map((view: SavedView) => (
          <OptionItem
            key={view.id}
            option={{
              href: viewHref(views.list, view.query),
              label: view.name,
              selected: view === current,
            }}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function viewHref(list: SavedViewList, query: string): string {
  return query ? `/${list}?${query}` : `/${list}`
}

function OptionItem({ option }: { option: ListOption }): ReactElement {
  return (
    <DropdownMenuItem
      aria-current={option.selected ? "true" : undefined}
      render={
        option.download ? (
          // A plain link: client navigation would try to render the
          // downloaded file as a page.
          <a download href={option.href} />
        ) : (
          <Link href={option.href} />
        )
      }
    >
      <Check
        aria-hidden="true"
        className={cn(!option.selected && "invisible")}
      />
      {option.label}
    </DropdownMenuItem>
  )
}
