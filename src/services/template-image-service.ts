import { randomUUID } from "node:crypto"

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { getR2Env, type R2Env } from "@/lib/env"
import {
  canPerformOrganizationAction,
  createOrganizationPermissionSubject,
  type OrganizationPermissionSubject,
} from "@/lib/permissions"
import { createR2Client } from "@/lib/r2/client"
import { type AdminSupabaseClient, createAdminClient } from "@/lib/supabase/admin"
import { loadActiveMembership } from "@/services/organizations/active-membership"
import type { TemplateContent, TemplateImageAsset } from "@/types/template"
import { IMAGE_COPY_MAX_BYTES, type ImageCopy, mapImageAssets } from "@/types/template-images"

// Display addresses are signed from the start of the hour, so every page in
// that hour gets the same one and browsers keep the copy they already have.
const DISPLAY_URL_SECONDS = 12 * 60 * 60
const UPLOAD_URL_SECONDS = 15 * 60
const CONTENT_TYPES: Record<TemplateImageAsset["type"], string> = { jpeg: "image/jpeg", png: "image/png" }
// What each shown copy may be stored as: PDFs embed PNG and JPEG only.
const SHOWN_COPY_TYPES: Record<"display" | "print", readonly string[]> = {
  display: ["image/jpeg", "image/png", "image/webp"],
  print: ["image/jpeg", "image/png"],
}

/** Error raised when a picture cannot be stored or shown. */
export class TemplateImageServiceError extends Error {
  readonly statusCode: number

  /**
   * @param message - User-safe explanation.
   * @param statusCode - HTTP-style status for the caller to translate.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "TemplateImageServiceError"
    this.statusCode = statusCode
  }
}

export type TemplateImageDeps = {
  client?: Pick<AdminSupabaseClient, "from">
  createId?: () => string
  now?: () => Date
  r2Client?: Pick<S3Client, "send">
  r2Env?: R2Env
  sign?: typeof getSignedUrl
}

type CopySpec = { bytes: number; contentType: "image/jpeg" | "image/png" | "image/webp" }

export type CreateTemplateImageUploadInput = {
  actorUserId: string
  organizationId: string
  type: TemplateImageAsset["type"]
  width: number
  height: number
  /**
   * The original as uploaded, the lighter copy pages show, and the copy PDFs
   * print: sized for print and drawn the right way up, which a phone photo's
   * original, turned only by a flag PDFs ignore, is not.
   */
  copies: { display: CopySpec; original: CopySpec; print: CopySpec }
}

export type TemplateImageUpload = {
  asset: TemplateImageAsset
  uploads: { contentType: string; copy: ImageCopy; url: string }[]
}

/**
 * Makes room for a new picture in the workspace's private file store: a fresh
 * id, and a create-only upload link for each copy, so nothing already stored
 * can be replaced. The id comes from here rather than from the picture, so no
 * one can place other bytes under a picture someone else will upload.
 *
 * @param input - Who is uploading, where, and the picture's copies.
 * @param deps - Injected client, id, clock, and storage for tests.
 * @returns The stored picture, with its display address, and where to upload each copy.
 * @throws TemplateImageServiceError 403 for someone who cannot author, 400 for copies that don't fit.
 */
export async function createTemplateImageUpload(
  input: CreateTemplateImageUploadInput,
  deps: TemplateImageDeps = {}
): Promise<TemplateImageUpload> {
  const subject = await requireMember(input.organizationId, input.actorUserId, deps)

  if (!canPerformOrganizationAction(subject, "templates:manage") && !canPerformOrganizationAction(subject, "documents:create")) {
    throw new TemplateImageServiceError("You cannot add pictures.", 403)
  }

  if (
    input.copies.original.contentType !== CONTENT_TYPES[input.type] ||
    // PDFs embed PNG and JPEG only.
    input.copies.print.contentType === "image/webp" ||
    Object.entries(input.copies).some(
      ([copy, spec]) => spec.bytes < 1 || spec.bytes > IMAGE_COPY_MAX_BYTES[copy as ImageCopy]
    )
  ) {
    throw new TemplateImageServiceError("That picture couldn't be stored. Choose a PNG or JPEG under 20 MB.", 400)
  }

  const asset = { height: input.height, id: (deps.createId ?? randomUUID)(), type: input.type, width: input.width }
  const { bucket, client, sign } = storage(deps)
  const uploads = await Promise.all(
    Object.entries(input.copies).map(async ([copy, spec]) => ({
      contentType: spec.contentType,
      copy: copy as ImageCopy,
      url: await sign(
        client as S3Client,
        new PutObjectCommand({
          Bucket: bucket,
          ContentLength: spec.bytes,
          ContentType: spec.contentType,
          IfNoneMatch: "*",
          Key: imageKey(input.organizationId, asset.id, copy as ImageCopy),
        }),
        { expiresIn: UPLOAD_URL_SECONDS, signableHeaders: new Set(["content-type"]) }
      ),
    }))
  )

  return {
    asset: {
      ...asset,
      originalUrl: await signImageUrl(input.organizationId, asset, "original", deps),
      url: await signImageUrl(input.organizationId, asset, "display", deps),
    },
    uploads,
  }
}

/**
 * Gives each stored picture in some content an address its viewer can load,
 * for the display copy. Call it only after checking the viewer may see the
 * content.
 *
 * @param content - Content the viewer may see.
 * @param organizationId - The workspace that stores its pictures.
 * @param deps - Injected clock and storage for tests.
 * @returns The content with an address on every stored picture.
 */
export async function withTemplateImageUrls<Content extends TemplateContent>(
  content: Content,
  organizationId: string,
  deps: TemplateImageDeps = {}
): Promise<Content> {
  return signImages(content, organizationId, deps, false)
}

/**
 * As {@link withTemplateImageUrls}, with a download of each original too. For
 * the editors only, after their own access checks: an original is exactly as
 * uploaded, with whatever the camera recorded, such as where a photo was taken.
 *
 * @param content - Content the viewer may see.
 * @param organizationId - The workspace that stores its pictures.
 * @param deps - Injected clock and storage for tests.
 * @returns The content with a display address and a download on every stored picture.
 */
export async function withTemplateImageOriginals<Content extends TemplateContent>(
  content: Content,
  organizationId: string,
  deps: TemplateImageDeps = {}
): Promise<Content> {
  return signImages(content, organizationId, deps, true)
}

/**
 * Confirms each picture new to some content finished uploading: its display
 * and print copies are in the workspace's store, each the kind of file it
 * should be. Pictures the content already had were checked when they arrived.
 *
 * @param content - Content about to be saved.
 * @param previous - The content as last saved, if there is any.
 * @param organizationId - The workspace that stores its pictures.
 * @param deps - Injected storage for tests.
 * @throws TemplateImageServiceError 400 for a picture with a copy missing or of the wrong kind.
 */
export async function requireStoredImages(
  content: TemplateContent,
  previous: TemplateContent | null,
  organizationId: string,
  deps: Pick<TemplateImageDeps, "r2Client" | "r2Env"> = {}
): Promise<void> {
  const saved = new Set(previous ? storedImages(previous).map((asset) => asset.id) : [])
  const fresh = new Set(storedImages(content).map((asset) => asset.id).filter((id) => !saved.has(id)))

  if (fresh.size === 0) {
    return
  }

  const { bucket, client } = storage(deps)
  await Promise.all(
    [...fresh].flatMap((id) =>
      (["display", "print"] as const).map(async (copy) => {
        const stored = await client
          .send(new HeadObjectCommand({ Bucket: bucket, Key: imageKey(organizationId, id, copy) }))
          .catch((error: unknown) => {
            if ((error as { name?: string }).name === "NotFound") {
              return null
            }
            throw error
          })

        if (
          !stored?.ContentLength ||
          stored.ContentLength > IMAGE_COPY_MAX_BYTES[copy] ||
          !SHOWN_COPY_TYPES[copy].includes(stored.ContentType ?? "")
        ) {
          throw new TemplateImageServiceError("A picture didn't finish uploading. Add it again.", 400)
        }
      })
    )
  )
}

/**
 * Reads the copy of a picture a PDF prints. Callers have already checked who
 * may see the document.
 *
 * @param organizationId - The workspace that stores the picture.
 * @param asset - The stored picture.
 * @param deps - Injected storage for tests.
 * @returns The print copy's bytes, PNG or JPEG.
 */
export async function readTemplateImage(
  organizationId: string,
  asset: TemplateImageAsset,
  deps: Pick<TemplateImageDeps, "r2Client" | "r2Env"> = {}
): Promise<Uint8Array> {
  const { bucket, client } = storage(deps)
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: imageKey(organizationId, asset.id, "print") })
  )

  if (!result.Body) {
    throw new TemplateImageServiceError("A picture in this document is missing.", 404)
  }

  return result.Body.transformToByteArray()
}

function storedImages(content: TemplateContent): TemplateImageAsset[] {
  const assets: TemplateImageAsset[] = []
  mapImageAssets(content, (asset) => {
    assets.push(asset)
    return asset
  })

  return assets
}

function imageKey(organizationId: string, assetId: string, copy: ImageCopy): string {
  return ["organizations", organizationId, "images", assetId, copy].join("/")
}

async function signImages<Content extends TemplateContent>(
  content: Content,
  organizationId: string,
  deps: TemplateImageDeps,
  originals: boolean
): Promise<Content> {
  const assets = new Map(storedImages(content).map((asset) => [asset.id, asset]))

  if (assets.size === 0) {
    return content
  }

  const signed = new Map(
    await Promise.all(
      [...assets.values()].map(
        async (asset) =>
          [
            asset.id,
            {
              url: await signImageUrl(organizationId, asset, "display", deps),
              ...(originals && { originalUrl: await signImageUrl(organizationId, asset, "original", deps) }),
            },
          ] as const
      )
    )
  )

  return mapImageAssets(content, (asset) => ({ ...asset, ...signed.get(asset.id) }))
}

async function signImageUrl(
  organizationId: string,
  asset: Pick<TemplateImageAsset, "id" | "type">,
  copy: "display" | "original",
  deps: TemplateImageDeps
): Promise<string> {
  const { bucket, client, sign } = storage(deps)
  const signingDate = new Date((deps.now ?? (() => new Date()))())
  signingDate.setUTCMinutes(0, 0, 0)

  return sign(
    client as S3Client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: imageKey(organizationId, asset.id, copy),
      // An original downloads as a file rather than opening in the tab.
      ...(copy === "original" && {
        ResponseContentDisposition: `attachment; filename="picture.${asset.type === "png" ? "png" : "jpg"}"`,
      }),
    }),
    { expiresIn: DISPLAY_URL_SECONDS, signingDate }
  )
}

function storage(deps: TemplateImageDeps) {
  const env = deps.r2Env ?? getR2Env()

  return {
    bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
    client: deps.r2Client ?? createR2Client(env),
    sign: deps.sign ?? getSignedUrl,
  }
}

async function requireMember(
  organizationId: string,
  actorUserId: string,
  deps: TemplateImageDeps
): Promise<OrganizationPermissionSubject> {
  const { data, error } = await loadActiveMembership(deps.client ?? createAdminClient(), organizationId, actorUserId)

  if (error) {
    throw new TemplateImageServiceError("Unable to check your access.", 500)
  }

  const row = data as { role: string; role_definition: { permissions: string[] | null } | null } | null
  const subject = row ? createOrganizationPermissionSubject(row.role, row.role_definition?.permissions) : null

  if (!subject) {
    throw new TemplateImageServiceError("You cannot use this workspace's pictures.", 403)
  }

  return subject
}
