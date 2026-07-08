import { describe, expect, it } from "vitest"

import { isProtectedPath } from "./proxy"

describe("Supabase proxy route protection", () => {
  it("treats dashboard and people routes as protected", () => {
    expect(isProtectedPath("/dashboard")).toBe(true)
    expect(isProtectedPath("/dashboard/settings")).toBe(true)
    expect(isProtectedPath("/people")).toBe(true)
    expect(isProtectedPath("/people/team")).toBe(true)
    expect(isProtectedPath("/audit-log")).toBe(true)
    expect(isProtectedPath("/login")).toBe(false)
  })
})
