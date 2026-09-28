"use server"

import { z } from "zod"

import type { ImageUploadGrant, ImageUploadRequest } from "@/components/templates/template-image"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import { createPictureOriginalDownload } from "@/services/picture-download-service"
import { createTemplateImageUpload, TemplateImageServiceError } from "@/services/template-image-service"
import type { PictureSource } from "@/types/template-images"

const copySchema = z.object({
  bytes: z.number().int().positive(),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
})
const requestSchema = z.object({
  copies: z.object({ display: copySchema, original: copySchema, print: copySchema }),
  height: z.number().int().min(1).max(30_000),
  type: z.enum(["png", "jpeg"]),
  width: z.number().int().min(1).max(30_000),
})
const downloadSchema = z.object({
  assetId: z.string().uuid(),
  source: z.union([z.object({ templateId: z.string().uuid() }), z.object({ documentId: z.string().uuid() })]),
})

/**
 * Makes room for a picture in the signed-in person's workspace.
 *
 * @param request - The picture's size, format, and copies.
 * @returns The stored picture and its upload links, or an error to show.
 */
export async function requestImageUploadAction(request: ImageUploadRequest): Promise<ImageUploadGrant> {
  try {
    const parsed = requestSchema.parse(request)
    const user = await getAuthenticatedUser()
    await checkRateLimit("upload_initiation", user.id)
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      return { error: "Join a workspace to add pictures." }
    }

    return await createTemplateImageUpload({ ...parsed, actorUserId: user.id, organizationId: context.organization.id })
  } catch (error: unknown) {
    return { error: describeFailure(error, "image_upload_action_failed") }
  }
}

/**
 * A short-lived link that downloads a picture exactly as it was uploaded, for
 * someone who can still open the template or document it's in.
 *
 * @param request - The picture, and the template or document it's in.
 * @returns The download link, or an error to show.
 */
export async function downloadImageOriginalAction(request: {
  assetId: string
  source: PictureSource
}): Promise<{ error: string } | { url: string }> {
  try {
    const parsed = downloadSchema.parse(request)
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      return { error: "Join a workspace to download pictures." }
    }

    return {
      url: await createPictureOriginalDownload({ ...parsed, actorUserId: user.id, organizationId: context.organization.id }),
    }
  } catch (error: unknown) {
    return { error: describeFailure(error, "image_original_action_failed") }
  }
}

function describeFailure(error: unknown, event: string): string {
  if (error instanceof AuthenticationError || error instanceof RateLimitError || error instanceof TemplateImageServiceError) {
    return error.message
  }

  console.error(event, { reason: error instanceof Error ? error.message : "Unknown error" })
  return "Something went wrong with that picture. Try again."
}
