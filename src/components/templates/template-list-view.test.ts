import { describe, expect, it } from "vitest"

import {
  getTemplateSearchFields,
  getTemplateStatusOptions,
  getTemplateViewCategory,
  getTemplateViewMenuSections,
  getTemplateViewStatuses,
  isTemplateViewAdjusted,
  templateListState,
} from "@/components/templates/template-list-view"

// Page 3 of a searched, re-ordered list with a smaller page size.
const view = templateListState.parse({
  page: "3",
  q: "lease",
  size: "25",
  sort: "title",
})

describe("template list view", () => {
  it("offers each status as a link that keeps the search, order, and page size but starts on page one", () => {
    expect(getTemplateStatusOptions(view)).toEqual([
      { href: "/templates?q=lease&sort=title&size=25", label: "All", selected: true },
      {
        href: "/templates?status=draft&q=lease&sort=title&size=25",
        label: "Drafts",
        selected: false,
      },
      {
        href: "/templates?status=published&q=lease&sort=title&size=25",
        label: "Published",
        selected: false,
      },
      {
        href: "/templates?status=archived&q=lease&sort=title&size=25",
        label: "Archived",
        selected: false,
      },
    ])
  })

  it("reads the status pill as the one status it stands for", () => {
    expect(
      getTemplateViewStatuses(templateListState.parse({ status: "archived" }))
    ).toEqual(["archived"])
    expect(getTemplateViewStatuses(templateListState.parse({}))).toBeUndefined()
    expect(
      getTemplateViewStatuses(templateListState.parse({ status: "retired" }))
    ).toBeUndefined()
  })

  it("reads the category filter as one category, no category, or all", () => {
    expect(
      getTemplateViewCategory(templateListState.parse({ category: "Safety" }))
    ).toBe("Safety")
    expect(
      getTemplateViewCategory(templateListState.parse({ category: "none" }))
    ).toBeNull()
    expect(getTemplateViewCategory(templateListState.parse({}))).toBeUndefined()
    // Longer than any category can be, so it opens the default view.
    expect(
      getTemplateViewCategory(templateListState.parse({ category: "x".repeat(41) }))
    ).toBeUndefined()
  })

  it("keeps order and category behind the view menu", () => {
    const [sort, category] = getTemplateViewMenuSections(view, [
      "Field Operations",
      "Safety",
    ])

    expect(
      sort.options.filter((option) => option.selected).map((option) => option.label)
    ).toEqual(["Title, A to Z"])
    expect(sort.options[0]).toEqual({
      href: "/templates?q=lease&size=25",
      label: "Recently updated",
      selected: false,
    })
    expect(category).toEqual({
      label: "Category",
      options: [
        { href: "/templates?q=lease&sort=title&size=25", label: "All categories", selected: true },
        {
          href: "/templates?category=Field+Operations&q=lease&sort=title&size=25",
          label: "Field Operations",
          selected: false,
        },
        {
          href: "/templates?category=Safety&q=lease&sort=title&size=25",
          label: "Safety",
          selected: false,
        },
        {
          href: "/templates?category=none&q=lease&sort=title&size=25",
          label: "No category",
          selected: false,
        },
      ],
    })
  })

  it("leaves the category section out when no template has a category", () => {
    expect(
      getTemplateViewMenuSections(view, []).map((section) => section.label)
    ).toEqual(["Sort"])
  })

  it("says when a setting that only the view menu shows differs from the default", () => {
    expect(isTemplateViewAdjusted(templateListState.parse({}))).toBe(false)
    expect(
      isTemplateViewAdjusted(templateListState.parse({ q: "lease", status: "draft" }))
    ).toBe(false)
    expect(isTemplateViewAdjusted(templateListState.parse({ category: "Safety" }))).toBe(
      true
    )
    expect(isTemplateViewAdjusted(templateListState.parse({ sort: "title" }))).toBe(true)
    expect(isTemplateViewAdjusted(templateListState.parse({ size: "25" }))).toBe(true)
  })

  it("carries the view into a new search without the old query or page", () => {
    expect(
      getTemplateSearchFields(
        templateListState.parse({
          category: "Safety",
          page: "2",
          q: "old",
          size: "25",
          sort: "title",
          status: "draft",
        })
      )
    ).toEqual([
      ["category", "Safety"],
      ["status", "draft"],
      ["sort", "title"],
      ["size", "25"],
    ])
  })
})
