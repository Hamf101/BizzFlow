import { beforeEach, expect, it, vi } from "vitest"

import { getAuthenticatedUser } from "@/lib/auth"
import { createSheet, renameSheet, updateSheetContent } from "@/services/sheet-service"

import { createSheetAction, saveSheetAction } from "./sheet-actions"

const ORG_ID = "10000000-0000-4000-8000-000000000001"
const FOLDER_ID = "40000000-0000-4000-8000-000000000001"

vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), getAuthenticatedUser: vi.fn() }))
vi.mock("@/services/organization-service", () => ({
  getCurrentOrganizationContext: vi.fn(async () => ({ membership: { role: "staff" }, organization: { id: ORG_ID } })),
}))
vi.mock("@/services/document-service", () => ({ findGuestOrganizationId: vi.fn(async () => null) }))
vi.mock("@/services/sheet-service", () => ({
  createSheet: vi.fn(async () => ({ id: "sheet-1" })),
  renameSheet: vi.fn(async () => ({ updatedAt: "v2" })),
  updateSheetContent: vi.fn(async () => ({ updatedAt: "v3" })),
}))

beforeEach(() => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: "user-1", email: "member@example.com" })
})

it("starts an empty sheet in the open folder and opens it", async () => {
  await expect(createSheetAction(FOLDER_ID)).rejects.toThrow("NEXT_REDIRECT:/documents/sheet-1/edit?feedback=sheet_created")

  expect(createSheet).toHaveBeenCalledWith({ actorUserId: "user-1", folderId: FOLDER_ID, organizationId: ORG_ID, title: "Untitled sheet" })
})

it("saves a new name first, then the cells over the version the rename left", async () => {
  const result = await saveSheetAction({ content: { version: 1 }, documentId: "sheet-1", expectedUpdatedAt: "v1", title: "Q3" })

  expect(result).toEqual({ ok: true, version: "v3" })
  expect(renameSheet).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: "v1", title: "Q3" }))
  expect(updateSheetContent).toHaveBeenCalledWith(expect.objectContaining({ content: { version: 1 }, expectedUpdatedAt: "v2", organizationId: ORG_ID }))
})
