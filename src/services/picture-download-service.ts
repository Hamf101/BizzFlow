import {
  DocumentSigningServiceError,
  getGeneratedDocumentSigningView,
} from "@/services/document-signing-service"
import {
  signTemplateImageOriginal,
  storedImages,
  type TemplateImageDeps,
  TemplateImageServiceError,
} from "@/services/template-image-service"
import { getDocumentTemplate, TemplateServiceError } from "@/services/template-service"
import type { TemplateContent } from "@/types/template"
import type { PictureSource } from "@/types/template-images"

export type PictureDownloadDeps = Pick<TemplateImageDeps, "r2Client" | "r2Env" | "sign"> & {
  loadDocument?: typeof getGeneratedDocumentSigningView
  loadTemplate?: typeof getDocumentTemplate
}

/**
 * A short-lived link that downloads a picture's original, checked when it's
 * asked for: the person must still be able to open the template or document
 * the picture is in, and the picture must be in it. An original keeps
 * whatever the camera recorded, so a link never outlives that check by more
 * than a few minutes.
 *
 * @param input - Who asks, the workspace, the picture, and where it is.
 * @param deps - Injected loaders and storage for tests.
 * @returns A download link that expires within minutes.
 * @throws TemplateImageServiceError 403 or 404 once they can no longer open it, 404 for a picture that isn't in it.
 */
export async function createPictureOriginalDownload(
  input: { actorUserId: string; assetId: string; organizationId: string; source: PictureSource },
  deps: PictureDownloadDeps = {}
): Promise<string> {
  const asset = storedImages(await loadContent(input, deps)).find((each) => each.id === input.assetId)

  if (!asset) {
    throw new TemplateImageServiceError("That picture isn't in this document.", 404)
  }

  return signTemplateImageOriginal(input.organizationId, asset, deps)
}

async function loadContent(
  input: { actorUserId: string; organizationId: string; source: PictureSource },
  deps: PictureDownloadDeps
): Promise<TemplateContent> {
  const who = { actorUserId: input.actorUserId, organizationId: input.organizationId }

  try {
    return "templateId" in input.source
      ? (await (deps.loadTemplate ?? getDocumentTemplate)({ ...who, templateId: input.source.templateId })).content
      : (await (deps.loadDocument ?? getGeneratedDocumentSigningView)({ ...who, documentId: input.source.documentId }))
          .document.templateSnapshot
  } catch (error: unknown) {
    // The editors' own refusals, in words the person can act on.
    if (error instanceof TemplateServiceError || error instanceof DocumentSigningServiceError) {
      throw new TemplateImageServiceError(error.message, error.statusCode)
    }

    throw error
  }
}
