"use client"

import { Archive, Copy, RotateCcw, Tag, UserPlus } from "lucide-react"
import { createContext, type ReactElement, type ReactNode, useContext, useState, useTransition } from "react"

import { changeTemplatesAction, type TemplateChange } from "@/app/(dashboard)/templates/actions"
import { BAR_BUTTON, SelectionBarShell } from "@/components/data/selection-bar"
import { SelectableItem, SelectionProvider, useSelection } from "@/components/data/selection"
import { ShareDialog } from "@/components/sharing/share-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { bizflowToast } from "@/components/ui/toaster"
import type { TemplateBulkResult } from "@/services/template-service"
import type { DocumentTemplateStatus } from "@/types/template"

/** One template the library shows, with the state and rights that decide what may change. */
export type SelectableTemplate = {
  /** The viewer may make a copy of it. */
  canDuplicate: boolean
  /** The viewer may edit it, and so archive, file and share it. */
  canEdit: boolean
  id: string
  status: DocumentTemplateStatus
}

/** A change the selection offers, named as its button and menu item are. */
export type TemplateChangeLabel = "Archive" | "Category" | "Duplicate" | "Restore"

type Change = TemplateChange["change"]
type Targets = readonly SelectableTemplate[]

const CategoriesContext = createContext<readonly string[]>([])

const CHANGES: Record<TemplateChangeLabel, Change> = {
  Archive: "archive",
  Category: "category",
  Duplicate: "duplicate",
  Restore: "restore",
}
const DONE: Record<Change, string> = {
  archive: "archived",
  category: "filed",
  duplicate: "duplicated",
  restore: "restored",
}

/** Each change's icon, shared by the bar and the menus. */
export const CHANGE_ICONS = { Archive, Category: Tag, Duplicate: Copy, Restore: RotateCcw } as const

/**
 * Keeps the library's selection (see SelectionProvider) for the templates a
 * manager can change, and the categories the category dialog suggests.
 *
 * @param props - Every template on the page in order, and the categories in use.
 * @returns The selection around the library.
 */
export function TemplateSelection({
  categories,
  children,
  templates,
}: {
  categories: readonly string[]
  children: ReactNode
  templates: Targets
}): ReactElement {
  return (
    <SelectionProvider items={templates} scope="templates" shown={templates.map((template) => template.id)}>
      <CategoriesContext.Provider value={categories}>{children}</CategoriesContext.Provider>
    </SelectionProvider>
  )
}

/**
 * Reads the library's selection.
 *
 * @returns The selection, or null outside the library.
 */
export function useTemplateSelection(): ReturnType<typeof useSelection<SelectableTemplate>> {
  return useSelection<SelectableTemplate>()
}

/**
 * A template card that joins the selection (see SelectableItem).
 *
 * @param props - The element to draw, its template, and its own attributes.
 * @returns The card.
 */
export function SelectableTemplateCard(props: Omit<Parameters<typeof SelectableItem>[0], "checkSlot" | "slot">): ReactElement {
  return <SelectableItem {...props} checkSlot="template-check" slot="template-card" />
}

// Undo puts things back: a restore sends them back to Archived, an archive
// restores them, and a category change files each under the one it had.
function announce(change: Change, result: TemplateBulkResult): void {
  const count = result.changed.length
  const noun = count === 1 ? "template" : "templates"
  const title =
    result.failed > 0 ? `${count} of ${count + result.failed} templates ${DONE[change]}` : `${count} ${noun} ${DONE[change]}`
  const undo = count > 0 ? undoOf(change, result) : null

  bizflowToast.success(title, {
    action: undo
      ? {
          label: "Undo",
          onClick: () => {
            undo()
              .then(() => bizflowToast.success("Undone"))
              .catch(() => bizflowToast.error("That could not be undone."))
          },
        }
      : undefined,
    description: result.failed > 0 ? "The rest changed since you looked, or aren't yours to change." : undefined,
  })
}

function undoOf(change: Change, result: TemplateBulkResult): (() => Promise<unknown>) | null {
  if (change === "archive" || change === "restore") {
    return () => changeTemplatesAction({ change: change === "archive" ? "restore" : "archive", templateIds: result.changed })
  }

  if (change === "category") {
    const byCategory = new Map<string | null, string[]>()

    for (const [templateId, category] of Object.entries(result.previousCategories)) {
      byCategory.set(category, [...(byCategory.get(category) ?? []), templateId])
    }

    return () =>
      Promise.all(
        [...byCategory].map(([category, templateIds]) => changeTemplatesAction({ category, change: "category", templateIds }))
      )
  }

  // A copy is a new draft; there is nothing to put back.
  return null
}

/**
 * Offers the changes every one of the given templates allows, and runs one of
 * them across all of them with an Undo toast.
 *
 * @param targets - The templates to change together, or null for none.
 * @returns The changes they share, in menu order, and a way to run one.
 */
export function useTemplateChanges(targets: Targets | null): {
  labels: TemplateChangeLabel[]
  run: (label: TemplateChangeLabel, category?: string | null) => void
} {
  const selection = useTemplateSelection()
  const [, startTransition] = useTransition()

  function run(label: TemplateChangeLabel, category?: string | null): void {
    if (!targets) {
      return
    }

    const change = CHANGES[label]

    selection?.clear()
    startTransition(async () => {
      try {
        announce(change, await changeTemplatesAction({ category, change, templateIds: targets.map((template) => template.id) }))
      } catch {
        bizflowToast.error("Those templates could not be changed. Try again.")
      }
    })
  }

  const archived = targets?.filter((template) => template.status === "archived").length ?? 0
  // Each change is offered only when every template allows it to this viewer.
  const every = (allowed: (template: SelectableTemplate) => boolean): boolean => Boolean(targets?.every(allowed))
  const editable = every((template) => template.canEdit)
  const labels: TemplateChangeLabel[] =
    !targets || targets.length === 0
      ? []
      : archived === targets.length
        ? editable
          ? ["Restore"]
          : []
        : archived === 0
          ? [
              ...(editable ? (["Archive"] as const) : []),
              ...(every((template) => template.canDuplicate) ? (["Duplicate"] as const) : []),
              ...(editable ? (["Category"] as const) : []),
            ]
          : []

  return { labels, run }
}

/**
 * The templates a Share would cover, or null unless the viewer may edit every
 * one of them and none is archived.
 *
 * @param targets - The template, or the selection.
 * @returns The templates to share.
 */
export function shareableTemplates(targets: Targets): { id: string; kind: "template" }[] | null {
  return targets.length > 0 && targets.every((template) => template.canEdit && template.status !== "archived")
    ? targets.map(({ id }) => ({ id, kind: "template" as const }))
    : null
}

/**
 * Names a change across several templates, such as "Archive 3 templates".
 *
 * @param label - The change.
 * @param count - How many templates it covers.
 * @returns The change's name with its count.
 */
export function describeTemplateChange(label: TemplateChangeLabel, count: number): string {
  const templates = `${count} ${count === 1 ? "template" : "templates"}`

  return label === "Category" ? `Set the category of ${templates}` : `${label} ${templates}`
}

/**
 * Asks which category to file the given templates under, or to file them under
 * none, then does it with an Undo toast.
 *
 * @param props - How many templates, the open state, and what to do with the answer.
 * @returns The category dialog.
 */
export function CategoryDialog({
  count,
  onChoose,
  onOpenChange,
  open,
}: {
  count: number
  onChoose: (category: string | null) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}): ReactElement {
  const categories = useContext(CategoriesContext)
  const [category, setCategory] = useState("")

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>Category for {count === 1 ? "this template" : `${count} templates`}</DialogTitle>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="bulk-template-category">Category</FieldLabel>
          <Input id="bulk-template-category" maxLength={40} onChange={(event) => setCategory(event.target.value)} value={category} />
          {/* Earlier categories sit beside the field rather than in a pop-up
              list, which would hide this dialog from a screen reader while open. */}
          {categories.length > 0 ? (
            <ul aria-label="Categories in use" className="flex flex-wrap gap-1.5 pt-1">
              {categories.map((existing) => (
                <li key={existing}>
                  <button
                    aria-pressed={existing === category}
                    className="rounded-full border border-border px-2.5 py-1 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:border-primary aria-pressed:bg-secondary"
                    onClick={() => setCategory(existing)}
                    type="button"
                  >
                    {existing}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Field>
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => {
              onOpenChange(false)
              onChoose(null)
            }}
            variant="ghost"
          >
            Remove category
          </Button>
          <Button
            disabled={category.trim() === ""}
            onClick={() => {
              onOpenChange(false)
              onChoose(category)
            }}
          >
            Set category
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The library's selection bar (see SelectionBarShell): the changes every
 * selected template allows. On a phone each is an icon.
 *
 * @returns The selection bar.
 */
export function TemplateSelectionBar(): ReactElement {
  const selection = useTemplateSelection()
  const targets = selection ? selection.items.filter((template) => selection.selected.has(template.id)) : []
  const open = targets.length > 0
  const { labels, run } = useTemplateChanges(open ? targets : null)
  const [filing, setFiling] = useState(false)
  const [sharing, setSharing] = useState(false)
  const share = shareableTemplates(targets)
  // What the bar last showed, so it keeps its words while it sinks away.
  const [shown, setShown] = useState<{ count: number; labels: TemplateChangeLabel[] }>({ count: 0, labels: [] })

  if (open && (shown.count !== targets.length || shown.labels.join() !== labels.join())) {
    setShown({ count: targets.length, labels })
  }

  return (
    <SelectionBarShell count={shown.count} onClear={selection?.clear} open={open}>
      {share ? (
        <button
          aria-label={`Share ${share.length} ${share.length === 1 ? "template" : "templates"}`}
          className={BAR_BUTTON}
          onClick={() => setSharing(true)}
          type="button"
        >
          <UserPlus aria-hidden="true" className="size-4 opacity-80" />
          <span className="max-md:hidden">Share</span>
        </button>
      ) : null}
      {shown.labels.map((label) => {
        const Icon = CHANGE_ICONS[label]

        return (
          <button
            aria-label={describeTemplateChange(label, shown.count)}
            className={BAR_BUTTON}
            key={label}
            onClick={() => (label === "Category" ? setFiling(true) : run(label))}
            type="button"
          >
            <Icon aria-hidden="true" className="size-4 opacity-80" />
            <span className="max-md:hidden">{label}</span>
          </button>
        )
      })}
      <CategoryDialog count={shown.count} onChoose={(category) => run("Category", category)} onOpenChange={setFiling} open={filing} />
      {share ? <ShareDialog name="" onOpenChange={setSharing} open={sharing} resources={share} /> : null}
    </SelectionBarShell>
  )
}
