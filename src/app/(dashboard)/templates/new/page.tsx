import { ArrowLeft, Plus } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { listDocumentTemplateCategories } from "@/services/template-service"

import { createTemplateAction } from "../actions"

/**
 * Collects initial template metadata before creating a draft revision.
 *
 * @returns A manager-only create form.
 */
export default async function NewTemplatePage(): Promise<ReactElement> {
  const user = await loadAuthenticatedPageUser("/templates/new")
  const contextResult = await loadPageOrganizationContext({
    userId: user.id,
    failureEvent: "new_template_context_load_failed"
  })

  if (!contextResult.context && contextResult.errorMessage) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          className={cn(
            buttonVariants({ size: "sm", variant: "ghost" }),
            "w-fit"
          )}
          href="/templates"
        >
          <ArrowLeft />
          Back to templates
        </Link>
        <Alert variant="destructive">
          <AlertTitle>Template creation unavailable</AlertTitle>
          <AlertDescription>{contextResult.errorMessage}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!contextResult.context) {
    redirect(
      buildFeedbackRedirect("/dashboard", "organization_required")
    )
  }

  const context = contextResult.context

  if (
    !canPerformOrganizationAction(context.membership, "templates:manage")
  ) {
    redirect(
      buildFeedbackRedirect("/templates", "permission_denied")
    )
  }

  // Suggestions only — the field stays free text so a new category never needs
  // a code change. An empty list simply means nothing is categorised yet.
  const categorySuggestions = await listDocumentTemplateCategories({
    actorUserId: user.id,
    organizationId: context.organization.id
  }).catch((): string[] => [])

  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center md:min-h-[calc(100dvh-4.5rem)] gap-6">
      <h1 className="text-2xl font-semibold tracking-normal">
        Create a template
      </h1>
      <Card className="w-full max-w-md">
        <CardContent>
          <form
            action={createTemplateAction}
            className="flex flex-col gap-5"
            id="new-template-form"
          >
            <Field>
              <FieldLabel htmlFor="new-template-title">Title</FieldLabel>
              <Input
                autoFocus
                id="new-template-title"
                maxLength={180}
                name="title"
                placeholder="New client agreement"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-template-category">Category</FieldLabel>
              <Input
                id="new-template-category"
                list="template-category-suggestions"
                maxLength={40}
                name="category"
                placeholder="Operations"
              />
              <datalist id="template-category-suggestions">
                {categorySuggestions.map((category: string) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </Field>
            <Field>
              <FieldLabel htmlFor="new-template-description">
                Description
              </FieldLabel>
              <textarea
                className="min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                id="new-template-description"
                maxLength={2_000}
                name="description"
              />
            </Field>
          </form>
        </CardContent>
        <CardFooter className="justify-center gap-2">
          <Link
            className={cn(buttonVariants({ variant: "ghost" }))}
            href="/templates"
          >
            Cancel
          </Link>
          <Button form="new-template-form" type="submit">
            <Plus />
            Create
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
