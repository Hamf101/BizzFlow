import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { TemplateEditor } from "@/components/templates/template-editor"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { listTemplateFlowMessages } from "@/services/template-flow-service"
import {
  getDocumentTemplate,
  listDocumentTemplateCategories,
} from "@/services/template-service"
import type { DocumentTemplate } from "@/types/template"
import type { TemplateFlowMessage } from "@/types/template-flow"

import {
  archiveTemplateAction,
  publishTemplateAction,
  updateTemplateAction,
} from "../../actions"

type EditTemplateParams = Promise<{
  templateId: string
}>

/**
 * Loads a manager-visible template into the guided editor.
 *
 * @param props - Route template identifier.
 * @returns The authenticated editor or a user-safe load error.
 */
export default async function EditTemplatePage({
  params,
}: {
  params: EditTemplateParams
}): Promise<ReactElement> {
  const { templateId } = await params
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
        <EditTemplateShell>
          <Alert variant="destructive">
            <AlertTitle>Template unavailable</AlertTitle>
            <AlertDescription>{contextResult.errorMessage}</AlertDescription>
          </Alert>
        </EditTemplateShell>
      )
    }

    redirect(
      buildFeedbackRedirect("/dashboard", "organization_required")
    )
  }

  const context = contextResult.context

  if (
    !canPerformOrganizationAction(context.membership.role, "templates:manage")
  ) {
    redirect(
      buildFeedbackRedirect("/templates", "permission_denied")
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
      <EditTemplateShell>
        <Alert variant="destructive">
          <AlertTitle>Template unavailable</AlertTitle>
          <AlertDescription>{templateResult.errorMessage}</AlertDescription>
        </Alert>
      </EditTemplateShell>
    )
  }

  if (templateResult.template.status === "archived") {
    redirect(
      buildFeedbackRedirect("/templates", "refresh_required")
    )
  }

  const initialFlowMessages = await listTemplateFlowMessages({
    actorUserId: user.id,
    organizationId: context.organization.id,
    templateId,
  }).catch((error: unknown): TemplateFlowMessage[] => {
    console.warn("template_flow_history_page_load_failed", {
      organizationId: context.organization.id,
      templateId,
      userId: user.id,
      reason: error instanceof Error ? error.message : "Unknown history error",
    })
    return []
  })

  // Hints only, so a read failure must not block editing the template.
  const categorySuggestions = await listDocumentTemplateCategories({
    actorUserId: user.id,
    organizationId: context.organization.id,
  }).catch((): string[] => [])

  return (
    <EditTemplateShell>
      <TemplateEditor
        archiveAction={archiveTemplateAction}
        categorySuggestions={categorySuggestions}
        publishAction={publishTemplateAction}
        saveAction={updateTemplateAction}
        initialFlowMessages={initialFlowMessages}
        template={templateResult.template}
      />
    </EditTemplateShell>
  )
}

function EditTemplateShell({
  children,
}: {
  children: ReactElement
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
      {children}
    </div>
  )
}
