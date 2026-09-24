import { z } from "zod"

import {
  createSortSection,
  RECORD_SORT_OPTIONS,
  type ListOption,
  type ListOptionSection,
} from "@/components/data/list-option"
import { defineListState, formatListSort } from "@/lib/list-state"
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

const TEMPLATE_STATUS_LABELS: Record<DocumentTemplateStatus, string> = {
  archived: "Archived",
  draft: "Drafts",
  published: "Published",
}

/** The Templates page's URL state; unknown or stale values open the default view. */
export const templateListState = defineListState({
  filters: {
    category: z.string().trim().min(1).max(TEMPLATE_CATEGORY_MAX_LENGTH),
    status: z.enum(DOCUMENT_TEMPLATE_STATUSES),
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
  return view.filters.status === undefined ? undefined : [view.filters.status]
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
 * @returns "All" followed by one option per template status.
 */
export function getTemplateStatusOptions(view: TemplateListView): ListOption[] {
  return [
    {
      href: templateListState.href(TEMPLATES_PATH, view, {
        filters: { status: undefined },
      }),
      label: "All",
      selected: view.filters.status === undefined,
    },
    ...DOCUMENT_TEMPLATE_STATUSES.map(
      (status: DocumentTemplateStatus): ListOption => ({
        href: templateListState.href(TEMPLATES_PATH, view, {
          filters: { status },
        }),
        label: TEMPLATE_STATUS_LABELS[status],
        selected: view.filters.status === status,
      })
    ),
  ]
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
    view.filters.category !== undefined ||
    formatListSort(view.sort) !== formatListSort(DEFAULT_TEMPLATE_VIEW.sort) ||
    view.pageSize !== DEFAULT_TEMPLATE_VIEW.pageSize
  )
}

/**
 * Lists the fields a new search carries over: everything except the old
 * query and the page, so the search starts on page one of the same view.
 *
 * @param view - Current Templates view.
 * @returns Name and value pairs for hidden form fields.
 */
export function getTemplateSearchFields(
  view: TemplateListView
): Array<[name: string, value: string]> {
  return Array.from(
    templateListState.toSearchParams({ ...view, page: 1, query: "" }).entries()
  )
}
