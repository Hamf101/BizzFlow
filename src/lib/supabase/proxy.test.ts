import { describe, expect, it } from "vitest"

import { isProtectedPath } from "./proxy"

describe("Supabase proxy route protection", () => {
  it("treats dashboard and people routes as protected", () => {
    expect(isProtectedPath("/dashboard")).toBe(true)
    expect(isProtectedPath("/dashboard/settings")).toBe(true)
    expect(isProtectedPath("/people")).toBe(true)
    expect(isProtectedPath("/people/team")).toBe(true)
    expect(isProtectedPath("/audit-log")).toBe(true)
    expect(isProtectedPath("/documents")).toBe(true)
    expect(isProtectedPath("/documents/document-1")).toBe(true)
    expect(isProtectedPath("/templates")).toBe(true)
    expect(isProtectedPath("/templates/template-1")).toBe(true)
    expect(isProtectedPath("/dashboard-preview")).toBe(false)
    expect(isProtectedPath("/documents-public")).toBe(false)
    expect(isProtectedPath("/login")).toBe(false)
  })
})
