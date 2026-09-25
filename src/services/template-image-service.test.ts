import type { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { describe, expect, it, vi } from "vitest"

import {
  createTemplateImageUpload,
  readTemplateImage,
  requireStoredImages,
  withTemplateImageOriginals,
  withTemplateImageUrls,
} from "@/services/template-image-service"
import { createBlankTemplateContent } from "@/types/template"

const ORG_ID = "10000000-0000-4000-8000-000000000001"
const ACTOR_ID = "20000000-0000-4000-8000-000000000001"
const ASSET_ID = "40000000-0000-4000-8000-000000000001"
const R2_ENV = {
  CLOUDFLARE_R2_ACCESS_KEY_ID: "key",
  CLOUDFLARE_R2_ACCOUNT_ID: "account",
  CLOUDFLARE_R2_BUCKET_NAME: "bucket",
  CLOUDFLARE_R2_ENDPOINT: "https://r2.example.com",
  CLOUDFLARE_R2_REGION: "auto",
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: "secret",
  CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS: 900,
} as never

type Signed = { command: PutObjectCommand | GetObjectCommand; options: { expiresIn?: number; signingDate?: Date } }

function membershipClient(role: string | null) {
  const query = {
    eq: () => query,
    maybeSingle: async () => ({ data: role ? { role, role_definition: null } : null, error: null }),
    select: () => query,
  }

  return { from: () => query } as never
}

function harness(role: string | null = "manager", now = new Date("2026-09-24T10:05:00Z")) {
  const signed: Signed[] = []
  const deps = {
    client: membershipClient(role),
    createId: () => ASSET_ID,
    now: () => now,
    r2Client: {} as never,
    r2Env: R2_ENV,
    sign: vi.fn(async (_client: unknown, command: Signed["command"], options: Signed["options"]) => {
      signed.push({ command, options })
      return `https://r2.example.com/${command.input.Key}?at=${options.signingDate?.toISOString()}`
    }),
  }

  return { deps: deps as never, signed }
}

const COPY = { bytes: 50_000, contentType: "image/jpeg" as const }

describe("storing a picture", () => {
  it("gives an author a create-only upload link for each copy, in the workspace's own folder", async () => {
    const { deps, signed } = harness()

    const upload = await createTemplateImageUpload(
      {
        actorUserId: ACTOR_ID,
        copies: { display: { bytes: 90_000, contentType: "image/webp" }, original: { bytes: 4_000_000, contentType: "image/jpeg" }, print: COPY },
        height: 3_000,
        organizationId: ORG_ID,
        type: "jpeg",
        width: 4_000,
      },
      deps
    )

    expect(upload.asset).toMatchObject({ height: 3_000, id: ASSET_ID, type: "jpeg", width: 4_000 })
    expect(upload.asset.url).toContain(`organizations/${ORG_ID}/images/${ASSET_ID}/display`)
    const puts = signed.filter((entry) => "IfNoneMatch" in entry.command.input).map((entry) => entry.command.input)
    expect(puts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ContentLength: 4_000_000, ContentType: "image/jpeg", IfNoneMatch: "*", Key: `organizations/${ORG_ID}/images/${ASSET_ID}/original` }),
        expect.objectContaining({ ContentLength: 90_000, ContentType: "image/webp", IfNoneMatch: "*", Key: `organizations/${ORG_ID}/images/${ASSET_ID}/display` }),
        expect.objectContaining({ ContentLength: 50_000, ContentType: "image/jpeg", IfNoneMatch: "*", Key: `organizations/${ORG_ID}/images/${ASSET_ID}/print` }),
      ])
    )
  })

  it.each([["external_reviewer"], [null]])("refuses someone who can't author (%s)", async (role) => {
    const { deps } = harness(role)

    await expect(
      createTemplateImageUpload(
        { actorUserId: ACTOR_ID, copies: { display: COPY, original: COPY, print: COPY }, height: 300, organizationId: ORG_ID, type: "jpeg", width: 400 },
        deps
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("refuses copies a PDF can't print or that are too large", async () => {
    const { deps } = harness()
    const base = { actorUserId: ACTOR_ID, height: 300, organizationId: ORG_ID, type: "jpeg" as const, width: 400 }

    await expect(
      createTemplateImageUpload({ ...base, copies: { display: COPY, original: COPY, print: { bytes: 900, contentType: "image/webp" } } }, deps)
    ).rejects.toMatchObject({ statusCode: 400 })
    await expect(
      createTemplateImageUpload({ ...base, copies: { display: COPY, original: { bytes: 25_000_000, contentType: "image/jpeg" }, print: COPY } }, deps)
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe("showing and printing a picture", () => {
  const content = {
    ...createBlankTemplateContent(),
    blocks: [
      { alignment: "center" as const, altText: "Building", asset: { height: 900, id: ASSET_ID, type: "jpeg" as const, width: 1_200 }, caption: null, id: "40000000-0000-4000-8000-0000000000b1", type: "image" as const, widthPercent: 100 },
    ],
  }

  it("gives each viewer the same display address all hour, so browsers keep their copy", async () => {
    const at = async (time: string) =>
      (await withTemplateImageUrls(content, ORG_ID, harness("manager", new Date(time)).deps)).blocks[0]

    const early = await at("2026-09-24T10:05:00Z")
    expect(early).toMatchObject({ asset: { url: expect.stringContaining(`organizations/${ORG_ID}/images/${ASSET_ID}/display`) } })
    expect(await at("2026-09-24T10:55:00Z")).toEqual(early)
    expect(await at("2026-09-24T11:01:00Z")).not.toEqual(early)
  })

  it("offers each original as a download only where asked for, never on the pages everyone sees", async () => {
    const { deps, signed } = harness()

    expect((await withTemplateImageUrls(content, ORG_ID, deps)).blocks[0]).not.toHaveProperty("asset.originalUrl")
    expect((await withTemplateImageOriginals(content, ORG_ID, deps)).blocks[0]).toMatchObject({
      asset: {
        originalUrl: expect.stringContaining(`organizations/${ORG_ID}/images/${ASSET_ID}/original`),
        url: expect.stringContaining(`organizations/${ORG_ID}/images/${ASSET_ID}/display`),
      },
    })
    expect(signed.map(({ command }) => command.input)).toContainEqual(
      expect.objectContaining({ ResponseContentDisposition: 'attachment; filename="picture.jpg"' })
    )
  })

  it("saves a new picture only once its shown copies are stored, and doesn't recheck the ones already saved", async () => {
    const heads: string[] = []
    // What the store holds for each copy: the print copy never arrived.
    const store = (key: string) => (key.endsWith("/print") ? null : { ContentLength: 40_000, ContentType: "image/jpeg" })
    const send = vi.fn(async (command: GetObjectCommand) => {
      const key = String(command.input.Key)
      heads.push(key)
      const stored = store(key)
      if (!stored) throw Object.assign(new Error("Not Found"), { name: "NotFound" })
      return stored
    })
    const deps = { r2Client: { send } as never, r2Env: R2_ENV }

    await expect(requireStoredImages(content, null, ORG_ID, deps)).rejects.toMatchObject({ statusCode: 400 })
    heads.length = 0
    await expect(requireStoredImages(content, content, ORG_ID, deps)).resolves.toBeUndefined()
    expect(heads).toEqual([])
    const whole = { r2Client: { send: vi.fn(async () => ({ ContentLength: 40_000, ContentType: "image/jpeg" })) } as never, r2Env: R2_ENV }
    await expect(requireStoredImages(content, null, ORG_ID, whole)).resolves.toBeUndefined()
  })

  it("prints every picture from its print copy", async () => {
    const keys: string[] = []
    const send = vi.fn(async (command: GetObjectCommand) => {
      keys.push(String(command.input.Key))
      return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } }
    })
    const deps = { r2Client: { send } as never, r2Env: R2_ENV }

    expect(await readTemplateImage(ORG_ID, { height: 300, id: ASSET_ID, type: "jpeg", width: 400 }, deps)).toEqual(new Uint8Array([1, 2, 3]))
    expect(keys).toEqual([`organizations/${ORG_ID}/images/${ASSET_ID}/print`])
  })
})
