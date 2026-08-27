import { Copy, FileText, Pencil, Plus } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

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
import { PublicFormLinksPanel } from "@/components/templates/public-form-links-panel"
import { formatMediumDate } from "@/lib/date-format"
import { buildRedirect } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { TemplateStatusBadge } from "@/lib/page-status-badges"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { listPublicFormLinks } from "@/services/public-form-service"
import {
  listDocumentTemplateCategories,
  listDocumentTemplates,
} from "@/services/template-service"
import type { PublicFormLink } from "@/types/public-link"
import type { DocumentTemplate } from "@/types/template"

import {
  createPublicFormLinkAction,
  disablePublicFormLinkAction,
} from "./[templateId]/public-link-actions"
import { duplicateTemplateAction } from "./actions"

type TemplatesSearchParams = Promise<{
  category?: string
  error?: string
  message?: string
}>

/** Search-param value selecting the templates with no category at all. */
const UNCATEGORIZED_FILTER = "none"

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
  const activeCategory = params.category?.trim() || null
  const templatesResult = await listDocumentTemplates({
    actorUserId: user.id,
    organizationId: context.organization.id,
    // Omitting the key means "every category"; null means "uncategorised".
    ...(activeCategory === null
      ? {}
      : {
          category:
            activeCategory === UNCATEGORIZED_FILTER ? null : activeCategory,
        }),
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
  // Always the full set, so filtering to one category never hides the others.
  const categories = await listDocumentTemplateCategories({
    actorUserId: user.id,
    organizationId: context.organization.id,
  }).catch((): string[] => [])

  const publicLinksMap: Record<string, PublicFormLink[]> = {}
  if (templatesResult.templates.length > 0 && canManage) {
    await Promise.all(
      templatesResult.templates.map(async (template) => {
        if (template.status === "published") {
          try {
            const links = await listPublicFormLinks(
              context.organization.id,
              template.id
            )
            publicLinksMap[template.id] = links
          } catch {
            publicLinksMap[template.id] = []
          }
        }
      })
    )
  }

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

      {categories.length > 0 && (
        <TemplateCategoryFilter
          activeCategory={activeCategory}
          categories={categories}
        />
      )}

      {templatesResult.errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Template library unavailable</AlertTitle>
          <AlertDescription>{templatesResult.errorMessage}</AlertDescription>
        </Alert>
      ) : (
        <TemplateLibrary
          activeCategory={activeCategory}
          canManage={canManage}
          publicLinksMap={publicLinksMap}
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
  children: ReactNode
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

/**
 * Lets a member narrow the library to one category.
 *
 * Plain links rather than a client-side control: the filter is applied by the
 * service against an indexed column, so it belongs in the URL where it can be
 * shared and restored.
 *
 * @param props - Every category in use and the one currently applied.
 * @returns A row of filter chips.
 */
function TemplateCategoryFilter({
  activeCategory,
  categories,
}: {
  activeCategory: string | null
  categories: string[]
}): ReactElement {
  const options: { href: string; key: string; label: string }[] = [
    { href: "/templates", key: "all", label: "All" },
    ...categories.map((category: string) => ({
      href: `/templates?category=${encodeURIComponent(category)}`,
      key: category,
      label: category,
    })),
    {
      href: `/templates?category=${UNCATEGORIZED_FILTER}`,
      key: UNCATEGORIZED_FILTER,
      label: "Ungrouped",
    },
  ]

  return (
    <nav aria-label="Filter templates by category">
      <ul className="flex flex-wrap items-center gap-2">
        {options.map((option) => {
          const isActive = (activeCategory ?? "all") === option.key

          return (
            <li key={option.key}>
              <Link
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" }),
                  isActive &&
                    "border-primary bg-secondary text-secondary-foreground"
                )}
                href={option.href}
              >
                {option.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function TemplateLibrary({
  activeCategory,
  canManage,
  publicLinksMap,
  templates,
}: {
  activeCategory: string | null
  canManage: boolean
  publicLinksMap: Record<string, PublicFormLink[]>
  templates: DocumentTemplate[]
}): ReactElement {
  if (templates.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {activeCategory === null
              ? "No templates yet"
              : "No templates in this category"}
          </CardTitle>
          <CardDescription>
            {activeCategory !== null
              ? "Clear the filter to see the rest of the library."
              : canManage
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
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-2">
        {templates.map((template: DocumentTemplate) => (
          <Card key={template.id}>
            <CardHeader>
              <CardTitle>{template.title}</CardTitle>
              <CardDescription>
                {template.category
                  ? `${template.category} · Updated ${formatMediumDate(template.updatedAt)}`
                  : `Updated ${formatMediumDate(template.updatedAt)}`}
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
                <div className="flex gap-2">
                  <form action={duplicateTemplateAction}>
                    <input type="hidden" name="templateId" value={template.id} />
                    <button
                      type="submit"
                      className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                    >
                      <Copy />
                      Duplicate
                    </button>
                  </form>
                  <Link
                    className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                    href={`/templates/${template.id}/edit`}
                  >
                    <Pencil />
                    Edit
                  </Link>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {template.status === "published" ? "Available to use" : "Read only"}
                </span>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>

      {canManage &&
        templates.some((t) => t.status === "published") && (
          <div className="flex flex-col gap-4 pt-4 border-t border-border">
            <h2 className="text-lg font-semibold tracking-tight">Public Access Links</h2>
            {templates
              .filter((t) => t.status === "published")
              .map((template) => (
                <PublicFormLinksPanel
                  createAction={createPublicFormLinkAction}
                  disableAction={disablePublicFormLinkAction}
                  key={template.id}
                  links={publicLinksMap[template.id] ?? []}
                  templateId={template.id}
                />
              ))}
          </div>
        )}
    </div>
  )
}
