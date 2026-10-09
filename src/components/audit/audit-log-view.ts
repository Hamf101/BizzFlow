import { z } from "zod"

import {
  createFilterOptions,
  createSortSection,
  isOrderOrSizeAdjusted,
  type ListOption,
  type ListOptionSection,
} from "@/components/data/list-option"
import {
  defineListState,
  type ListSort,
} from "@/lib/list-state"
import {
  AUDIT_LOG_SORT_KEYS,
  type AuditLogSortKey,
  type AuditLogTargetType,
} from "@/types/audit"

const AUDIT_LOG_PATH = "/audit-log"
const AUDIT_EXPORT_PATH = "/api/export/audit-log"

// Kinds of record the log can be narrowed to, in pill order. People gathers
// the organization, its invites, memberships, and access roles.
const AUDIT_LOG_KINDS = {
  documents: {
    label: "Documents",
    targetTypes: ["folder", "document", "document_version"],
  },
  submissions: { label: "Submissions", targetTypes: ["submission"] },
  tasks: { label: "Tasks", targetTypes: ["task", "task_reminder"] },
  people: {
    label: "People",
    targetTypes: ["organization", "invite", "membership", "organization_role"],
  },
  notifications: { label: "Notifications", targetTypes: ["notification"] },
} as const satisfies Record<
  string,
  { label: string; targetTypes: readonly AuditLogTargetType[] }
>

type AuditLogKind = keyof typeof AUDIT_LOG_KINDS

const AUDIT_LOG_KIND_KEYS = Object.keys(AUDIT_LOG_KINDS) as [
  AuditLogKind,
  ...AuditLogKind[],
]

/** The audit log's URL state; unknown or stale values open the default view. */
export const auditLogListState = defineListState({
  filters: { kind: z.enum(AUDIT_LOG_KIND_KEYS) },
  pageSizes: [50, 100],
  sort: {
    default: { direction: "desc", key: "created" },
    keys: AUDIT_LOG_SORT_KEYS,
  },
})

/** One validated audit log view. */
export type AuditLogView = ReturnType<typeof auditLogListState.parse>

const DEFAULT_AUDIT_VIEW = auditLogListState.parse({})

const AUDIT_SORT_OPTIONS: ReadonlyArray<{
  label: string
  sort: ListSort<AuditLogSortKey>
}> = [
  { label: "Newest first", sort: { direction: "desc", key: "created" } },
  { label: "Oldest first", sort: { direction: "asc", key: "created" } },
]

const ACRONYMS: Readonly<Record<string, string>> = {
  csv: "CSV",
  id: "ID",
  sms: "SMS",
  url: "URL",
}

/**
 * Reads the record types behind the chosen kind.
 *
 * @param view - Current audit log view.
 * @returns The kind's record types, or undefined for every kind.
 */
export function getAuditTargetTypes(
  view: AuditLogView
): readonly AuditLogTargetType[] | undefined {
  return view.filters.kind
    ? AUDIT_LOG_KINDS[view.filters.kind].targetTypes
    : undefined
}

/**
 * Lists the kind pills, each a link that keeps the order and page size.
 *
 * @param view - Current audit log view.
 * @returns "All" followed by one option per kind of record.
 */
export function getAuditKindOptions(view: AuditLogView): ListOption[] {
  return createFilterOptions(AUDIT_LOG_KIND_KEYS, view.filters.kind, (kind) => AUDIT_LOG_KINDS[kind].label, (kind) =>
    auditLogListState.href(AUDIT_LOG_PATH, view, { filters: { kind } })
  )
}

/**
 * Lists what the view menu keeps out of sight: the order, and a download of
 * exactly the events this view shows.
 *
 * @param view - Current audit log view.
 * @returns The Sort and Export sections.
 */
export function getAuditViewMenuSections(
  view: AuditLogView
): ListOptionSection[] {
  return [
    createSortSection(AUDIT_SORT_OPTIONS, view.sort, (sort): string =>
      auditLogListState.href(AUDIT_LOG_PATH, view, { sort })
    ),
    {
      label: "Export",
      options: [
        {
          download: true,
          href: auditLogListState.href(AUDIT_EXPORT_PATH, view, {
            page: 1,
            pageSize: DEFAULT_AUDIT_VIEW.pageSize,
          }),
          label: "Download CSV",
          selected: false,
        },
      ],
    },
  ]
}

/**
 * Reports whether a setting that only the view menu shows differs from the
 * default, so the menu can say so.
 *
 * @param view - Current audit log view.
 * @returns True when the order or page size is not the default.
 */
export function isAuditViewAdjusted(view: AuditLogView): boolean {
  return isOrderOrSizeAdjusted(view, DEFAULT_AUDIT_VIEW)
}

/**
 * Names an audit action in plain words, such as "Task created".
 *
 * @param action - Recorded audit action.
 * @returns Sentence-case label with common acronyms kept upper-case.
 */
export function formatAuditAction(action: string): string {
  const sentence = action
    .split(/[._]/)
    .map((word: string): string => ACRONYMS[word] ?? word)
    .join(" ")

  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}
