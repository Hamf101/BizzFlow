import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

import { PublicFormLinksPanel } from "@/components/templates/public-form-links-panel"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { listPublicFormLinks } from "@/services/public-form-service"
import { getDocumentTemplate } from "@/services/template-service"
import type { PublicFormLink } from "@/types/public-link"
import type { DocumentTemplate } from "@/types/template"

import {
  createPublicFormLinkAction,
  disablePublicFormLinkAction,
} from "../public-link-actions"

type TemplateLinksParams = Promise<{
  templateId: string
}>

/**
 * Lists and manages the public form links of one published template.
 *
 * @param props - Route template identifier.
 * @returns The template's public links, or a user-safe load failure.
 */
export default async function TemplateLinksPage({
  params,
}: {
  params: TemplateLinksParams
}): Promise<ReactElement> {
  const { templateId } = await params
  const user = await loadAuthenticatedPageUser(`/templates/${templateId}/links`)
  const contextResult = await loadPageOrganizationContext({
    userId: user.id,
    failureEvent: "template_links_context_load_failed",
    failureDetails: { templateId },
  })

  if (!contextResult.context) {
    if (contextResult.errorMessage) {
      return (
        <TemplateLinksShell>
          <LinksUnavailable message={contextResult.errorMessage} />
        </TemplateLinksShell>
      )
    }

    redirect(buildFeedbackRedirect("/dashboard", "organization_required"))
  }

  const context = contextResult.context

  if (!canPerformOrganizationAction(context.membership, "templates:manage")) {
    redirect(buildFeedbackRedirect("/templates", "permission_denied"))
  }

  const result = await Promise.all([
    getDocumentTemplate({
      actorUserId: user.id,
      organizationId: context.organization.id,
      templateId,
    }),
    listPublicFormLinks(context.organization.id, templateId),
  ])
    .then(([template, links]: [DocumentTemplate, PublicFormLink[]]) => ({
      errorMessage: null,
      links,
      template,
    }))
    .catch((error: unknown) => {
      const errorMessage = getPageErrorMessage(
        error,
        "Unable to load public links."
      )

      console.warn("template_links_load_failed", {
        organizationId: context.organization.id,
        reason: errorMessage,
        templateId,
        userId: user.id,
      })
      return { errorMessage, links: [] as PublicFormLink[], template: null }
    })

  if (!result.template) {
    return (
      <TemplateLinksShell>
        <LinksUnavailable message={result.errorMessage} />
      </TemplateLinksShell>
    )
  }

  // Only a published template takes responses through a link.
  if (result.template.status !== "published") {
    redirect(buildFeedbackRedirect("/templates", "refresh_required"))
  }

  return (
    <TemplateLinksShell>
      <h1 className="text-2xl leading-none font-medium tracking-[-0.02em]">
        {result.template.title}
      </h1>
      <PublicFormLinksPanel
        createAction={createPublicFormLinkAction}
        disableAction={disablePublicFormLinkAction}
        links={result.links}
        templateId={result.template.id}
      />
    </TemplateLinksShell>
  )
}

function LinksUnavailable({ message }: { message: string | null }): ReactElement {
  return (
    <Alert variant="destructive">
      <AlertTitle>Public links unavailable</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function TemplateLinksShell({
  children,
}: {
  children: ReactNode
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
