import {
  type ChangeDocumentTemplatesInput,
  type ChangeDocumentTemplatesResult,
  MAX_BULK_TEMPLATES,
  type TemplateServiceDeps,
} from "./contracts"
import { TemplateServiceError } from "./errors"
import { getClient, requirePermission, runTemplateOperation } from "./shared"
import {
  archiveDocumentTemplate,
  duplicateDocumentTemplate,
  restoreDocumentTemplate,
  setDocumentTemplateCategory,
} from "./template-lifecycle-service"

/**
 * Changes several templates at once: archive, restore, duplicate, or file
 * under a category. Each goes through the same checks and audit trail as a
 * single change; one that fails is counted and the rest still change, so the
 * page can say what happened and offer Undo for exactly what moved.
 *
 * @param input - The change and the selected templates (a category change also carries the category).
 * @param deps - Optional injected dependencies for tests.
 * @returns The templates that changed, any copies made, the categories they had, and how many failed.
 * @throws TemplateServiceError when the person cannot manage templates or the selection is empty or too large.
 */
export async function changeDocumentTemplates(
  input: ChangeDocumentTemplatesInput,
  deps: TemplateServiceDeps = {}
): Promise<ChangeDocumentTemplatesResult> {
  const templateIds = [...new Set(input.templateIds)]

  return runTemplateOperation(
    "change_document_templates",
    { actorUserId: input.actorUserId, change: input.change, count: templateIds.length, organizationId: input.organizationId },
    async (): Promise<ChangeDocumentTemplatesResult> => {
      await requirePermission(
        getClient(deps),
        input.organizationId,
        input.actorUserId,
        "templates:manage",
        "You cannot manage document templates."
      )

      if (templateIds.length === 0 || templateIds.length > MAX_BULK_TEMPLATES) {
        throw new TemplateServiceError(`Choose between 1 and ${MAX_BULK_TEMPLATES} templates.`, 400)
      }

      const result: ChangeDocumentTemplatesResult = { changed: [], created: [], failed: 0, previousCategories: {} }

      // ponytail: one after another, like the Files bulk changes; a selection
      // near the limit is a few hundred small writes. Batch them in one
      // database call if that ever shows up in the logs.
      for (const templateId of templateIds) {
        const one = { actorUserId: input.actorUserId, organizationId: input.organizationId, templateId }

        try {
          if (input.change === "archive") {
            await archiveDocumentTemplate(one, deps)
          } else if (input.change === "restore") {
            await restoreDocumentTemplate(one, deps)
          } else if (input.change === "duplicate") {
            result.created.push((await duplicateDocumentTemplate(one, deps)).id)
          } else {
            const { previousCategory } = await setDocumentTemplateCategory({ ...one, category: input.category ?? null }, deps)
            result.previousCategories[templateId] = previousCategory
          }

          result.changed.push(templateId)
        } catch {
          // The single change has already logged why; the page only needs the count.
          result.failed += 1
        }
      }

      return result
    }
  )
}
