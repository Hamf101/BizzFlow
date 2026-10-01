import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import {
  DocumentServiceError,
  getSharingMany,
  setSharingAccessMany,
  setSharingInheritanceMany,
  type SharingView,
} from "@/services/document-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"

import { loadSharingAction, setSharingAccessAction, setSharingInheritanceAction } from "./sharing-actions"

const ACTOR = "20000000-0000-4000-8000-000000000001"
const ORG = "10000000-0000-4000-8000-000000000001"
const DOC = "40000000-0000-4000-8000-000000000001"
const PERSON = "20000000-0000-4000-8000-000000000002"

const { redirectMock, revalidatePathMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
  revalidatePathMock: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }))
vi.mock("next/navigation", () => ({ redirect: redirectMock }))
vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), getAuthenticatedUser: vi.fn() }))
vi.mock("@/services/organization-service", () => ({ getCurrentOrganizationContext: vi.fn() }))
vi.mock("@/services/document-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/document-service")>()),
  getSharingMany: vi.fn(),
  setSharingAccessMany: vi.fn(),
  setSharingInheritanceMany: vi.fn(),
}))

const VIEW = { grants: [], inherit: true, inherited: [], members: [], name: "Lease", owner: null, parent: null } as SharingView
const RESOURCE = { id: DOC, kind: "document" as const }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthenticatedUser).mockResolvedValue({ email: "a@example.test", id: ACTOR })
  vi.mocked(getCurrentOrganizationContext).mockResolvedValue({ organization: { id: ORG } } as never)
  vi.mocked(getSharingMany).mockResolvedValue(VIEW)
  vi.mocked(setSharingAccessMany).mockResolvedValue(VIEW)
  vi.mocked(setSharingInheritanceMany).mockResolvedValue(VIEW)
})

afterEach(() => vi.restoreAllMocks())

describe("the Share dialog's actions", () => {
  it("open the sharing as the signed-in member in their workspace", async () => {
    await expect(loadSharingAction([RESOURCE])).resolves.toEqual({ ok: true, view: VIEW })

    expect(getSharingMany).toHaveBeenCalledWith({ actorUserId: ACTOR, organizationId: ORG, resources: [RESOURCE] })
  })

  it("change access and refresh Files", async () => {
    await expect(setSharingAccessAction({ level: "viewer", principal: { userId: PERSON }, resources: [RESOURCE] })).resolves.toEqual({ ok: true, view: VIEW })

    expect(setSharingAccessMany).toHaveBeenCalledWith({ actorUserId: ACTOR, level: "viewer", organizationId: ORG, principal: { userId: PERSON }, resources: [RESOURCE] })
    expect(revalidatePathMock).toHaveBeenCalledWith("/documents")
    expect(revalidatePathMock).toHaveBeenCalledWith("/templates")
  })

  it("share a template at one of its three levels", async () => {
    const template = { id: "40000000-0000-4000-8000-000000000008", kind: "template" as const }

    await expect(setSharingAccessAction({ level: "user", principal: { userId: PERSON }, resources: [template] })).resolves.toEqual({ ok: true, view: VIEW })
    expect(setSharingAccessMany).toHaveBeenCalledWith(expect.objectContaining({ level: "user", resources: [template] }))
  })

  it("change whether it takes in the folder's sharing", async () => {
    await setSharingInheritanceAction({ inherit: false, resources: [RESOURCE] })

    expect(setSharingInheritanceMany).toHaveBeenCalledWith({ actorUserId: ACTOR, inherit: false, organizationId: ORG, resources: [RESOURCE] })
  })

  it("say why in plain words when the service refuses", async () => {
    vi.mocked(setSharingAccessMany).mockRejectedValue(new DocumentServiceError("External reviewers can only view.", 400))

    await expect(setSharingAccessAction({ level: "contributor", principal: { userId: PERSON }, resources: [RESOURCE] })).resolves.toEqual({
      message: "External reviewers can only view.",
      ok: false,
    })
  })

  it("never pass on a failure they do not understand", async () => {
    vi.mocked(setSharingAccessMany).mockRejectedValue(new Error("connection reset by 10.0.0.4"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(setSharingAccessAction({ level: "viewer", principal: { userId: PERSON }, resources: [RESOURCE] })).resolves.toEqual({
      message: "Sharing could not be changed. Try again.",
      ok: false,
    })
  })

  it("turn away anything that is not an id, a level or a role, before the service hears of it", async () => {
    await expect(setSharingAccessAction({ level: "viewer", principal: { userId: "../x" }, resources: [RESOURCE] })).resolves.toMatchObject({ ok: false })
    await expect(setSharingAccessAction({ level: "owner" as never, principal: { userId: PERSON }, resources: [RESOURCE] })).resolves.toMatchObject({ ok: false })
    await expect(setSharingAccessAction({ level: "viewer", principal: { role: "owner_admin" as never }, resources: [RESOURCE] })).resolves.toMatchObject({ ok: false })
    await expect(loadSharingAction([{ id: "nope", kind: "document" }])).resolves.toMatchObject({ ok: false })

    expect(setSharingAccessMany).not.toHaveBeenCalled()
    expect(getSharingMany).not.toHaveBeenCalled()
  })

  it("cover several items at once, but not none and not a crowd", async () => {
    const other = { id: "40000000-0000-4000-8000-000000000009", kind: "folder" as const }

    await loadSharingAction([RESOURCE, other])
    expect(getSharingMany).toHaveBeenCalledWith({ actorUserId: ACTOR, organizationId: ORG, resources: [RESOURCE, other] })

    await expect(loadSharingAction([])).resolves.toMatchObject({ ok: false })
    const crowd = Array.from({ length: 51 }, (_, index) => ({ id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`, kind: "document" as const }))
    await expect(loadSharingAction(crowd)).resolves.toMatchObject({ ok: false })
  })

  it("send a signed-out visitor to sign in", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(new AuthenticationError("Sign in to continue."))

    await expect(loadSharingAction([RESOURCE])).rejects.toThrow("NEXT_REDIRECT:/login?next=%2Fdocuments")
    expect(getSharingMany).not.toHaveBeenCalled()
  })
})
