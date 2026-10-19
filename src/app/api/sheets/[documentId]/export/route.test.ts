import { beforeEach, expect, it, vi } from "vitest"

import { getAuthenticatedUser } from "@/lib/auth"
import { resolveDocumentOrganizationId } from "@/lib/document-organization"
import { book } from "@/lib/sheet/sheet.test-support"
import { getSheet, SheetServiceError } from "@/services/sheet-service"

import { GET } from "./route"

const SHEET_ID = "30000000-0000-4000-8000-000000000001"

vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), getAuthenticatedUser: vi.fn() }))
vi.mock("@/lib/document-organization", () => ({ resolveDocumentOrganizationId: vi.fn() }))
vi.mock("@/lib/rate-limit", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/rate-limit")>()), checkRateLimit: vi.fn() }))
vi.mock("@/services/sheet-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/sheet-service")>()),
  getSheet: vi.fn(),
}))

const download = (query = "format=csv") => GET(new Request(`http://localhost/api/sheets/${SHEET_ID}/export?${query}`), { params: Promise.resolve({ documentId: SHEET_ID }) })

beforeEach(() => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: "user-1", email: "member@example.com" })
  vi.mocked(resolveDocumentOrganizationId).mockResolvedValue("org-1")
})

it("downloads the worked-out values, with text that would run as a formula made harmless", async () => {
  vi.mocked(getSheet).mockResolvedValue({
    accessLevel: "viewer",
    content: book({
      A1: "Item",
      B1: "Total",
      A2: { v: "=1+1" },
      B2: { v: 1200, fmt: { type: "money" } },
      A3: "@SUM(evil)",
      B3: -5,
      C3: "=B2+B3",
    }),
    folderId: null,
    id: SHEET_ID,
    lifecycleState: "active",
    title: "Q3 budget",
    updatedAt: "2026-10-14T12:00:00.000Z",
  })

  const response = await download()

  expect(response.status).toBe(200)
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="Q3-budget.csv"')
  expect(await response.text()).toBe(['"Item","Total",""', '"\'=1+1","₦1,200.00",""', '"\'@SUM(evil)","-5","1195"'].join("\n"))
  expect(getSheet).toHaveBeenCalledWith({ actorUserId: "user-1", documentId: SHEET_ID, organizationId: "org-1" })
})

it("refuses whoever may not open the sheet, saying no more than that", async () => {
  vi.mocked(getSheet).mockRejectedValue(new SheetServiceError("Sheet was not found.", 404))

  const response = await download()

  expect([response.status, await response.text()]).toEqual([404, "Sheet was not found."])
  expect((await download("format=xlsx")).status).toBe(400)
})
