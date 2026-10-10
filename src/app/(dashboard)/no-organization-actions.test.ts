import { beforeEach, expect, it, vi } from "vitest"

import { getAuthenticatedUser } from "@/lib/auth"
import { getCurrentOrganizationContext } from "@/services/organization-service"

import { createGeneratedDocumentAction } from "./documents/actions"
import { createTemplateAction } from "./templates/actions"

const redirectMock = vi.hoisted(() =>
  vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  })
)

vi.mock("next/navigation", () => ({ redirect: redirectMock }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getAuthenticatedUser: vi.fn(),
}))
vi.mock("@/services/organization-service", () => ({ getCurrentOrganizationContext: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: "20000000-0000-4000-8000-000000000001" } as never)
  vi.mocked(getCurrentOrganizationContext).mockResolvedValue(null)
})

it("asks a member without an organization to create one, from templates and documents alike", async () => {
  await expect(createTemplateAction(new FormData())).rejects.toThrow(
    "NEXT_REDIRECT:/templates/new?feedback=organization_required"
  )
  await expect(createGeneratedDocumentAction(new FormData())).rejects.toThrow(
    "NEXT_REDIRECT:/documents/new?feedback=organization_required"
  )
})
