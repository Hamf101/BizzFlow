import { canPerformOrganizationAction } from "@/lib/permissions"
import { createListInputValidators } from "@/services/list-input"
import {
  escapeLikePattern,
  readCountedPage,
} from "@/services/postgrest-paging"
import {
  DOCUMENT_TEMPLATE_STATUSES,
  TEMPLATE_SEARCH_MAX_LENGTH,
  TEMPLATE_SORT_KEYS,
  type DocumentTemplateStatus,
  type DocumentTemplateSummaryRow,
  type TemplateSortKey,
} from "@/types/template"

import type {
  ListTemplatePageInput,
  TemplatePage,
  TemplateServiceClient,
  TemplateServiceDeps,
} from "./contracts"
import { TemplateServiceError } from "./errors"
import {
  createDatabaseError,
  getClient,
  mapDocumentTemplateSummary,
  normalizeCategory,
  requirePermission,
  runTemplateOperation,
  TEMPLATE_SUMMARY_COLUMNS,
} from "./shared"

const MAX_TEMPLATE_PAGE_SIZE = 100

const TEMPLATE_LIST_INPUT = createListInputValidators({
  label: "Template",
  maxPageSize: MAX_TEMPLATE_PAGE_SIZE,
  maxSearchLength: TEMPLATE_SEARCH_MAX_LENGTH,
  reject: (message: string): Error => new TemplateServiceError(message, 400),
  sortKeys: TEMPLATE_SORT_KEYS,
})

const TEMPLATE_SORT_COLUMNS: Record<TemplateSortKey, string> = {
  created: "created_at",
  title: "title",
  updated: "updated_at",
}

/** Who is asking, and which of their visible templates a view shows. */
type TemplateListFilters = {
  canManage: boolean
  /** A category, null for uncategorised templates, or undefined for all. */
  category: string | null | undefined
  organizationId: string
  query: string | null
  statuses: readonly DocumentTemplateStatus[] | null
}

// Filters go through a minimal view of the query builder: relating
// PostgREST's generated builder type to an interface makes the compiler give
// up (TS2589), and every filter returns the same builder at runtime.
type TemplateFilterQuery = {
  eq(column: string, value: string): TemplateFilterQuery
  ilike(column: string, pattern: string): TemplateFilterQuery
  in(column: string, values: readonly string[]): TemplateFilterQuery
  is(column: string, value: null): TemplateFilterQuery
}

/**
 * Lists one page of the templates an actor may see, searched, filtered, and
 * sorted by a view.
 *
 * Owners and managers see every status; everyone else sees published
 * templates only. Rows leave template content behind.
 *
 * @param input - Actor, tenant, page, order, and view filters.
 * @param deps - Optional trusted database dependency.
 * @returns The page's templates and how many match the view.
 * @throws TemplateServiceError when access, validation, or a read fails.
 */
export async function listTemplatePage(
  input: ListTemplatePageInput,
  deps: TemplateServiceDeps = {}
): Promise<TemplatePage> {
  return runTemplateOperation(
    "list_template_page",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      page: input.page,
      pageSize: input.pageSize,
    },
    async (): Promise<TemplatePage> => {
      const client = getClient(deps)
      const subject = await requirePermission(
        client,
        input.organizationId,
        input.actorUserId,
        "templates:view",
        "You cannot view document templates."
      )
      const page = TEMPLATE_LIST_INPUT.page(input.page)
      const pageSize = TEMPLATE_LIST_INPUT.pageSize(input.pageSize)
      const sort = TEMPLATE_LIST_INPUT.sort(input.sort)
      const filters: TemplateListFilters = {
        canManage: canPerformOrganizationAction(subject, "templates:manage"),
        category:
          input.category === undefined
            ? undefined
            : normalizeCategory(input.category),
        organizationId: input.organizationId,
        query: TEMPLATE_LIST_INPUT.search(input.query),
        statuses: normalizeTemplateStatusFilter(input.statuses),
      }
      const from = (page - 1) * pageSize
      const { rows, total } = await readCountedPage(
        await filterVisibleTemplates(
          client
            .from("document_templates")
            .select(TEMPLATE_SUMMARY_COLUMNS, { count: "exact" }),
          filters
        )
          // The id breaks ties, so a page boundary never repeats or skips a
          // template.
          .order(TEMPLATE_SORT_COLUMNS[sort.key], {
            ascending: sort.direction === "asc",
          })
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1),
        () => countVisibleTemplates(client, filters),
        (error: unknown): Error =>
          createDatabaseError(error, "Unable to load document templates.")
      )

      return {
        page,
        pageSize,
        templates: (rows as unknown as DocumentTemplateSummaryRow[]).map(
          mapDocumentTemplateSummary
        ),
        total,
      }
    }
  )
}

function filterVisibleTemplates<TQuery>(
  query: TQuery,
  filters: TemplateListFilters
): TQuery {
  let filtered = (query as unknown as TemplateFilterQuery).eq(
    "org_id",
    filters.organizationId
  )

  if (!filters.canManage) {
    filtered = filtered.eq("status", "published")
  }

  if (filters.statuses !== null) {
    filtered = filtered.in("status", filters.statuses)
  }

  if (filters.category === null) {
    filtered = filtered.is("category", null)
  } else if (filters.category !== undefined) {
    filtered = filtered.eq("category", filters.category)
  }

  if (filters.query !== null) {
    filtered = filtered.ilike("title", `%${escapeLikePattern(filters.query)}%`)
  }

  return filtered as unknown as TQuery
}

async function countVisibleTemplates(
  client: TemplateServiceClient,
  filters: TemplateListFilters
): Promise<number> {
  const { count, error } = await filterVisibleTemplates(
    client.from("document_templates").select("id", { count: "exact", head: true }),
    filters
  )

  if (error) {
    throw createDatabaseError(error, "Unable to load document templates.")
  }

  return count ?? 0
}

function normalizeTemplateStatusFilter(
  value: readonly string[] | undefined
): DocumentTemplateStatus[] | null {
  const statuses = Array.from(new Set(value ?? []))

  if (statuses.length === 0) {
    return null
  }

  if (
    statuses.some(
      (status: string): boolean =>
        !DOCUMENT_TEMPLATE_STATUSES.includes(status as DocumentTemplateStatus)
    )
  ) {
    throw new TemplateServiceError("Template status filter is not supported.", 400)
  }

  return statuses as DocumentTemplateStatus[]
}
