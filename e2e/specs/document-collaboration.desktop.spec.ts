import { createHash, randomUUID } from "node:crypto"

import type { Page } from "@playwright/test"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { createBlankTemplateContent } from "@/types/template"

test("two people write one draft document at once, and nothing changes once it goes out for signing", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const owner = tenant.users.owner_admin
  const content = {
    ...createBlankTemplateContent(),
    blocks: [{ alignment: "left", id: randomUUID(), text: "Draft terms.", type: "paragraph" }],
  }
  const { data: document, error } = await admin
    .from("documents")
    .insert({ created_by: owner.id, org_id: tenant.organizationId, source_kind: "generated", template_snapshot: content, title: uniqueName("Joint letter") })
    .select("id")
    .single()
  if (error) throw error
  const { error: answersError } = await admin
    .from("document_answers")
    .insert({ document_id: document.id, org_id: tenant.organizationId, values: {}, workflow_status: "draft" })
  if (answersError) throw answersError
  // The manager works on it too.
  const { error: grantError } = await admin.from("document_access_grants").insert({
    access_level: "contributor",
    document_id: document.id,
    granted_by: owner.id,
    org_id: tenant.organizationId,
    user_id: tenant.users.manager.id,
  })
  if (grantError) throw grantError

  const saved = () =>
    expect.poll(
      async () => {
        const { data, error: readError } = await admin.from("documents").select("template_snapshot").eq("id", document.id).single()
        if (readError) throw readError
        return data.template_snapshot.blocks.map((block: { text?: string }) => block.text)
      },
      { timeout: 15_000 }
    )
  const open = async (page: Page): Promise<void> => {
    const opened = page.waitForResponse((response) => response.url().endsWith(`/api/documents/${document.id}/room`))
    await page.goto(`/documents/${document.id}/edit`)
    await waitForHydration(page.getByRole("textbox", { name: "Title" }))
    expect((await opened).ok()).toBe(true)
  }
  const mine = await pageAs("owner_admin")
  const theirs = await pageAs("manager")
  await Promise.all([open(mine), open(theirs)])

  await mine.getByText("Draft terms.").click()
  await mine.keyboard.press("End")
  await theirs.getByText("Draft terms.").click()
  await theirs.keyboard.press("Home")
  await Promise.all([mine.keyboard.type(" Signed below."), theirs.keyboard.type("Revised: ")])

  const both = "Revised: Draft terms. Signed below."
  await expect(mine.getByText(both)).toBeVisible()
  await expect(theirs.getByText(both)).toBeVisible()
  await saved().toEqual([both])

  // It goes out for signing: from then on every signer must get exactly what was sent.
  const { error: sendError } = await admin.from("document_signing_recipients").insert({
    document_id: document.id,
    email: "signer@e2e.bizflow.test",
    name: "Jordan Signer",
    org_id: tenant.organizationId,
    requires_signature: true,
    status: "pending",
    token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    token_hash: createHash("sha256").update(`e2e-sign-${randomUUID()}`, "utf8").digest("hex"),
  })
  if (sendError) throw sendError

  await mine.getByText(both).click()
  await mine.keyboard.press("End")
  await mine.keyboard.type(" Too late.")
  await expect(mine.getByText("This document was sent for signing, so its content can no longer change.")).toBeVisible()
  await expect(mine.getByText(both, { exact: true })).toBeVisible()
  await saved().toEqual([both])
})
