import { beforeEach, describe, expect, it, vi } from "vitest"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"

import { loadActionContextOrSignIn, runFormAction } from "./form-action"

const redirectMock = vi.hoisted(() =>
  vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  })
)

vi.mock("next/navigation", () => ({ redirect: redirectMock }))
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getAuthenticatedUser: vi.fn(),
}))
vi.mock("@/services/organization-service", () => ({ getCurrentOrganizationContext: vi.fn() }))

const PATH = "/templates/30000000-0000-4000-8000-000000000001/edit"
const run = (work: () => Promise<void>): Promise<never> =>
  runFormAction({ event: "test_action", path: PATH, run: work, success: "changes_saved" })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "info").mockImplementation(() => undefined)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

describe("runFormAction", () => {
  it("returns a failure to its page as a fixed outcome, never the service's own words", async () => {
    const failure = Object.assign(new Error("EmailJS request 81f2 for tenant acme failed"), { statusCode: 409 })

    await expect(run(async () => Promise.reject(failure))).rejects.toThrow(`NEXT_REDIRECT:${PATH}?feedback=refresh_required`)
    expect(JSON.stringify(redirectMock.mock.calls)).not.toMatch(/EmailJS|acme|81f2/)
  })

  it("lands a quiet success on its page with no notice, while its failure still reports one", async () => {
    const quiet = (work: () => Promise<void | { path: string }>): Promise<never> =>
      runFormAction({ event: "test_action", path: PATH, run: work })

    await expect(quiet(async () => ({ path: "/documents/d1/edit" }))).rejects.toThrow(/^NEXT_REDIRECT:\/documents\/d1\/edit$/)
    await expect(quiet(async () => Promise.reject(new Error("boom")))).rejects.toThrow(`NEXT_REDIRECT:${PATH}?feedback=`)
  })

  it("still reports an outcome the work names itself when the action has no default notice", async () => {
    await expect(
      runFormAction({ event: "test_action", path: PATH, run: async () => ({ path: "/documents?folderId=f1", code: "folder_created" }) })
    ).rejects.toThrow("NEXT_REDIRECT:/documents?folderId=f1&feedback=folder_created")
  })

  it("sends a member whose session ended to sign in, and back to the same page", async () => {
    await expect(run(async () => Promise.reject(new AuthenticationError("Sign in to continue.")))).rejects.toThrow(
      `NEXT_REDIRECT:/login?next=${encodeURIComponent(PATH)}`
    )
  })
})

describe("loadActionContextOrSignIn", () => {
  it("sends a signed-out visitor to sign in before anything loads", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(new AuthenticationError("Sign in to continue."))

    await expect(loadActionContextOrSignIn("/documents", "Create a workspace first.")).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fdocuments"
    )
  })
})
