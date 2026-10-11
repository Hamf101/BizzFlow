import * as z from "zod"

import {
  createFilterOptions,
  createSortSection,
  isOrderOrSizeAdjusted,
  RECORD_SORT_OPTIONS,
  type ListOption,
  type ListOptionSection,
} from "@/components/data/list-option"
import { defineListState } from "@/lib/list-state"
import {
  DOCUMENT_TEMPLATE_STATUSES,
  TEMPLATE_CATEGORY_MAX_LENGTH,
  TEMPLATE_SEARCH_MAX_LENGTH,
  TEMPLATE_SORT_KEYS,
  type DocumentTemplateStatus,
} from "@/types/template"

const TEMPLATES_PATH = "/templates"

// The category filter's value for templates without a category, as the
// library's links have always spelled it.
const NO_CATEGORY = "none"

// The status pills, ending with Trash, which holds archived templates on their way out.
const TEMPLATE_VIEWS = [...DOCUMENT_TEMPLATE_STATUSES, "trash"] as const

const TEMPLATE_STATUS_LABELS: Record<(typeof TEMPLATE_VIEWS)[number], string> = {
  archived: "Archived",
  draft: "Drafts",
  published: "Published",
  trash: "Trash",
}

/** The Templates page's URL state; unknown or stale values open the default view. */
export const templateListState = defineListState({
  filters: {
    category: z.string().trim().min(1).max(TEMPLATE_CATEGORY_MAX_LENGTH),
    status: z.enum(TEMPLATE_VIEWS),
  },
  pageSizes: [50, 25, 100],
  search: { maxLength: TEMPLATE_SEARCH_MAX_LENGTH },
  sort: {
    default: { direction: "desc", key: "updated" },
    keys: TEMPLATE_SORT_KEYS,
  },
})

/** One validated Templates view. */
export type TemplateListView = ReturnType<typeof templateListState.parse>

const DEFAULT_TEMPLATE_VIEW = templateListState.parse({})

/**
 * Reads the status a view's pill stands for.
 *
 * @param view - Current Templates view.
 * @returns The pill's status, or undefined when every status is shown.
 */
export function getTemplateViewStatuses(
  view: TemplateListView
): readonly DocumentTemplateStatus[] | undefined {
  return view.filters.status === undefined || view.filters.status === "trash" ? undefined : [view.filters.status]
}

/**
 * Whether a view is the Trash.
 *
 * @param view - Current Templates view.
 * @returns True when it lists only the templates in Trash.
 */
export function isTemplateTrashView(view: TemplateListView): boolean {
  return view.filters.status === "trash"
}

/**
 * Reads the category a view narrows to.
 *
 * @param view - Current Templates view.
 * @returns A category, null for templates without one, or undefined for all.
 */
export function getTemplateViewCategory(
  view: TemplateListView
): string | null | undefined {
  return view.filters.category === NO_CATEGORY ? null : view.filters.category
}

/**
 * Lists the status pills, each a link that keeps the rest of the view.
 *
 * @param view - Current Templates view.
 * @param views - The pills offered; someone who only makes their own templates gets Trash alone.
 * @returns "All", then one option per view offered.
 */
export function getTemplateStatusOptions(
  view: TemplateListView,
  views: ReadonlyArray<(typeof TEMPLATE_VIEWS)[number]> = TEMPLATE_VIEWS
): ListOption[] {
  return createFilterOptions(views, view.filters.status, (status) => TEMPLATE_STATUS_LABELS[status], (status) =>
    templateListState.href(TEMPLATES_PATH, view, { filters: { status } })
  )
}

/**
 * Lists the settings kept behind the view menu: order, and category when the
 * library has any.
 *
 * @param view - Current Templates view.
 * @param categories - Every category in use, so a filter never hides the rest.
 * @returns The Sort section and, when there is something to narrow by, Category.
 */
export function getTemplateViewMenuSections(
  view: TemplateListView,
  categories: readonly string[]
): ListOptionSection[] {
  const sort = createSortSection(RECORD_SORT_OPTIONS, view.sort, (option): string =>
    templateListState.href(TEMPLATES_PATH, view, { sort: option })
  )

  // A library without categories has nothing to narrow by, unless a link
  // still carries a category filter that needs clearing.
  if (categories.length === 0 && view.filters.category === undefined) {
    return [sort]
  }

  return [
    sort,
    {
      label: "Category",
      options: [
        {
          href: templateListState.href(TEMPLATES_PATH, view, {
            filters: { category: undefined },
          }),
          label: "All categories",
          selected: view.filters.category === undefined,
        },
        ...categories.map(
          (category: string): ListOption => ({
            href: templateListState.href(TEMPLATES_PATH, view, {
              filters: { category },
            }),
            label: category,
            selected: view.filters.category === category,
          })
        ),
        {
          href: templateListState.href(TEMPLATES_PATH, view, {
            filters: { category: NO_CATEGORY },
          }),
          label: "No category",
          selected: view.filters.category === NO_CATEGORY,
        },
      ],
    },
  ]
}

/**
 * Reports whether a setting that only the view menu shows differs from the
 * default, so the menu can say so.
 *
 * @param view - Current Templates view.
 * @returns True when the category, order, or page size is not the default.
 */
export function isTemplateViewAdjusted(view: TemplateListView): boolean {
  return (
    view.filters.category !== undefined || isOrderOrSizeAdjusted(view, DEFAULT_TEMPLATE_VIEW)
  )
}

