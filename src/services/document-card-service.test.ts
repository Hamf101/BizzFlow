import { afterEach, describe, expect, it, vi } from "vitest"

import { listDocumentCards } from "@/services/document-service"
import {
  createDeps,
  createDocumentRow,
  createMembershipRow,
  FakeSupabaseClient,
} from "@/services/document-service.test-support"
import { createBlankTemplateContent } from "@/types/template"

const leasePage = {
  ...createBlankTemplateContent(),
  blocks: [
    {
      alignment: "left",
      id: "50000000-0000-4000-8000-000000000001",
      level: 1,
      text: "Lease terms",
      type: "heading",
    },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
})

function createClient(): FakeSupabaseClient {
  return new FakeSupabaseClient({
    organization_memberships: [createMembershipRow("manager")],
    documents: [
      // Shared with the member directly.
      createDocumentRow({
        created_by: "user-2",
        id: "document-1",
        source_kind: "generated",
        template_snapshot: leasePage,
      }),
      // Someone else's, and never shared.
      createDocumentRow({
        created_by: "user-2",
        id: "document-2",
        source_kind: "generated",
        template_snapshot: leasePage,
      }),
      // The member's own upload.
      createDocumentRow({ created_by: "user-1", id: "document-3" }),
    ],
    document_access_grants: [
      {
        access_level: "viewer",
        document_id: "document-1",
        id: "grant-1",
        org_id: "org-1",
        organization_role: null,
        user_id: "user-1",
      },
    ],
    document_answers: [
      { document_id: "document-1", org_id: "org-1", workflow_status: "awaiting_signatures" },
      { document_id: "document-2", org_id: "org-1", workflow_status: "completed" },
    ],
  })
}

describe("listDocumentCards", () => {
  it("shows the status and page of reachable documents only, and never asks for another's page", async () => {
    const client = createClient()
    const rpc = vi.spyOn(client, "rpc")

    const cards = await listDocumentCards(
      {
        actorUserId: "user-1",
        contentIds: ["document-1", "document-2"],
        documentIds: ["document-1", "document-2", "document-3"],
        organizationId: "org-1",
      },
      createDeps(client)
    )

    expect(cards).toEqual([
      {
        content: expect.objectContaining({
          blocks: [expect.objectContaining({ text: "Lease terms" })],
        }),
        id: "document-1",
        workflowStatus: "awaiting_signatures",
      },
      { content: null, id: "document-3", workflowStatus: null },
    ])
    expect(
      rpc.mock.calls
        .filter(([functionName]) => functionName === "document_card_contents")
        .map(([, args]) => args.document_ids)
    ).toEqual([["document-1"]])
  })

  it("still shows every status when the pages cannot be read", async () => {
    const client = createClient()
    const answer = client.rpc.bind(client)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.spyOn(client, "rpc").mockImplementation(async (functionName, args) =>
      functionName === "document_card_contents"
        ? { data: null, error: new Error("Card contents are unavailable.") }
        : answer(functionName, args)
    )

    const cards = await listDocumentCards(
      {
        actorUserId: "user-1",
        contentIds: ["document-1"],
        documentIds: ["document-1", "document-3"],
        organizationId: "org-1",
      },
      createDeps(client)
    )

    expect(cards).toEqual([
      { content: null, id: "document-1", workflowStatus: "awaiting_signatures" },
      { content: null, id: "document-3", workflowStatus: null },
    ])
    expect(warn).toHaveBeenCalledWith(
      "document_card_contents_unavailable",
      expect.objectContaining({ organizationId: "org-1" })
    )
  })
})
