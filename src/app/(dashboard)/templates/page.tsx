import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

import {
  getTemplateViewCategory,
  getTemplateViewStatuses,
  templateListState,
} from "@/components/templates/template-list-view"
import { TemplatesWorkspace } from "@/components/templates/templates-workspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { getLastPage, type RawSearchParams } from "@/lib/list-state"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { listSavedViews } from "@/services/saved-view-service"
import {
  listDocumentTemplateCategories,
  listTemplatePage,
  type TemplatePage,
} from "@/services/template-service"

import { duplicateTemplateAction } from "./actions"

type TemplatesSearchParams = Promise<RawSearchParams>

/**
 * Lists one page of the templates the member may see, searched, filtered,
 * sorted, and paged by the validated URL.
 *
 * @param props - View state in search parameters.
 * @returns The Templates workspace, or a user-safe access or load failure.
 */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: TemplatesSearchParams
}): Promise<ReactElement> {
  const query = await searchParams
  const user = await loadAuthenticatedPageUser("/templates")
  const contextResult = await loadPageOrganizationContext({
    userId: user.id,
    failureEvent: "templates_context_load_failed",
  })

  if (!contextResult.context) {
    if (contextResult.errorMessage) {
      return (
        <TemplatesShell>
          <Alert variant="destructive">
            <AlertTitle>Templates unavailable</AlertTitle>
            <AlertDescription>{contextResult.errorMessage}</AlertDescription>
          </Alert>
        </TemplatesShell>
      )
    }

    redirect(
      buildFeedbackRedirect("/dashboard", "organization_required")
    )
  }

  const context = contextResult.context
  const canManage = canPerformOrganizationAction(
    context.membership,
    "templates:manage"
  )
  const view = templateListState.parse(query)
  const [result, categories, savedViews] = await Promise.all([
    listTemplatePage({
      actorUserId: user.id,
      category: getTemplateViewCategory(view),
      organizationId: context.organization.id,
      page: view.page,
      pageSize: view.pageSize,
      query: view.query || undefined,
      sort: view.sort,
      // Everyone else sees published templates only, so only people who
      // manage templates filter by status.
      statuses: canManage ? getTemplateViewStatuses(view) : undefined,
    })
      .then((templatePage: TemplatePage) => ({
        errorMessage: null,
        templatePage,
      }))
      .catch((error: unknown) => {
        const errorMessage = getPageErrorMessage(
          error,
          "Unable to load document templates."
        )
        console.warn("templates_list_load_failed", {
          organizationId: context.organization.id,
          reason: errorMessage,
          userId: user.id,
        })
        return { errorMessage, templatePage: null }
      }),
    // Every category in use, so narrowing to one never hides the others.
    listDocumentTemplateCategories({
      actorUserId: user.id,
      organizationId: context.organization.id,
    }).catch((): string[] => []),
    listSavedViews({
      actorUserId: user.id,
      list: "templates",
      organizationId: context.organization.id,
    }).catch(() => []),
  ])

  if (result.templatePage === null) {
    return (
      <TemplatesShell>
        <h1 className="text-2xl leading-none font-medium tracking-[-0.02em]">
          Templates
        </h1>
        <Alert variant="destructive">
          <AlertTitle>Template library unavailable</AlertTitle>
          <AlertDescription>{result.errorMessage}</AlertDescription>
        </Alert>
      </TemplatesShell>
    )
  }

  const lastPage = getLastPage(result.templatePage.total, view.pageSize)

  // A stale link past the end opens the last page that still has templates.
  if (view.page > lastPage) {
    redirect(templateListState.href("/templates", view, { page: lastPage }))
  }

  return (
    <TemplatesShell>
      <TemplatesWorkspace
        canManage={canManage}
        categories={categories}
        duplicateAction={duplicateTemplateAction}
        templates={result.templatePage.templates}
        savedViews={savedViews}
        total={result.templatePage.total}
        view={view}
      />
    </TemplatesShell>
  )
}

function TemplatesShell({
  children,
}: {
  children: ReactNode
}): ReactElement {
  return <div className="flex flex-col gap-6">{children}</div>
}
