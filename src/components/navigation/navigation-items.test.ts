import { describe, expect, it } from "vitest"

import { getVisibleNavigationItems } from "./navigation-items"

describe("getVisibleNavigationItems", () => {
  it("keeps only universal destinations before an organization is available", () => {
    expect(getVisibleNavigationItems(null).map((item) => item.href)).toEqual([
      "/dashboard",
      "/settings",
    ])
  })

  it("omits destinations an external reviewer cannot open", () => {
    expect(
      getVisibleNavigationItems("external_reviewer").map((item) => item.href)
    ).toEqual([
      "/dashboard",
      "/people",
      "/documents",
      "/submissions",
      "/settings",
    ])
  })
})
