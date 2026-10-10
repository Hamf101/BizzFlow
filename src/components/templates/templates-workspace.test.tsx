// @vitest-environment jsdom

import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"

import {
  templateListState,
  type TemplateListView,
} from "@/components/templates/template-list-view"
import { TemplatesWorkspace } from "@/components/templates/templates-workspace"
import {
  createBlankTemplateContent,
  type DocumentTemplateCard,
  type TemplateContent,
} from "@/types/template"

const ORG_ID = "10000000-0000-4000-8000-000000000001"
const DRAFT_ID = "30000000-0000-4000-8000-000000000001"
const PUBLISHED_ID = "30000000-0000-4000-8000-000000000002"
const ARCHIVED_ID = "30000000-0000-4000-8000-000000000003"

const leaseContent: TemplateContent = {
  ...createBlankTemplateContent(),
  blocks: [
    {
      alignment: "left",
      id: "50000000-0000-4000-8000-000000000001",
      level: 2,
      text: "Supporting information",
      type: "heading",
    },
  ],
}

function createTemplate(
  overrides: Partial<DocumentTemplateCard> = {}
): DocumentTemplateCard {
  return {
    canEdit: true,
    category: null,
    content: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    id: DRAFT_ID,
    organizationId: ORG_ID,
    revision: 1,
    status: "draft",
    title: "Vendor intake",
    trashedAt: null,
    updatedAt: "2026-09-02T09:00:00.000Z",
    ...overrides,
  }
}

const library = [
  createTemplate(),
  createTemplate({
    category: "Leasing",
    content: leaseContent,
    id: PUBLISHED_ID,
    status: "published",
    title: "Lease renewal",
  }),
  createTemplate({ id: ARCHIVED_ID, status: "archived", title: "Old checklist" }),
]

async function duplicateAction(): Promise<void> {}

afterEach(() => {
  document.body.replaceChildren()
})

function render(ui: ReactElement): void {
  document.body.innerHTML = renderToStaticMarkup(ui)
}

function renderWorkspace(
  overrides: Partial<{
    canCreate: boolean
    canManage: boolean
    templates: DocumentTemplateCard[]
    total: number
    view: TemplateListView
  }> = {}
): void {
  const templates = overrides.templates ?? library

  render(
    <TemplatesWorkspace
      canCreate={overrides.canCreate ?? overrides.canManage ?? true}
      canManage={overrides.canManage ?? true}
      categories={["Leasing"]}
      duplicateAction={duplicateAction}
      savedViews={[]}
      templates={templates}
      total={overrides.total ?? templates.length}
      view={overrides.view ?? templateListState.parse({})}
    />
  )
}

function readCards(slot: string): Array<string | null | undefined> {
  return [...document.querySelectorAll('[data-slot="template-card"]')].map(
    (card: Element): string | null | undefined =>
      card.querySelector(`[data-slot="${slot}"]`)?.textContent
  )
}

describe("TemplatesWorkspace", () => {
  it("opens drafts and published templates in the editor and leaves archived ones read-only, with a way to restore them", () => {
    renderWorkspace()

    expect(
      [...document.querySelectorAll('a[data-slot="template-title"]')].map(
        (link: Element) => link.getAttribute("href")
      )
    ).toEqual([`/templates/${DRAFT_ID}/edit`, `/templates/${PUBLISHED_ID}/edit`])
    expect(
      document.querySelector('[data-slot="template-title"]:not(a)')?.textContent
    ).toBe("Old checklist")
    expect(
      [...document.querySelectorAll('button[aria-label^="Actions for"]')].map(
        (button: Element) => button.getAttribute("aria-label")
      )
    ).toEqual(["Actions for Vendor intake", "Actions for Lease renewal", "Actions for Old checklist"])
  })

  it("gives staff who make templates their own to edit, and only copies of the rest", () => {
    renderWorkspace({
      canCreate: true,
      canManage: false,
      templates: [createTemplate({ id: DRAFT_ID, title: "Mine" }), createTemplate({ canEdit: false, id: PUBLISHED_ID, status: "published", title: "Theirs" })],
    })

    expect(document.querySelector('a[href="/templates/new"]')).not.toBeNull()
    expect(
      [...document.querySelectorAll('a[data-slot="template-title"]')].map((link: Element) => link.getAttribute("href"))
    ).toEqual([`/templates/${DRAFT_ID}/edit`])
    expect(
      [...document.querySelectorAll('button[aria-label^="Actions for"]')].map((button: Element) => button.getAttribute("aria-label"))
    ).toEqual(["Actions for Mine", "Actions for Theirs"])
    expect(readCards("template-status")).toEqual(["Draft", undefined])
    // Their own template moved to Trash is still in reach.
    expect(
      [...document.querySelectorAll('nav[aria-label="Filter templates by status"] a')].map((link: Element) => link.textContent)
    ).toEqual(["All", "Trash"])
  })

  it("keeps editing, menus, pills, statuses, and new templates to people who manage templates", () => {
    renderWorkspace({ canCreate: false, canManage: false, templates: [createTemplate({ ...library[1], canEdit: false })] })

    expect(
      document.querySelector('nav[aria-label="Filter templates by status"]')
    ).toBeNull()
    expect(document.querySelector('a[href="/templates/new"]')).toBeNull()
    expect(document.querySelector('[data-slot="template-card"] a')).toBeNull()
    expect(document.querySelector('button[aria-label^="Actions for"]')).toBeNull()
    expect(readCards("template-status")).toEqual([undefined])
    expect(readCards("template-detail")).toEqual(["Leasing"])
  })

  it("tells an empty library from a view that matches nothing", () => {
    renderWorkspace({ canManage: false, templates: [], total: 0 })

    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "No templates yet."
    )
    expect(document.querySelector('[data-slot="template-library"]')).toBeNull()

    // Someone who manages templates gets the tile that starts the first one.
    renderWorkspace({ templates: [], total: 0 })

    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "No templates yet."
    )
    expect(document.querySelector('[data-slot="template-new"]')).not.toBeNull()

    renderWorkspace({
      templates: [],
      total: 0,
      view: templateListState.parse({ category: "Leasing" }),
    })

    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "No templates match this view."
    )
    expect(document.querySelector('[data-slot="template-library"]')).toBeNull()
  })

  it("shows the words the view is narrowed to, and clears only them", () => {
    renderWorkspace({
      view: templateListState.parse({
        category: "Leasing",
        page: "2",
        q: "old",
        size: "25",
        status: "draft",
      }),
    })

    const chip = document.querySelector('[data-slot="list-query"]')

    expect(chip?.textContent).toContain("Matching “old”")
    expect(chip?.getAttribute("href")).toBe("/templates?category=Leasing&status=draft&size=25")
  })

  it("has a Trash that says when each template there goes for good, and when it is empty", () => {
    const trash = templateListState.parse({ status: "trash" })

    renderWorkspace({
      templates: [createTemplate({ id: ARCHIVED_ID, status: "archived", title: "Old checklist", trashedAt: "2026-09-01T12:00:00.000Z" })],
      view: trash,
    })

    expect(
      [...document.querySelectorAll('nav[aria-label="Filter templates by status"] a')].map((link: Element) => link.textContent)
    ).toEqual(["All", "Drafts", "Published", "Archived", "Trash"])
    expect(document.querySelector('nav[aria-label="Filter templates by status"] a[aria-current="true"]')?.textContent).toBe("Trash")
    // 30 days after it went to Trash.
    expect(readCards("template-detail")[0]).toContain("Deletes on Oct 1, 2026")
    expect(document.querySelector('a[data-slot="template-title"]')).toBeNull()
    expect(document.querySelector('[data-slot="template-new"]')).toBeNull()

    renderWorkspace({ templates: [], total: 0, view: trash })

    expect(document.querySelector('[role="status"]')?.textContent).toBe("Trash is empty.")
  })
})
