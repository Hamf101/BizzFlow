import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import {
  DocumentServiceError,
  getSharing,
  setSharingAccess,
  setSharingInheritance,
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
  getSharing: vi.fn(),
  setSharingAccess: vi.fn(),
  setSharingInheritance: vi.fn(),
}))

const VIEW = { grants: [], inherit: true, inherited: [], members: [], name: "Lease", owner: null, parent: null } as SharingView
const RESOURCE = { id: DOC, kind: "document" as const }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthenticatedUser).mockResolvedValue({ email: "a@example.test", id: ACTOR })
  vi.mocked(getCurrentOrganizationContext).mockResolvedValue({ organization: { id: ORG } } as never)
  vi.mocked(getSharing).mockResolvedValue(VIEW)
  vi.mocked(setSharingAccess).mockResolvedValue(VIEW)
  vi.mocked(setSharingInheritance).mockResolvedValue(VIEW)
})

afterEach(() => vi.restoreAllMocks())

describe("the Share dialog's actions", () => {
  it("open the sharing as the signed-in member in their workspace", async () => {
    await expect(loadSharingAction(RESOURCE)).resolves.toEqual({ ok: true, view: VIEW })

    expect(getSharing).toHaveBeenCalledWith({ actorUserId: ACTOR, organizationId: ORG, resource: RESOURCE })
  })

  it("change access and refresh Files", async () => {
    await expect(setSharingAccessAction({ level: "viewer", principal: { userId: PERSON }, resource: RESOURCE })).resolves.toEqual({ ok: true, view: VIEW })

    expect(setSharingAccess).toHaveBeenCalledWith({ actorUserId: ACTOR, level: "viewer", organizationId: ORG, principal: { userId: PERSON }, resource: RESOURCE })
    expect(revalidatePathMock).toHaveBeenCalledWith("/documents")
  })

  it("change whether it takes in the folder's sharing", async () => {
    await setSharingInheritanceAction({ inherit: false, resource: RESOURCE })

    expect(setSharingInheritance).toHaveBeenCalledWith({ actorUserId: ACTOR, inherit: false, organizationId: ORG, resource: RESOURCE })
  })

  it("say why in plain words when the service refuses", async () => {
    vi.mocked(setSharingAccess).mockRejectedValue(new DocumentServiceError("External reviewers can only view.", 400))

    await expect(setSharingAccessAction({ level: "contributor", principal: { userId: PERSON }, resource: RESOURCE })).resolves.toEqual({
      message: "External reviewers can only view.",
      ok: false,
    })
  })

  it("never pass on a failure they do not understand", async () => {
    vi.mocked(setSharingAccess).mockRejectedValue(new Error("connection reset by 10.0.0.4"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(setSharingAccessAction({ level: "viewer", principal: { userId: PERSON }, resource: RESOURCE })).resolves.toEqual({
      message: "Sharing could not be changed. Try again.",
      ok: false,
    })
  })

  it("turn away anything that is not an id, a level or a role, before the service hears of it", async () => {
    await expect(setSharingAccessAction({ level: "viewer", principal: { userId: "../x" }, resource: RESOURCE })).resolves.toMatchObject({ ok: false })
    await expect(setSharingAccessAction({ level: "owner" as never, principal: { userId: PERSON }, resource: RESOURCE })).resolves.toMatchObject({ ok: false })
    await expect(setSharingAccessAction({ level: "viewer", principal: { role: "owner_admin" as never }, resource: RESOURCE })).resolves.toMatchObject({ ok: false })
    await expect(loadSharingAction({ id: "nope", kind: "document" })).resolves.toMatchObject({ ok: false })

    expect(setSharingAccess).not.toHaveBeenCalled()
    expect(getSharing).not.toHaveBeenCalled()
  })

  it("send a signed-out visitor to sign in", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(new AuthenticationError("Sign in to continue."))

    await expect(loadSharingAction(RESOURCE)).rejects.toThrow("NEXT_REDIRECT:/login?next=%2Fdocuments")
    expect(getSharing).not.toHaveBeenCalled()
  })
})
