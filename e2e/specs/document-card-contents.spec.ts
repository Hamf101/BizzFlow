import { randomUUID } from "node:crypto"

import { expect, test, uniqueName } from "../support/fixtures"
import { retryConcurrentChange } from "../support/retry"
import { seedTemplate } from "../support/seed"

// Long enough to cross the 40,000-character cut-off; the database never
// decodes an image, so a run of one letter stands in for a real one.
const LARGE_IMAGE = `data:image/png;base64,${"A".repeat(40_001)}`
const SMALL_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4c+0MAAUQAn+chWPSAAAAAElFTkSuQmCC"

test("a document's page in Files keeps its words and leaves its large images behind", async ({
  admin,
  tenant,
}) => {
  const owner = tenant.users.owner_admin
  const template = await seedTemplate(
    admin,
    tenant.organizationId,
    uniqueName("Page source"),
    "published"
  )
  const snapshot = {
    ...template.content,
    blocks: [
      {
        alignment: "left",
        id: randomUUID(),
        level: 1,
        text: "Residential lease",
        type: "heading",
      },
      {
        alignment: "center",
        altText: "Floor plan",
        caption: null,
        dataUrl: LARGE_IMAGE,
        id: randomUUID(),
        type: "image",
        widthPercent: 100,
      },
      {
        alignment: "center",
        altText: "Stamp",
        caption: null,
        dataUrl: SMALL_IMAGE,
        id: randomUUID(),
        type: "image",
        widthPercent: 20,
      },
    ],
    branding: {
      ...(template.content.branding as Record<string, unknown>),
      logoDataUrl: LARGE_IMAGE,
    },
  }
  const { data: rows, error } = await retryConcurrentChange(() =>
    admin
      .from("documents")
      .insert([
      {
        created_by: owner.id,
        org_id: tenant.organizationId,
        source_kind: "generated",
        template_id: template.id,
        template_revision: 1,
        template_snapshot: snapshot,
        title: uniqueName("Lease"),
      },
      {
        created_by: owner.id,
        org_id: tenant.organizationId,
        source_kind: "upload",
        title: `${uniqueName("Scan")}.pdf`,
      },
    ])
      .select("id,source_kind")
  )
  if (error) throw error
  const generatedId = rows.find((row) => row.source_kind === "generated")?.id
  const uploadId = rows.find((row) => row.source_kind === "upload")?.id

  const { data: cards, error: readError } = await admin.rpc(
    "document_card_contents",
    { document_ids: [generatedId, uploadId], target_org_id: tenant.organizationId }
  )
  if (readError) throw readError

  // An upload has no page to draw, so only the generated document comes back.
  expect(cards.map((card: { id: string }) => card.id)).toEqual([generatedId])
  const [card] = cards
  expect(card.content.blocks[0].text).toBe("Residential lease")
  // The large image becomes a small placeholder; the small one stays itself.
  expect(card.content.blocks[1].dataUrl.length).toBeLessThan(200)
  expect(card.content.blocks[2].dataUrl).toBe(SMALL_IMAGE)
  expect(card.content.branding.logoDataUrl).toBeNull()

  // Asked from another organization, the same document is out of reach.
  const { data: elsewhere, error: elsewhereError } = await admin.rpc(
    "document_card_contents",
    { document_ids: [generatedId], target_org_id: randomUUID() }
  )
  if (elsewhereError) throw elsewhereError
  expect(elsewhere).toEqual([])
})
