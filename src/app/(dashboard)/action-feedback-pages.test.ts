import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const readDashboardPage = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8")

describe("dashboard page feedback boundaries", () => {
  it("does not render legacy raw action errors on the new-document page", () => {
    const source = readDashboardPage("./documents/new/page.tsx")

    expect(source).not.toContain("error?: string")
    expect(source).not.toContain("params.error")
    expect(source).not.toContain("buildRedirect")
    expect(source).toContain(
      'buildFeedbackRedirect("/dashboard", "organization_required")'
    )
  })

  it("uses closed feedback codes for audit-log access redirects", () => {
    const source = readDashboardPage("./audit-log/page.tsx")

    expect(source).not.toContain("buildRedirect")
    expect(source).toContain(
      'buildFeedbackRedirect("/dashboard", "organization_required")'
    )
    expect(source).toContain(
      'buildFeedbackRedirect("/dashboard", "permission_denied")'
    )
  })
})
