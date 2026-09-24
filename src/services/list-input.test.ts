import { describe, expect, it } from "vitest"

import { MAX_LIST_PAGE, type ListSort } from "@/lib/list-state"
import { createListInputValidators } from "@/services/list-input"

class WidgetServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
  }
}

const widgets = createListInputValidators({
  label: "Widget",
  maxPageSize: 50,
  maxSearchLength: 5,
  reject: (message: string): Error => new WidgetServiceError(message, 400),
  sortKeys: ["name", "created"],
})

function refusal(run: () => unknown): unknown {
  try {
    run()
  } catch (error: unknown) {
    return error
  }

  return undefined
}

describe("list input validators", () => {
  it("accepts every page from the first to the last a list links to", () => {
    expect(widgets.page(1)).toBe(1)
    expect(widgets.page(MAX_LIST_PAGE)).toBe(MAX_LIST_PAGE)
  })

  it("refuses a page that is not a whole number in range with the service's own 400", () => {
    for (const page of [0, -1, 1.5, Number.NaN, MAX_LIST_PAGE + 1]) {
      expect(refusal(() => widgets.page(page))).toMatchObject({
        message: `Widget page must be a whole number from 1 to ${MAX_LIST_PAGE}.`,
        statusCode: 400,
      })
    }

    expect(refusal(() => widgets.page(0))).toBeInstanceOf(WidgetServiceError)
  })

  it("accepts page sizes up to the list's largest and refuses the rest", () => {
    expect(widgets.pageSize(1)).toBe(1)
    expect(widgets.pageSize(50)).toBe(50)

    for (const pageSize of [0, 51, 2.5]) {
      expect(refusal(() => widgets.pageSize(pageSize))).toMatchObject({
        message: "Widget page size must be between 1 and 50.",
        statusCode: 400,
      })
    }
  })

  it("accepts the list's own orders in either direction and nothing else", () => {
    expect(widgets.sort({ direction: "desc", key: "created" })).toEqual({
      direction: "desc",
      key: "created",
    })
    expect(widgets.sort({ direction: "asc", key: "name" })).toEqual({
      direction: "asc",
      key: "name",
    })

    for (const sort of [
      { direction: "asc", key: "title" },
      { direction: "up", key: "name" },
    ]) {
      expect(
        refusal(() => widgets.sort(sort as unknown as ListSort<string>))
      ).toMatchObject({
        message: "Widget list order is not supported.",
        statusCode: 400,
      })
    }
  })

  it("trims a search, reads blank as no search, and counts characters, not code units", () => {
    expect(widgets.search("  lease ")).toBe("lease")
    expect(widgets.search("   ")).toBeNull()
    expect(widgets.search(undefined)).toBeNull()
    // Five emoji are five characters, though each takes two UTF-16 units.
    expect(widgets.search("🏠🏠🏠🏠🏠")).toBe("🏠🏠🏠🏠🏠")
    expect(refusal(() => widgets.search("leases"))).toMatchObject({
      message: "Widget search must be 5 characters or fewer.",
      statusCode: 400,
    })
  })

  it("refuses any search on a list without one, but reads blank as no search", () => {
    const unsearchable = createListInputValidators({
      label: "Gadget",
      maxPageSize: 10,
      reject: (message: string): Error => new WidgetServiceError(message, 400),
      sortKeys: ["created"],
    })

    expect(unsearchable.search("  ")).toBeNull()
    expect(refusal(() => unsearchable.search("lease"))).toMatchObject({
      message: "Gadget list has no search.",
      statusCode: 400,
    })
  })
})
