import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { crc32, deflateSync } from "node:zlib"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedSigningDocument, seedTemplate } from "../support/seed"

test("stores an uploaded logo beside the document, shows it to a signer, prints it, and gives the original back", async ({
  admin,
  browser,
  pageAs,
  tenant,
}, testInfo) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Logo"))
  const page = await pageAs("owner_admin")
  if (testInfo.project.use.viewport) {
    await page.setViewportSize(testInfo.project.use.viewport)
  }
  await page.goto(`/templates/${template.id}/edit`)
  const brand = page.getByRole("button", { name: "Brand", exact: true })
  await waitForHydration(brand)
  await brand.click()

  const logo = solidPng(600, 200)
  await page.getByLabel("Upload logo").setInputFiles({ buffer: logo, mimeType: "image/png", name: "logo.png" })

  // The document keeps a short reference, never the picture or an expiring address.
  await expect.poll(readContent, { timeout: 15_000 })
    .toMatchObject({ branding: { logoAsset: { height: 200, type: "png", width: 600 }, logoDataUrl: null } })
  const content = await readContent()
  expect(content.branding.logoAsset).not.toHaveProperty("url")

  const { documentId, signingToken } = await seedSigningDocument(
    admin,
    tenant.organizationId,
    { ...template, content },
    uniqueName("Logo document"),
    tenant.users.manager.id,
    { email: "counterparty@e2e.bizflow.test", name: "Avery Morgan" }
  )

  // A signer is no member, yet sees the logo through the address their link earns.
  const signerContext = await browser.newContext()
  const signer = await signerContext.newPage()
  if (testInfo.project.use.viewport) {
    await signer.setViewportSize(testInfo.project.use.viewport)
  }
  await signer.goto(`/sign/${signingToken}`)
  const shown = signer.getByRole("img", { name: /logo$/ }).first()
  await expect.poll(() => shown.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(600)
  await signerContext.close()

  const manager = await pageAs("manager")
  const pdf = await manager.request.get(`/api/documents/${documentId}/pdf`)
  expect(pdf.status()).toBe(200)
  // Image streams stay outside compressed object streams, so the logo's header is readable.
  expect((await pdf.body()).toString("latin1")).toMatch(/\/Subtype \/Image[^>]*\/Width 600/)

  // The author gets back exactly the file they chose, from a picture in a page.
  const withPicture = await seedTemplate(admin, tenant.organizationId, uniqueName("Picture"))
  const { error: blockError } = await admin.from("document_templates").update({
    content: {
      ...withPicture.content,
      blocks: [
        { alignment: "center", altText: "Logo", asset: content.branding.logoAsset, caption: null, id: randomUUID(), type: "image", widthPercent: 60 },
        ...(withPicture.content.blocks as unknown[]),
      ],
    },
    revision: 2,
  }).eq("id", withPicture.id).eq("org_id", tenant.organizationId)
  if (blockError) throw blockError
  await page.goto(`/templates/${withPicture.id}/edit`)
  const picture = page.locator('[data-block-type="image"]')
  await waitForHydration(picture)
  await picture.click({ position: { x: 4, y: 4 } })
  await page.getByRole("toolbar", { name: "Block" }).getByRole("button", { name: "Settings", exact: true }).click()
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download original" }).click(),
  ])
  expect(download.suggestedFilename()).toBe("picture.png")
  expect(readFileSync((await download.path())!).equals(logo)).toBe(true)

  async function readContent() {
    const { data, error } = await admin.from("document_templates")
      .select("content").eq("id", template.id).eq("org_id", tenant.organizationId).single()
    if (error) throw error
    return data.content
  }
})

/** A plum PNG, written by hand so the spec needs no image library or fixture file. */
function solidPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2], 8) // 8 bits per channel, RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [0x63, 0x52, 0x73]).flat())])

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ])
}
