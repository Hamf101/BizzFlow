import { describe, expect, it } from "vitest"

import {
  getMobileNavigationLayout,
  getVisibleNavigationItems,
} from "./navigation-items"

const FULL_MEMBER_DESTINATIONS = [
  "/dashboard",
  "/people",
  "/documents",
  "/templates",
  "/submissions",
  "/tasks",
  "/audit-log",
  "/settings",
] as const

const STAFF_DESTINATIONS = FULL_MEMBER_DESTINATIONS.filter(
  (href) => href !== "/audit-log"
)

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

  it.each([
    ["owner_admin", FULL_MEMBER_DESTINATIONS],
    ["manager", FULL_MEMBER_DESTINATIONS],
    ["staff", STAFF_DESTINATIONS],
  ] as const)("keeps every authorized core destination reachable for %s", (role, expected) => {
    expect(getVisibleNavigationItems(role).map((item) => item.href)).toEqual(
      expected
    )
  })

  it.each([
    "owner_admin",
    "manager",
    "staff",
    "external_reviewer",
  ] as const)(
    "partitions every authorized %s destination once across mobile navigation",
    (role) => {
      const visible = getVisibleNavigationItems(role).map((item) => item.href)
      const { overflow, primary } = getMobileNavigationLayout(role)
      const mobile = [...primary, ...overflow].map((item) => item.href)

      expect(new Set(mobile)).toEqual(new Set(visible))
      expect(new Set(mobile).size).toBe(mobile.length)
      expect(primary).toHaveLength(Math.min(4, visible.length))
    }
  )
})
