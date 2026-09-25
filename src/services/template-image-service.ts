import { randomUUID } from "node:crypto"

import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3"
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

  return { asset: { ...asset, url: await signDisplayUrl(input.organizationId, asset.id, deps) }, uploads }
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
  const ids = new Set<string>()
  mapImageAssets(content, (asset) => {
    ids.add(asset.id)
    return asset
  })

  if (ids.size === 0) {
    return content
  }

  const urls = new Map(
    await Promise.all([...ids].map(async (id) => [id, await signDisplayUrl(organizationId, id, deps)] as const))
  )

  return mapImageAssets(content, (asset) => ({ ...asset, url: urls.get(asset.id) }))
}

/**
 * A link that downloads a picture exactly as it was uploaded.
 *
 * @param input - Who asks, the workspace, and the picture.
 * @param deps - Injected client and storage for tests.
 * @returns A short-lived download link.
 * @throws TemplateImageServiceError 403 for someone outside the workspace.
 */
export async function createTemplateImageOriginalUrl(
  input: { actorUserId: string; assetId: string; organizationId: string; type: TemplateImageAsset["type"] },
  deps: TemplateImageDeps = {}
): Promise<string> {
  await requireMember(input.organizationId, input.actorUserId, deps)
  const { bucket, client, env, sign } = storage(deps)

  return sign(
    client as S3Client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: imageKey(input.organizationId, input.assetId, "original"),
      ResponseContentDisposition: `attachment; filename="picture.${input.type === "png" ? "png" : "jpg"}"`,
    }),
    { expiresIn: env.CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS }
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

function imageKey(organizationId: string, assetId: string, copy: ImageCopy): string {
  return ["organizations", organizationId, "images", assetId, copy].join("/")
}

async function signDisplayUrl(organizationId: string, assetId: string, deps: TemplateImageDeps): Promise<string> {
  const { bucket, client, sign } = storage(deps)
  const signingDate = new Date((deps.now ?? (() => new Date()))())
  signingDate.setUTCMinutes(0, 0, 0)

  return sign(
    client as S3Client,
    new GetObjectCommand({ Bucket: bucket, Key: imageKey(organizationId, assetId, "display") }),
    { expiresIn: DISPLAY_URL_SECONDS, signingDate }
  )
}

function storage(deps: TemplateImageDeps) {
  const env = deps.r2Env ?? getR2Env()

  return {
    bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
    client: deps.r2Client ?? createR2Client(env),
    env,
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
