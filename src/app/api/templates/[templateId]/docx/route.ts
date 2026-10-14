import { createRouteErrorResponse } from "@/app/api/_route-error"
import { docxDownload, exportFilename } from "@/app/api/documents/_export"
import { getAuthenticatedUser } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { renderGeneratedDocumentDocx } from "@/services/document-docx-service"
import { DocumentPdfServiceError } from "@/services/document-pdf-service"
import { getCurrentOrganizationContext, OrganizationServiceError } from "@/services/organization-service"
import { readTemplateImage } from "@/services/template-image-service"
import { canEditDocumentTemplate, getDocumentTemplate, TemplateServiceError } from "@/services/template-service"

// A long template renders in a few seconds; this leaves room for pictures and a busy moment.
export const maxDuration = 60

type TemplateDocxRouteContext = { params: Promise<{ templateId: string }> }

/**
 * Delivers a template as a blank Word form, laid out as its PDF would be:
 * every branch printed under its rule in words. Only someone who may edit the
 * template may download it, as only they may open its editor.
 *
 * @param _request - Authenticated GET request.
 * @param context - Dynamic template route parameters.
 * @returns The .docx bytes, or a safe JSON error.
 */
export async function GET(_request: Request, context: TemplateDocxRouteContext): Promise<Response> {
  try {
    const { templateId } = await context.params
    const user = await getAuthenticatedUser()
    const organization = (await getCurrentOrganizationContext(user.id))?.organization

    if (!organization) {
      throw new TemplateServiceError("Create or join an organization before downloading templates.", 403)
    }

    // Each download renders afresh, so it spends from the same buckets a document's does.
    await checkRateLimit("pdf_render", `${organization.id}:${templateId}`)
    await checkRateLimit("pdf_render_user", user.id)

    const access = { actorUserId: user.id, organizationId: organization.id, templateId }

    if (!(await canEditDocumentTemplate(access))) {
      throw new TemplateServiceError("You cannot edit this template.", 403)
    }

    const template = await getDocumentTemplate(access)
    const docx = await renderGeneratedDocumentDocx(
      { answers: {}, content: template.content, documentId: template.id, title: template.title, workflowStatus: "draft" },
      { readImage: (asset) => readTemplateImage(organization.id, asset) }
    )

    return docxDownload(docx, exportFilename(template.title, "docx"))
  } catch (error: unknown) {
    return createRouteErrorResponse(error, "templates_docx", {
      event: "template_route",
      failure: "Unable to download the template as Word.",
      known: [TemplateServiceError, OrganizationServiceError, DocumentPdfServiceError],
    })
  }
}
