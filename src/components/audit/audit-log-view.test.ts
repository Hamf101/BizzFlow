import { describe, expect, it } from "vitest"

import {
  auditLogListState,
  formatAuditAction,
  getAuditKindOptions,
  getAuditTargetTypes,
  getAuditViewMenuSections,
  isAuditViewAdjusted,
} from "@/components/audit/audit-log-view"

// Page 3 of the oldest-first task history at the larger page size.
const view = auditLogListState.parse({
  kind: "tasks",
  page: "3",
  size: "100",
  sort: "created",
})

describe("audit log view", () => {
  it("offers each kind of record as a link that keeps the order and page size but starts on page one", () => {
    expect(getAuditKindOptions(view)).toEqual([
      { href: "/audit-log?sort=created&size=100", label: "All", selected: false },
      {
        href: "/audit-log?kind=documents&sort=created&size=100",
        label: "Documents",
        selected: false,
      },
      {
        href: "/audit-log?kind=submissions&sort=created&size=100",
        label: "Submissions",
        selected: false,
      },
      {
        href: "/audit-log?kind=tasks&sort=created&size=100",
        label: "Tasks",
        selected: true,
      },
      {
        href: "/audit-log?kind=people&sort=created&size=100",
        label: "People",
        selected: false,
      },
      {
        href: "/audit-log?kind=notifications&sort=created&size=100",
        label: "Notifications",
        selected: false,
      },
    ])
  })

  it.each([
    ["documents", ["folder", "document", "document_version"]],
    ["submissions", ["submission"]],
    ["tasks", ["task", "task_reminder"]],
    ["people", ["organization", "invite", "membership", "organization_role"]],
    ["notifications", ["notification"]],
  ])("reads the %s kind as its record types", (kind, targetTypes) => {
    expect(getAuditTargetTypes(auditLogListState.parse({ kind }))).toEqual(targetTypes)
  })

  it("reads every record type when no kind is chosen", () => {
    expect(getAuditTargetTypes(auditLogListState.parse({}))).toBeUndefined()
  })

  it("keeps the order and a download of this view behind the view menu", () => {
    expect(getAuditViewMenuSections(view)).toEqual([
      {
        label: "Sort",
        options: [
          { href: "/audit-log?kind=tasks&size=100", label: "Newest first", selected: false },
          {
            href: "/audit-log?kind=tasks&sort=created&size=100",
            label: "Oldest first",
            selected: true,
          },
        ],
      },
      {
        label: "Export",
        options: [
          {
            download: true,
            href: "/api/export/audit-log?kind=tasks&sort=created",
            label: "Download CSV",
            selected: false,
          },
        ],
      },
    ])
  })

  it.each([
    ["the default view", {}, false],
    ["a kind, which stays visible", { kind: "tasks" }, false],
    ["the oldest-first order", { sort: "created" }, true],
    ["another page size", { size: "100" }, true],
  ])("reports whether the view menu holds a change for %s", (_case, params, expected) => {
    expect(isAuditViewAdjusted(auditLogListState.parse(params))).toBe(expected)
  })

  it.each([
    ["task.created", "Task created"],
    ["membership.role_updated", "Membership role updated"],
    ["document_version.download_url_issued", "Document version download URL issued"],
  ] as const)("names %s as %s", (action, label) => {
    expect(formatAuditAction(action)).toBe(label)
  })
})
