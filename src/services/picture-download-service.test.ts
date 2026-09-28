import type { GetObjectCommand } from "@aws-sdk/client-s3"
import { describe, expect, it, vi } from "vitest"

import { createPictureOriginalDownload } from "@/services/picture-download-service"
import { TemplateServiceError } from "@/services/template-service"
import { createBlankTemplateContent } from "@/types/template"

const ORG_ID = "10000000-0000-4000-8000-000000000001"
const ACTOR_ID = "20000000-0000-4000-8000-000000000001"
const TEMPLATE_ID = "30000000-0000-4000-8000-000000000001"
const ASSET_ID = "40000000-0000-4000-8000-000000000001"
const R2_ENV = {
  CLOUDFLARE_R2_ACCESS_KEY_ID: "key",
  CLOUDFLARE_R2_ACCOUNT_ID: "account",
  CLOUDFLARE_R2_BUCKET_NAME: "bucket",
  CLOUDFLARE_R2_ENDPOINT: "https://r2.example.com",
  CLOUDFLARE_R2_REGION: "auto",
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: "secret",
  CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS: 300,
} as never

const content = {
  ...createBlankTemplateContent(),
  blocks: [
    { alignment: "center" as const, altText: "Site", asset: { height: 900, id: ASSET_ID, type: "png" as const, width: 1_200 }, caption: null, id: "40000000-0000-4000-8000-0000000000b1", type: "image" as const, widthPercent: 100 },
  ],
}

function deps(loadTemplate: () => Promise<unknown>) {
  const signed: { command: GetObjectCommand; expiresIn?: number }[] = []

  return {
    deps: {
      loadTemplate: vi.fn(loadTemplate),
      r2Client: {},
      r2Env: R2_ENV,
      sign: vi.fn(async (_client: unknown, command: GetObjectCommand, options: { expiresIn?: number }) => {
        signed.push({ command, expiresIn: options.expiresIn })
        return `https://r2.example.com/${command.input.Key}`
      }),
    } as never,
    signed,
  }
}

const request = { actorUserId: ACTOR_ID, assetId: ASSET_ID, organizationId: ORG_ID, source: { templateId: TEMPLATE_ID } }

describe("downloading a picture's original", () => {
  it("gives someone who can still open the template a short-lived download of it", async () => {
    const { deps: withAccess, signed } = deps(async () => ({ content }))

    await expect(createPictureOriginalDownload(request, withAccess)).resolves.toContain(`organizations/${ORG_ID}/images/${ASSET_ID}/original`)
    expect(signed[0]).toMatchObject({ command: { input: { ResponseContentDisposition: 'attachment; filename="picture.png"' } }, expiresIn: 300 })
  })

  it("refuses once they can no longer open it, and for a picture that isn't in it", async () => {
    const revoked = deps(async () => {
      throw new TemplateServiceError("You cannot view document templates.", 403)
    })
    const elsewhere = deps(async () => ({ content: createBlankTemplateContent() }))

    await expect(createPictureOriginalDownload(request, revoked.deps)).rejects.toMatchObject({ statusCode: 403 })
    await expect(createPictureOriginalDownload(request, elsewhere.deps)).rejects.toMatchObject({ statusCode: 404 })
    expect([...revoked.signed, ...elsewhere.signed]).toEqual([])
  })
})
