"use server"

import { z } from "zod"

import type { ImageUploadGrant, ImageUploadRequest } from "@/components/templates/template-image"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import { createTemplateImageUpload, TemplateImageServiceError } from "@/services/template-image-service"

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

function describeFailure(error: unknown, event: string): string {
  if (error instanceof AuthenticationError || error instanceof RateLimitError || error instanceof TemplateImageServiceError) {
    return error.message
  }

  console.error(event, { reason: error instanceof Error ? error.message : "Unknown error" })
  return "Something went wrong with that picture. Try again."
}
