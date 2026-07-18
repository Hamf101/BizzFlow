import { ArrowLeft, Plus } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { buildRedirect } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { cn } from "@/lib/utils"

import { createTemplateAction } from "../actions"

type NewTemplateSearchParams = Promise<{
  error?: string
}>

/**
 * Collects initial template metadata before creating a draft revision.
 *
 * @param props - Optional action error encoded in search parameters.
 * @returns A manager-only create form.
 */
export default async function NewTemplatePage({
  searchParams,
}: {
  searchParams: NewTemplateSearchParams
}): Promise<ReactElement> {
  const params = await searchParams
  const user = await loadAuthenticatedPageUser("/templates/new")
  const contextResult = await loadPageOrganizationContext({
    userId: user.id,
    failureEvent: "new_template_context_load_failed",
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
        error: "You cannot create document templates.",
      })
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {params.error && (
        <Alert variant="destructive">
          <AlertTitle>Template could not be created</AlertTitle>
          <AlertDescription>{params.error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3">
        <Link
          className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "w-fit")}
          href="/templates"
        >
          <ArrowLeft />
          Back to templates
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-normal">
            Create a template
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Start with a blank header, body, and footer, then build the content in
            the guided editor.
          </p>
        </div>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Template details</CardTitle>
          <CardDescription>
            The new template stays private as a draft until you publish it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createTemplateAction} className="flex flex-col gap-5" id="new-template-form">
            <Field>
              <FieldLabel htmlFor="new-template-title">Title</FieldLabel>
              <Input
                autoFocus
                id="new-template-title"
                maxLength={180}
                name="title"
                placeholder="For example: New client agreement"
                required
              />
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
                placeholder="Explain when organization members should use this template."
              />
            </Field>
          </form>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Link
            className={cn(buttonVariants({ variant: "ghost" }))}
            href="/templates"
          >
            Cancel
          </Link>
          <Button form="new-template-form" type="submit">
            <Plus />
            Create draft
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
