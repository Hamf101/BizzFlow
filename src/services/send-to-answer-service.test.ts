import { describe, expect, it, vi } from "vitest"

import {
  createBaseTables,
  DOCUMENT_ID,
  FakeClient,
  type FakeRow,
  type FakeTables,
  hashToken,
  MANAGER_ID,
  NOW,
  ORG_ID,
} from "@/services/document-signing-service.test-support"
import { getPublicFormLinkByToken, listPublicFormLinks } from "@/services/public-form-service"
import { listAnswerRequests, resendAnswerRequest, revokeAnswerRequest, sendToAnswer, type SendToAnswerDeps } from "@/services/send-to-answer-service"

const TEMPLATE_ID = "50000000-0000-4000-8000-000000000001"
const OTHER_ORG_ID = "10000000-0000-4000-8000-000000000009"
const TOKENS = ["sent_token_one_abcdefghijklmnopqrstuvwxyz0123", "sent_token_two_abcdefghijklmnopqrstuvwxyz0123", "sent_token_three_abcdefghijklmnopqrstuvwxyz01"]

// The signing fake, plus the template access the template pages ask for.
class SendFake extends FakeClient {
  override async rpc(name: string, args: Record<string, unknown>) {
    if (name === "get_template_access_level") {
      const held = this.tables.template_effective_access?.find((row) => row.template_id === args.target_template_id && row.user_id === args.target_actor_user_id)
      return { data: held?.access_level ?? null, error: null }
    }

    return super.rpc(name, args)
  }
}

function sendable(edit: (tables: FakeTables) => void = () => undefined): { client: SendFake; tables: FakeTables } {
  const tables = createBaseTables()
  Object.assign(tables.documents[0] as FakeRow, { template_id: TEMPLATE_ID, template_revision: 4 })
  ;(tables.document_answers[0] as FakeRow).values = { client_name: "Acme Ltd" }
  tables.public_form_links = []
  tables.profiles = [{ id: MANAGER_ID, email: "manager@example.com", full_name: "Morgan Lee" }]
  tables.document_templates = [{ id: TEMPLATE_ID, org_id: ORG_ID, title: "Intake", status: "published", revision: 4, content: tables.documents[0]?.template_snapshot }]
  tables.published_document_templates = [...tables.document_templates]
  tables.template_effective_access = [{ template_id: TEMPLATE_ID, user_id: MANAGER_ID, access_level: "editor" }]
  edit(tables)
  return { client: new SendFake(tables), tables }
}

function deps(client: FakeClient, overrides: Partial<SendToAnswerDeps> = {}): SendToAnswerDeps {
  const tokens = [...TOKENS]
  let id = 0
  return {
    client: client as never,
    createId: () => `70000000-0000-4000-8000-00000000000${++id}`,
    createToken: () => tokens.shift() ?? "spare_token_abcdefghijklmnopqrstuvwxyz01234",
    now: () => NOW,
    recordAuditLog: vi.fn(async () => undefined),
    sendRequest: vi.fn(async () => undefined),
    ...overrides,
  }
}

const send = (client: FakeClient, emails: string[], overrides: Partial<SendToAnswerDeps> = {}, source: Parameters<typeof sendToAnswer>[0]["source"] = { documentId: DOCUMENT_ID, kind: "document" }) =>
  sendToAnswer({ actorUserId: MANAGER_ID, emails, organizationId: ORG_ID, source }, deps(client, overrides))

describe("sendToAnswer", () => {
  it("gives each person a link of their own to the document as it stood, kept only as a hash", async () => {
    const { client, tables } = sendable()
    const sendRequest = vi.fn(async () => undefined)

    const sent = await send(client, [" Ana@Example.com ", "ben@example.com", "ana@example.com"], { sendRequest })

    // One link each, duplicates folded, and nothing secret handed back when the email went.
    expect(sent).toEqual([
      expect.objectContaining({ delivered: true, email: "ana@example.com", token: null }),
      expect.objectContaining({ delivered: true, email: "ben@example.com", token: null }),
    ])
    expect(tables.public_form_links).toHaveLength(2)
    expect(tables.public_form_links?.[0]).toMatchObject({ max_submissions: 1, recipient_email: "ana@example.com", token: null, token_hash: hashToken(TOKENS[0]!) })
    expect(sendRequest).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: "ana@example.com", senderName: "Morgan Lee", title: "Professional services agreement", token: TOKENS[0] }))

    // Edits after sending change nothing the person sees.
    ;(tables.documents[0] as FakeRow).title = "Renamed afterwards"
    ;(tables.document_answers[0] as FakeRow).values = { client_name: "Someone else" }
    const opened = await getPublicFormLinkByToken(TOKENS[0]!, { client: client as never, now: () => NOW })

    expect(opened).toMatchObject({ answers: { client_name: "Acme Ltd" }, template: { revision: 4, title: "Professional services agreement" }, valid: true })
    // The stored hash is not a way in.
    expect(await getPublicFormLinkByToken(hashToken(TOKENS[0]!), { client: client as never, now: () => NOW })).toMatchObject({ valid: false })
  })

  it("refuses a viewer, a role that cannot send, another workspace's document, and a guest", async () => {
    const viewer = sendable((tables) => ((tables.document_effective_access[0] as FakeRow).access_level = "viewer"))
    const reviewer = sendable((tables) => ((tables.organization_memberships[0] as FakeRow).role = "external_reviewer"))
    const elsewhere = sendable((tables) => ((tables.documents[0] as FakeRow).org_id = OTHER_ORG_ID))
    const guest = sendable((tables) => (tables.organization_memberships = []))

    await expect(send(viewer.client, ["ana@example.com"])).rejects.toMatchObject({ statusCode: 403 })
    await expect(send(reviewer.client, ["ana@example.com"])).rejects.toMatchObject({ statusCode: 403 })
    await expect(send(elsewhere.client, ["ana@example.com"])).rejects.toMatchObject({ statusCode: 404 })
    await expect(send(guest.client, ["ana@example.com"])).rejects.toMatchObject({ statusCode: 404 })
    for (const { tables } of [viewer, reviewer, elsewhere, guest]) expect(tables.public_form_links).toHaveLength(0)
  })

  it("refuses more than ten people, an address that is not one, and a document with no template", async () => {
    const { client, tables } = sendable()
    const eleven = Array.from({ length: 11 }, (_, at) => `person${at}@example.com`)
    const untemplated = sendable((rows) => ((rows.documents[0] as FakeRow).template_id = null))

    await expect(send(client, eleven)).rejects.toMatchObject({ statusCode: 400 })
    await expect(send(client, ["not an address"])).rejects.toMatchObject({ statusCode: 400 })
    await expect(send(client, [])).rejects.toMatchObject({ statusCode: 400 })
    await expect(send(untemplated.client, ["ana@example.com"])).rejects.toMatchObject({ statusCode: 409 })
    expect(tables.public_form_links).toHaveLength(0)
  })

  it("keeps a link whose email could not go, and hands it back that once", async () => {
    const { client, tables } = sendable()

    const [sent] = await send(client, ["ana@example.com"], { sendRequest: vi.fn(async () => Promise.reject(new Error("provider down"))) })

    expect(sent).toMatchObject({ delivered: false, token: TOKENS[0] })
    expect(tables.public_form_links).toHaveLength(1)
    expect(await getPublicFormLinkByToken(TOKENS[0]!, { client: client as never, now: () => NOW })).toMatchObject({ valid: true })
  })

  it("sends a template only as published, by someone who may edit it", async () => {
    const template = { kind: "template" as const, templateId: TEMPLATE_ID }
    const { client, tables } = sendable()
    const reader = sendable((rows) => ((rows.template_effective_access?.[0] as FakeRow).access_level = "viewer"))
    const draft = sendable((rows) => (rows.published_document_templates = []))

    await send(client, ["ana@example.com"], {}, template)
    await expect(send(reader.client, ["ana@example.com"], {}, template)).rejects.toMatchObject({ statusCode: 403 })
    await expect(send(draft.client, ["ana@example.com"], {}, template)).rejects.toMatchObject({ statusCode: 409 })
    expect(tables.public_form_links?.[0]).toMatchObject({ answers_snapshot: null, document_id: null, template_id: TEMPLATE_ID, title_snapshot: "Intake" })
    // The template's public links list only the ones for anyone; a person's own link has no address to show.
    tables.public_form_links?.push({ id: "anyone", org_id: ORG_ID, template_id: TEMPLATE_ID, token_hash: "a".repeat(64), recipient_email: null, status: "active" })
    expect((await listPublicFormLinks({ actorUserId: MANAGER_ID, organizationId: ORG_ID, templateId: TEMPLATE_ID }, { client: client as never, linkToken: (id) => id })).map((link) => link.id)).toEqual(["anyone"])
  })

  it("closes a document's links while it is in the trash, and opens them again when it comes back", async () => {
    const { client, tables } = sendable()
    await send(client, ["ana@example.com"])
    const open = () => getPublicFormLinkByToken(TOKENS[0]!, { client: client as never, now: () => NOW })

    ;(tables.documents[0] as FakeRow).lifecycle_state = "trashed"
    expect(await open()).toMatchObject({ valid: false })
    ;(tables.documents[0] as FakeRow).lifecycle_state = "active"
    expect(await open()).toMatchObject({ valid: true })
  })
})

describe("send to answer, when something is wrong", () => {
  it("sends nothing for a document that is not active, first or again", async () => {
    const archived = sendable((tables) => ((tables.documents[0] as FakeRow).lifecycle_state = "archived"))
    await expect(send(archived.client, ["ana@example.com"])).rejects.toMatchObject({ statusCode: 409 })
    expect(archived.tables.public_form_links).toHaveLength(0)

    const { client, tables } = sendable()
    await send(client, ["ana@example.com"])
    ;(tables.documents[0] as FakeRow).lifecycle_state = "trashed"
    const sendRequest = vi.fn(async () => undefined)
    const link = tables.public_form_links?.[0] as FakeRow

    await expect(
      resendAnswerRequest({ actorUserId: MANAGER_ID, linkId: link.id as string, organizationId: ORG_ID }, deps(client, { sendRequest }))
    ).rejects.toMatchObject({ statusCode: 409 })

    // Purged, the document is gone and the link forgets it, but still holds what it was sent as.
    tables.documents.length = 0
    link.document_id = null

    await expect(
      resendAnswerRequest({ actorUserId: MANAGER_ID, linkId: link.id as string, organizationId: ORG_ID }, deps(client, { sendRequest }))
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it("stores every link before any email goes, and records which links it sent", async () => {
    const { client, tables } = sendable()
    const stored: number[] = []
    const recordAuditLog = vi.fn(async () => undefined)

    await send(client, ["ana@example.com", "ben@example.com"], {
      recordAuditLog,
      sendRequest: vi.fn(async () => void stored.push(tables.public_form_links?.length ?? 0)),
    })

    expect(stored).toEqual([2, 2])
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ linkIds: (tables.public_form_links ?? []).map((link) => link.id).join(",") }) })
    )
  })

  it("reports a database failure as a failure, not as a missing request or an unknown sender", async () => {
    const { client, tables } = sendable()
    await send(client, ["ana@example.com"])
    const link = tables.public_form_links?.[0] as FakeRow
    const broken = { data: null, error: { code: "XX000", message: "database down" } }
    const failing: unknown = new Proxy(
      {},
      { get: (_target, key) => (key === "then" ? (done: (value: unknown) => unknown) => Promise.resolve(broken).then(done) : key === "maybeSingle" ? async () => broken : () => failing) }
    )
    const failOn = (table: string) => Object.assign(Object.create(client) as SendFake, { from: (name: string) => (name === table ? failing : client.from(name)) })
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      resendAnswerRequest({ actorUserId: MANAGER_ID, linkId: link.id as string, organizationId: ORG_ID }, deps(failOn("public_form_links")))
    ).rejects.toMatchObject({ statusCode: 500 })
    await expect(send(failOn("profiles"), ["ben@example.com"])).rejects.toMatchObject({ statusCode: 500 })
  })
})

describe("resendAnswerRequest", () => {
  it("sends a new link and retires the old one, but not once it is answered", async () => {
    const { client, tables } = sendable()
    await send(client, ["ana@example.com"])
    const link = tables.public_form_links?.[0] as FakeRow
    const sendRequest = vi.fn(async () => undefined)
    const resend = () => resendAnswerRequest({ actorUserId: MANAGER_ID, linkId: link.id as string, organizationId: ORG_ID }, deps(client, { createToken: () => TOKENS[2]!, sendRequest }))

    await expect(resend()).resolves.toMatchObject({ delivered: true, token: null })
    expect(await getPublicFormLinkByToken(TOKENS[0]!, { client: client as never, now: () => NOW })).toMatchObject({ valid: false })
    expect(await getPublicFormLinkByToken(TOKENS[2]!, { client: client as never, now: () => NOW })).toMatchObject({ valid: true })

    link.submission_count = 1
    await expect(resend()).rejects.toMatchObject({ statusCode: 409 })
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })
})

describe("listAnswerRequests and revokeAnswerRequest", () => {
  const LATER = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000)
  const who = { actorUserId: MANAGER_ID, organizationId: ORG_ID }
  const source = { documentId: DOCUMENT_ID, kind: "document" as const }

  it("lists what one document was sent as, each with where it stands, to someone who may send it", async () => {
    const { client, tables } = sendable()
    await send(client, ["ana@example.com", "ben@example.com", "cara@example.com"])
    await send(client, ["dan@example.com"], {}, { kind: "template", templateId: TEMPLATE_ID })
    const [ana, ben, cara] = tables.public_form_links as FakeRow[]
    ben!.submission_count = 1
    cara!.status = "disabled"
    const list = (now: Date) => listAnswerRequests({ ...who, source }, { client: client as never, now: () => now })

    // The template's own send is listed with the template, not here.
    expect(await list(NOW)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: "ana@example.com", id: ana!.id, state: "sent" }),
        expect.objectContaining({ email: "ben@example.com", state: "answered" }),
        expect.objectContaining({ email: "cara@example.com", state: "revoked" }),
      ])
    )
    expect(await list(NOW)).toHaveLength(3)
    expect((await list(LATER)).map((request) => request.state).sort()).toEqual(["answered", "expired", "revoked"])
    expect(await listAnswerRequests({ ...who, source: { kind: "template", templateId: TEMPLATE_ID } }, { client: client as never, now: () => NOW })).toEqual([
      expect.objectContaining({ email: "dan@example.com", state: "sent" }),
    ])

    ;(tables.document_effective_access[0] as FakeRow).access_level = "viewer"
    await expect(list(NOW)).rejects.toMatchObject({ statusCode: 403 })
  })

  it("revokes a request so its link stops working, but not one already answered or another workspace's", async () => {
    const { client, tables } = sendable()
    await send(client, ["ana@example.com", "ben@example.com"])
    const [ana, ben] = tables.public_form_links as FakeRow[]
    const revoke = (linkId: string, organizationId = ORG_ID) =>
      revokeAnswerRequest({ actorUserId: MANAGER_ID, linkId, organizationId }, deps(client))

    await revoke(ana!.id as string)
    expect(await getPublicFormLinkByToken(TOKENS[0]!, { client: client as never, now: () => NOW })).toMatchObject({ valid: false })

    ben!.submission_count = 1
    await expect(revoke(ben!.id as string)).rejects.toMatchObject({ statusCode: 409 })
    await expect(revoke(ana!.id as string, OTHER_ORG_ID)).rejects.toMatchObject({ statusCode: 404 })
    expect(ben!.status).toBe("active")
  })
})
