import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { TemplateEditor } from "@/components/templates/template-editor"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { buildRedirect } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { getDocumentTemplate } from "@/services/template-service"
import type { DocumentTemplate } from "@/types/template"

import {
  archiveTemplateAction,
  publishTemplateAction,
  updateTemplateAction,
} from "../../actions"

type EditTemplateParams = Promise<{
  templateId: string
}>

type EditTemplateSearchParams = Promise<{
  error?: string
  message?: string
}>

/**
 * Loads a manager-visible template into the guided editor.
 *
 * @param props - Route template id and optional action feedback.
 * @returns The authenticated editor or a user-safe load error.
 */
export default async function EditTemplatePage({
  params,
  searchParams,
}: {
  params: EditTemplateParams
  searchParams: EditTemplateSearchParams
}): Promise<ReactElement> {
  const [{ templateId }, query] = await Promise.all([params, searchParams])
  const editorPath = `/templates/${templateId}/edit`
  const user = await loadAuthenticatedPageUser(editorPath)
  const contextResult = await loadPageOrganizationContext({
    userId: user.id,
    failureEvent: "template_editor_context_load_failed",
    failureDetails: { templateId },
  })

  if (!contextResult.context) {
    if (contextResult.errorMessage) {
      return (
        <EditTemplateShell query={query}>
          <Alert variant="destructive">
            <AlertTitle>Template unavailable</AlertTitle>
            <AlertDescription>{contextResult.errorMessage}</AlertDescription>
          </Alert>
        </EditTemplateShell>
      )
    }

    redirect(
      buildRedirect("/dashboard", {
        error: "Create an organization before managing templates.",
      })
    )
  }

  const context = contextResult.context

  if (
    !canPerformOrganizationAction(context.membership.role, "templates:manage")
  ) {
    redirect(
      buildRedirect("/templates", {
        error: "You cannot edit document templates.",
      })
    )
  }

  const templateResult = await getDocumentTemplate({
    actorUserId: user.id,
    organizationId: context.organization.id,
    templateId,
  })
    .then((template: DocumentTemplate) => ({
      template,
      errorMessage: null as string | null,
    }))
    .catch((error: unknown) => {
      const errorMessage = getPageErrorMessage(error, "Unable to load template.")

      console.warn("template_editor_load_failed", {
        organizationId: context.organization.id,
        reason: errorMessage,
        templateId,
        userId: user.id,
      })
      return { template: null, errorMessage }
    })

  if (!templateResult.template) {
    return (
      <EditTemplateShell query={query}>
        <Alert variant="destructive">
          <AlertTitle>Template unavailable</AlertTitle>
          <AlertDescription>{templateResult.errorMessage}</AlertDescription>
        </Alert>
      </EditTemplateShell>
    )
  }

  if (templateResult.template.status === "archived") {
    redirect(
      buildRedirect("/templates", {
        error: "Archived templates are read only.",
      })
    )
  }

  return (
    <EditTemplateShell query={query}>
      <TemplateEditor
        archiveAction={archiveTemplateAction}
        publishAction={publishTemplateAction}
        saveAction={updateTemplateAction}
        template={templateResult.template}
      />
    </EditTemplateShell>
  )
}

function EditTemplateShell({
  children,
  query,
}: {
  children: ReactElement
  query: Awaited<EditTemplateSearchParams>
}): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <Link
        className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "w-fit")}
        href="/templates"
      >
        <ArrowLeft />
        Back to templates
      </Link>
      {query.error && (
        <Alert variant="destructive">
          <AlertTitle>Template action failed</AlertTitle>
          <AlertDescription>{query.error}</AlertDescription>
        </Alert>
      )}
      {query.message && (
        <Alert>
          <AlertTitle>Template updated</AlertTitle>
          <AlertDescription>{query.message}</AlertDescription>
        </Alert>
      )}
      {children}
    </div>
  )
}
