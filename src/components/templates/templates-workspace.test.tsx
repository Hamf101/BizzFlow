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
    category: null,
    content: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    id: DRAFT_ID,
    organizationId: ORG_ID,
    revision: 1,
    status: "draft",
    title: "Vendor intake",
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
    canManage: boolean
    templates: DocumentTemplateCard[]
    total: number
    view: TemplateListView
  }> = {}
): void {
  const templates = overrides.templates ?? library

  render(
    <TemplatesWorkspace
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
  it("leads with the title and count, one search, and status pills for people who manage templates", () => {
    renderWorkspace({ total: 12 })

    expect(document.querySelector("h1")?.textContent).toBe("Templates 12")
    expect(
      document.querySelector("h1 span")?.getAttribute("aria-label")
    ).toBe("12 templates")
    expect(
      document.querySelector('input[type="search"]')?.getAttribute("aria-label")
    ).toBe("Search templates")
    expect(
      document.querySelector('nav[aria-label="Filter templates by status"]')
        ?.textContent
    ).toBe("AllDraftsPublishedArchived")
  })

  it("draws each template's real first page on its card, and a blank page when there is nothing to draw", () => {
    renderWorkspace()

    expect(readCards("template-title")).toEqual([
      "Vendor intake",
      "Lease renewal",
      "Old checklist",
    ])
    // The template's own words, not a picture of a page.
    expect(readCards("template-page")[1]).toContain("Supporting information")
    expect(readCards("template-page")[0]).toBe("")
  })

  it("marks each card with its status and category, or when it last changed", () => {
    renderWorkspace()

    expect(readCards("template-status")).toEqual(["Draft", "Published", "Archived"])
    expect(readCards("template-detail")).toEqual([
      "·Updated Sep 2, 2026",
      "·Leasing",
      "·Updated Sep 2, 2026",
    ])
  })

  it("opens drafts and published templates in the editor and leaves archived ones read-only", () => {
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
    ).toEqual(["Actions for Vendor intake", "Actions for Lease renewal"])
  })

  it("starts a new template from the front of the library, and nowhere else", () => {
    renderWorkspace()

    const tiles = document.querySelectorAll('[data-slot="template-new"]')
    expect(tiles).toHaveLength(1)
    expect(document.querySelector('[data-slot="template-library"] > li')).toBe(
      tiles[0]
    )
    expect(tiles[0]?.querySelector("a")?.getAttribute("href")).toBe(
      "/templates/new"
    )
    expect(tiles[0]?.textContent).toBe("New template")

    renderWorkspace({ view: templateListState.parse({ q: "lease" }) })
    expect(document.querySelector('[data-slot="template-new"]')).toBeNull()

    renderWorkspace({ total: 120, view: templateListState.parse({ page: "2" }) })
    expect(document.querySelector('[data-slot="template-new"]')).toBeNull()
  })

  it("keeps editing, menus, pills, statuses, and new templates to people who manage templates", () => {
    renderWorkspace({ canManage: false, templates: [library[1]] })

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

  it("carries the rest of the view into a new search", () => {
    renderWorkspace({
      view: templateListState.parse({
        category: "Leasing",
        page: "2",
        q: "old",
        size: "25",
        status: "draft",
      }),
    })

    const form = document.querySelector('form[role="search"]')

    expect(form?.getAttribute("action")).toBe("/templates")
    expect(
      [...(form?.querySelectorAll('input[type="hidden"]') ?? [])].map(
        (input: Element) => [input.getAttribute("name"), input.getAttribute("value")]
      )
    ).toEqual([
      ["category", "Leasing"],
      ["status", "draft"],
      ["size", "25"],
    ])
    expect(form?.querySelector('input[name="q"]')?.getAttribute("value")).toBe("old")
  })

  it("pages with the rest of the view kept in each link, and no link past either end", () => {
    const readPagination = (page: string): Array<string | null | undefined> => {
      renderWorkspace({
        total: 120,
        view: templateListState.parse({ page, q: "lease" }),
      })
      const pagination = document.querySelector('nav[aria-label="Pagination"]')

      return [
        pagination?.textContent,
        pagination?.querySelector('a[rel="prev"]')?.getAttribute("href"),
        pagination?.querySelector('a[rel="next"]')?.getAttribute("href"),
      ]
    }

    expect(readPagination("1")).toEqual([
      expect.stringContaining("1–50 of 120"),
      undefined,
      "/templates?q=lease&page=2",
    ])
    expect(readPagination("3")).toEqual([
      expect.stringContaining("101–120 of 120"),
      "/templates?q=lease&page=2",
      undefined,
    ])
  })
})
