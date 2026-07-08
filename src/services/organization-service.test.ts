import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getCurrentOrganizationContext,
  OrganizationServiceError,
} from "@/services/organization-service"

const originalEnv = { ...process.env }

describe("organization service setup failures", () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it("reports missing server credentials without logging a console error", async () => {
    process.env = {
      ...originalEnv,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    }

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})

    await expect(getCurrentOrganizationContext("user-id")).rejects.toMatchObject({
      message: "Supabase server credentials are not configured.",
      statusCode: 500,
    } satisfies Partial<OrganizationServiceError>)

    expect(warnSpy).toHaveBeenCalledWith(
      "organization_service_rejected",
      expect.objectContaining({
        operationName: "get_current_organization_context",
        reason: "Supabase server credentials are not configured.",
        statusCode: 500,
      })
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
