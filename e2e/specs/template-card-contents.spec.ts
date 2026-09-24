import { randomUUID } from "node:crypto"

import { createBlankTemplateContent } from "@/types/template"

import { expect, test, uniqueName } from "../support/fixtures"

// Long enough to cross the 40,000-character cut-off; the database never
// decodes an image, so a run of one letter stands in for a real one.
const LARGE_IMAGE = `data:image/png;base64,${"A".repeat(40_001)}`
const SMALL_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4c+0MAAUQAn+chWPSAAAAAElFTkSuQmCC"

test("a card's content keeps the template's words and leaves its large images behind", async ({
  admin,
  tenant,
}) => {
  const blank = createBlankTemplateContent()
  const content = {
    ...blank,
    blocks: [
      {
        alignment: "left",
        id: randomUUID(),
        level: 1,
        text: "Right to rent check",
        type: "heading",
      },
      {
        alignment: "center",
        altText: "Site plan",
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
    branding: { ...blank.branding, logoDataUrl: LARGE_IMAGE },
  }
  const { data: template, error } = await admin
    .from("document_templates")
    .insert({
      content,
      org_id: tenant.organizationId,
      status: "draft",
      title: uniqueName("Card content"),
    })
    .select("id")
    .single()
  if (error) throw error

  const { data: cards, error: readError } = await admin.rpc(
    "document_template_card_contents",
    { target_org_id: tenant.organizationId, template_ids: [template.id] }
  )
  if (readError) throw readError

  const [card] = cards
  expect(card.content.blocks[0].text).toBe("Right to rent check")
  // The large image becomes a small placeholder; the small one stays itself.
  expect(card.content.blocks[1].dataUrl).not.toBe(LARGE_IMAGE)
  expect(card.content.blocks[1].dataUrl.length).toBeLessThan(200)
  expect(card.content.blocks[2].dataUrl).toBe(SMALL_IMAGE)
  expect(card.content.branding.logoDataUrl).toBeNull()

  // Asked from another organization, the same template is out of reach.
  const { data: elsewhere, error: elsewhereError } = await admin.rpc(
    "document_template_card_contents",
    { target_org_id: randomUUID(), template_ids: [template.id] }
  )
  if (elsewhereError) throw elsewhereError
  expect(elsewhere).toEqual([])
})
