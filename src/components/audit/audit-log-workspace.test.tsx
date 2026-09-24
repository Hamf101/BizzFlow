// @vitest-environment jsdom

import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"

import { auditLogListState } from "@/components/audit/audit-log-view"
import type { AuditLogEntry } from "@/types/audit"
import type { OrganizationMember } from "@/types/organization"

import { AuditLogWorkspace } from "./audit-log-workspace"

const MARA_ID = "20000000-0000-4000-8000-000000000002"

const mara: OrganizationMember = {
  createdAt: "2026-09-01T12:00:00.000Z",
  email: "mara@example.test",
  fullName: "Mara Bell",
  id: "membership-mara",
  role: "manager",
  status: "active",
  userId: MARA_ID,
}

function createEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    action: "task.created",
    actorUserId: MARA_ID,
    createdAt: "2026-09-10T12:00:00.000Z",
    entryHash: "d".repeat(64),
    id: "audit-1",
    metadata: { title: "Chase references" },
    organizationId: "10000000-0000-4000-8000-000000000001",
    prevHash: null,
    seq: 1,
    targetId: null,
    targetType: "task",
    ...overrides,
  }
}

afterEach(() => {
  document.body.replaceChildren()
})

function render(ui: ReactElement): void {
  document.body.innerHTML = renderToStaticMarkup(ui)
}

function renderWorkspace(
  entries: AuditLogEntry[],
  params: Record<string, string> = {}
): void {
  render(
    <AuditLogWorkspace
      entries={entries}
      integrity={null}
      members={[mara]}
      savedViews={[]}
      total={entries.length}
      view={auditLogListState.parse(params)}
    />
  )
}

describe("AuditLogWorkspace", () => {
  it("lists events by name, actor, and time, with their details folded away", () => {
    renderWorkspace([
      createEntry(),
      createEntry({
        action: "invite.created",
        actorUserId: null,
        id: "audit-2",
        metadata: {},
        seq: 2,
        targetType: "invite",
      }),
    ])

    expect(document.querySelector("h1")?.textContent).toBe("Audit log 2")
    expect(
      Array.from(document.querySelectorAll('[data-slot="audit-event"]')).map(
        (event) => ({
          actor: event.querySelector('[data-slot="audit-event-actor"]')?.textContent,
          details: Array.from(event.querySelectorAll("dl > div")).map((pair) => [
            pair.querySelector("dt")?.textContent,
            pair.querySelector("dd")?.textContent,
          ]),
          name: event.querySelector('[data-slot="audit-event-name"]')?.textContent,
          open: event.querySelector("details")?.hasAttribute("open"),
        })
      )
    ).toEqual([
      {
        actor: "Mara Bell",
        details: [
          ["By", "Mara Bell"],
          ["Sequence", "1"],
          ["title", "Chase references"],
        ],
        name: "Task created",
        open: false,
      },
      {
        actor: "System",
        details: [
          ["By", "System"],
          ["Sequence", "2"],
        ],
        name: "Invite created",
        open: false,
      },
    ])
  })

  it.each([
    ["an unfiltered log", {}, "No events yet."],
    ["one kind of record", { kind: "tasks" }, "No events of this kind."],
  ])("says so plainly when %s is empty", (_case, params, message) => {
    renderWorkspace([], params)

    expect(document.querySelector('[role="status"]')?.textContent).toBe(message)
    expect(document.querySelectorAll('[data-slot="audit-event"]')).toHaveLength(0)
  })
})
