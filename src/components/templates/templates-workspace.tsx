import { Plus } from "lucide-react"
import Link from "next/link"
import type { CSSProperties, ReactElement } from "react"

import { ListFilterChips } from "@/components/data/list-filter-chips"
import { ListPagination } from "@/components/data/list-pagination"
import { ListSearch } from "@/components/data/list-search"
import { type ListSavedViews, ListViewMenu, ListViewTitle } from "@/components/data/list-view-menu"
import {
  getTemplateSearchFields,
  getTemplateStatusOptions,
  getTemplateViewMenuSections,
  isTemplateViewAdjusted,
  templateListState,
  type TemplateListView,
} from "@/components/templates/template-list-view"
import { TemplatePageThumbnail } from "@/components/templates/template-page-thumbnail"
import { TemplateRowMenu } from "@/components/templates/template-row-menu"
import { buttonVariants } from "@/components/ui/button"
import { formatMediumDate } from "@/lib/date-format"
import { getLastPage } from "@/lib/list-state"
import { cn } from "@/lib/utils"
import {
  TEMPLATE_SEARCH_MAX_LENGTH,
  type DocumentTemplateCard,
  type DocumentTemplateStatus,
} from "@/types/template"

const TEMPLATES_PATH = "/templates"

/** Cards rise in one after another; later cards share the last step's delay. */
const MAX_STAGGERED_CARDS = 10
const CARD_STAGGER_MS = 30

const STATUS_LOOKS: Record<DocumentTemplateStatus, { dot: string; label: string }> = {
  archived: { dot: "bg-destructive", label: "Archived" },
  draft: { dot: "bg-muted-foreground", label: "Draft" },
  published: { dot: "bg-success", label: "Published" },
}

/**
 * Renders the Templates library as cards that each show the template's real
 * first page, the way a document app shows its files: a quiet front with
 * search, status pills for people who manage templates, a clean tile that
 * starts a new template, and every other tool — order, category, and each
 * template's actions — kept behind a menu until it is wanted.
 *
 * @param props - The current view, its page of template cards, and access.
 * @returns The Templates workspace.
 */
export function TemplatesWorkspace({
  canManage,
  categories,
  duplicateAction,
  savedViews,
  templates,
  total,
  view,
}: {
  canManage: boolean
  categories: string[]
  duplicateAction: (formData: FormData) => Promise<void>
  savedViews: ListSavedViews["saved"]
  templates: DocumentTemplateCard[]
  total: number
  view: TemplateListView
}): ReactElement {
  const lastPage = getLastPage(total, view.pageSize)
  const filtered = Boolean(
    view.query || view.filters.status || view.filters.category
  )
  // A new template starts from the library's front page, as a document app's
  // home does; filtered views and later pages keep to what they show.
  const offersNew = canManage && !filtered && view.page === 1

  const listViews: ListSavedViews = {
    list: "templates",
    query: templateListState.toSearchParams({ ...view, page: 1 }).toString(),
    saved: savedViews,
  }

  return (
    <section className="flex flex-col gap-5" data-slot="templates-workspace">
      {/* The real space keeps the accessible name "Templates 12 templates"
          rather than "Templates12 templates". */}
      <h1 className="text-2xl leading-none font-medium tracking-[-0.02em]">
        <ListViewTitle title="Templates" views={listViews} />{" "}
        <span
          aria-label={`${total} ${total === 1 ? "template" : "templates"}`}
          className="ml-0.5 text-xl font-normal text-muted-foreground"
        >
          {total}
        </span>
      </h1>

      <div
        className={cn(
          "grid gap-2",
          canManage
            ? "grid-cols-[minmax(0,1fr)_auto_auto]"
            : "grid-cols-[minmax(0,1fr)_auto]"
        )}
      >
        <ListSearch
          fields={getTemplateSearchFields(view)}
          label="Search templates"
          maxLength={TEMPLATE_SEARCH_MAX_LENGTH}
          path={TEMPLATES_PATH}
          placeholder="Search templates…"
          query={view.query}
        />
        <ListViewMenu
          adjusted={isTemplateViewAdjusted(view)}
          label="View options"
          sections={getTemplateViewMenuSections(view, categories)}
          views={listViews}
        />
        {canManage ? (
          <Link
            className={cn(
              buttonVariants(),
              "h-11 rounded-[12px] px-4 font-normal"
            )}
            href="/templates/new"
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            <span className="max-sm:sr-only">Create template</span>
          </Link>
        ) : null}
      </div>

      {canManage ? (
        <ListFilterChips
          glide
          label="Filter templates by status"
          options={getTemplateStatusOptions(view)}
        />
      ) : null}

      {templates.length === 0 && !offersNew ? (
        <p
          className="py-16 text-center text-sm text-muted-foreground"
          role="status"
        >
          {filtered ? "No templates match this view." : "No templates yet."}
        </p>
      ) : (
        <ul
          aria-label="Templates"
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-4 xl:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]"
          data-slot="template-library"
        >
          {offersNew ? <NewTemplateTile /> : null}
          {templates.map((template: DocumentTemplateCard, index: number) => (
            <TemplateCard
              canManage={canManage}
              duplicateAction={duplicateAction}
              index={index}
              key={template.id}
              template={template}
            />
          ))}
        </ul>
      )}
      {templates.length === 0 && offersNew ? (
        // The tile invites the first template; this says why the rest is empty.
        <p className="sr-only" role="status">
          No templates yet.
        </p>
      ) : null}

      <ListPagination
        nextHref={
          view.page < lastPage
            ? templateListState.href(TEMPLATES_PATH, view, {
                page: view.page + 1,
              })
            : null
        }
        page={view.page}
        pageSize={view.pageSize}
        previousHref={
          view.page > 1
            ? templateListState.href(TEMPLATES_PATH, view, {
                page: view.page - 1,
              })
            : null
        }
        total={total}
      />
    </section>
  )
}

function NewTemplateTile(): ReactElement {
  return (
    <li className="grid" data-slot="template-new">
      <Link
        className="group grid content-center justify-items-center gap-2.5 rounded-[12px] px-2.5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
        href="/templates/new"
      >
        <span
          aria-hidden="true"
          className="grid w-[96px] place-items-center rounded-[8px] border border-dashed border-muted-foreground/40 text-primary transition-colors group-hover:border-primary/60 sm:w-[150px] [&_svg]:size-6"
          style={{ aspectRatio: "595 / 842" }}
        >
          <Plus />
        </span>
        <span className="w-[96px] text-[11.5px] text-foreground sm:w-[150px] sm:text-sm">
          New template
        </span>
      </Link>
    </li>
  )
}

function TemplateCard({
  canManage,
  duplicateAction,
  index,
  template,
}: {
  canManage: boolean
  duplicateAction: (formData: FormData) => Promise<void>
  index: number
  template: DocumentTemplateCard
}): ReactElement {
  // An archived template is read only, even for people who manage templates.
  const editable = canManage && template.status !== "archived"
  const status = STATUS_LOOKS[template.status]
  const detail =
    template.category ?? `Updated ${formatMediumDate(template.updatedAt)}`
  const riseDelay = {
    "--card-delay": `${Math.min(index, MAX_STAGGERED_CARDS) * CARD_STAGGER_MS}ms`,
  } as CSSProperties
  // Phones give a long title two balanced lines rather than a word per line.
  const titleClassName =
    "line-clamp-2 min-h-[2.6em] min-w-0 flex-1 text-[11.5px] leading-[1.3] font-medium text-balance text-foreground sm:line-clamp-1 sm:min-h-0 sm:text-[13.5px] sm:leading-snug"

  return (
    <li
      className="relative grid grid-rows-[auto_1fr_auto] overflow-hidden rounded-[12px] border border-border bg-card/70 transition-[translate,box-shadow,border-color] duration-200 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-backwards motion-safe:[--tw-animation-delay:var(--card-delay)] sm:hover:border-primary/35 sm:hover:shadow-[0_10px_24px_rgba(37,35,41,0.1)] sm:motion-safe:hover:-translate-y-0.5"
      data-slot="template-card"
      style={riseDelay}
    >
      <div className="flex min-w-0 items-start gap-2 px-2.5 pt-2.5 pb-2 sm:px-3.5 sm:pt-3">
        {editable ? (
          // Stretched over the whole card, so any part of it opens the editor.
          <Link
            className={cn(
              titleClassName,
              "outline-none after:absolute after:inset-0 after:rounded-[12px] hover:text-primary focus-visible:after:ring-2 focus-visible:after:ring-ring/35"
            )}
            data-slot="template-title"
            href={`/templates/${encodeURIComponent(template.id)}/edit`}
          >
            {template.title}
          </Link>
        ) : (
          <span className={titleClassName} data-slot="template-title">
            {template.title}
          </span>
        )}
        {editable ? (
          // Above the card's own link, so the menu opens instead of the editor.
          // Phones keep it at the card's foot, so the title keeps the full width.
          <div className="relative z-10 -my-1 -mr-1.5 max-sm:absolute max-sm:right-1.5 max-sm:bottom-0 max-sm:m-0">
            <TemplateRowMenu
              duplicateAction={duplicateAction}
              published={template.status === "published"}
              templateId={template.id}
              title={template.title}
            />
          </div>
        ) : null}
      </div>
      <div className="mx-1.5 grid justify-items-center overflow-hidden rounded-t-[8px] bg-card/45 pt-3 sm:pt-4">
        <TemplatePageThumbnail
          className={cn(
            "-mb-[18%]",
            template.status === "archived" && "opacity-60"
          )}
          content={template.content}
          title={template.title}
        />
      </div>
      <div
        className={cn(
          "flex min-w-0 items-center gap-1.5 border-t border-border/60 px-2.5 py-2 text-[10.5px] text-muted-foreground sm:px-3.5 sm:py-2.5 sm:text-xs",
          editable && "max-sm:pr-10"
        )}
        data-slot="template-meta"
      >
        {canManage ? (
          <>
            <span
              aria-hidden="true"
              className={cn("size-[7px] shrink-0 rounded-full", status.dot)}
            />
            <span data-slot="template-status">{status.label}</span>
          </>
        ) : null}
        <span
          className={cn("truncate", canManage && "max-sm:hidden")}
          data-slot="template-detail"
        >
          {canManage ? (
            <span aria-hidden="true" className="mr-1.5 opacity-50">
              ·
            </span>
          ) : null}
          {detail}
        </span>
      </div>
    </li>
  )
}
