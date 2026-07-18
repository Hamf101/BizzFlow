import { FileText, Pencil, Plus } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatMediumDate } from "@/lib/date-format"
import { buildRedirect } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { TemplateStatusBadge } from "@/lib/page-status-badges"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { listDocumentTemplates } from "@/services/template-service"
import type { DocumentTemplate } from "@/types/template"

type TemplatesSearchParams = Promise<{
  error?: string
  message?: string
}>

/**
 * Lists organization templates visible to the current authenticated member.
 *
 * @param props - Optional action feedback encoded in search parameters.
 * @returns The permission-aware template library.
 */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: TemplatesSearchParams
}): Promise<ReactElement> {
  const params = await searchParams
  const user = await loadAuthenticatedPageUser("/templates")
  const contextResult = await loadPageOrganizationContext({
    userId: user.id,
    failureEvent: "templates_context_load_failed",
  })

  if (!contextResult.context) {
    if (contextResult.errorMessage) {
      return (
        <TemplatesShell params={params}>
          <Alert variant="destructive">
            <AlertTitle>Templates unavailable</AlertTitle>
            <AlertDescription>{contextResult.errorMessage}</AlertDescription>
          </Alert>
        </TemplatesShell>
      )
    }

    redirect(
      buildRedirect("/dashboard", {
        error: "Create an organization before viewing templates.",
      })
    )
  }

  const context = contextResult.context
  const templatesResult = await listDocumentTemplates({
    actorUserId: user.id,
    organizationId: context.organization.id,
  })
    .then((templates: DocumentTemplate[]) => ({
      templates,
      errorMessage: null as string | null,
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
      return { templates: [] as DocumentTemplate[], errorMessage }
    })
  const canManage = canPerformOrganizationAction(
    context.membership.role,
    "templates:manage"
  )

  return (
    <TemplatesShell params={params}>
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-normal">Templates</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Reusable, organization-wide documents for {context.organization.name}.
          </p>
        </div>
        {canManage && (
          <Link className={cn(buttonVariants())} href="/templates/new">
            <Plus />
            Create template
          </Link>
        )}
      </section>

      {templatesResult.errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Template library unavailable</AlertTitle>
          <AlertDescription>{templatesResult.errorMessage}</AlertDescription>
        </Alert>
      ) : (
        <TemplateLibrary
          canManage={canManage}
          templates={templatesResult.templates}
        />
      )}
    </TemplatesShell>
  )
}

function TemplatesShell({
  children,
  params,
}: {
  children: ReactElement | ReactElement[]
  params: Awaited<TemplatesSearchParams>
}): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      {params.error && (
        <Alert variant="destructive">
          <AlertTitle>Template action failed</AlertTitle>
          <AlertDescription>{params.error}</AlertDescription>
        </Alert>
      )}
      {params.message && (
        <Alert>
          <AlertTitle>Templates updated</AlertTitle>
          <AlertDescription>{params.message}</AlertDescription>
        </Alert>
      )}
      {children}
    </div>
  )
}

function TemplateLibrary({
  canManage,
  templates,
}: {
  canManage: boolean
  templates: DocumentTemplate[]
}): ReactElement {
  if (templates.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No templates yet</CardTitle>
          <CardDescription>
            {canManage
              ? "Create a guided template for your organization."
              : "Published templates will appear here when they are ready."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
            <FileText className="size-8 text-muted-foreground" />
            <p className="max-w-sm text-sm text-muted-foreground">
              Templates combine reusable content, fillable fields, and optional
              print branding.
            </p>
          </div>
        </CardContent>
        <CardFooter>
          {canManage ? (
            <Link
              className={cn(buttonVariants({ variant: "outline" }))}
              href="/templates/new"
            >
              <Plus />
              Create the first template
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">
              Only published templates are visible to staff.
            </span>
          )}
        </CardFooter>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {templates.map((template: DocumentTemplate) => (
        <Card key={template.id}>
          <CardHeader>
            <CardTitle>{template.title}</CardTitle>
            <CardDescription>
              Updated {formatMediumDate(template.updatedAt)}
            </CardDescription>
            <CardAction>
              <TemplateStatusBadge status={template.status} />
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="min-h-10 text-sm text-muted-foreground">
              {template.description || "No description provided."}
            </p>
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              Revision {template.revision}
            </span>
            {canManage && template.status !== "archived" ? (
              <Link
                className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                href={`/templates/${template.id}/edit`}
              >
                <Pencil />
                Edit
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">
                {template.status === "published" ? "Available to use" : "Read only"}
              </span>
            )}
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
