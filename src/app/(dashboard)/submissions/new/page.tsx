import { randomUUID } from "node:crypto"

import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { listDocumentTemplates } from "@/services/template-service"
import type { DocumentTemplate } from "@/types/template"

import { createSubmissionAction } from "../actions"

/**
 * Presents published organization templates that can start an internal draft.
 *
 * @returns Published-template selection and submission title form.
 */
export default async function NewSubmissionPage(): Promise<ReactElement> {
  const user = await loadAuthenticatedPageUser("/submissions/new")
  const contextResult = await loadPageOrganizationContext({
    userId: user.id,
    failureEvent: "new_submission_context_load_failed",
  })

  if (!contextResult.context) {
    redirect(
      buildFeedbackRedirect(
        "/submissions",
        contextResult.errorMessage ? "operation_failed" : "organization_required"
      )
    )
  }

  const context = contextResult.context

  if (
    !canPerformOrganizationAction(
      context.membership,
      "submissions:create"
    )
  ) {
    redirect(
      buildFeedbackRedirect("/submissions", "permission_denied")
    )
  }

  const templateResult = await listDocumentTemplates({
    actorUserId: user.id,
    organizationId: context.organization.id,
  })
    .then((templates: DocumentTemplate[]) => ({
      templates: templates.filter(
        (template: DocumentTemplate): boolean =>
          template.status === "published"
      ),
      errorMessage: null as string | null,
    }))
    .catch((error: unknown) => ({
      templates: [] as DocumentTemplate[],
      errorMessage: getPageErrorMessage(
        error,
        "Unable to load published templates."
      ),
    }))

  return (
    <div className="flex flex-col gap-6">
      <Link
        className={cn(
          buttonVariants({ size: "sm", variant: "ghost" }),
          "w-fit"
        )}
        href="/submissions"
      >
        <ArrowLeft />
        Back to submissions
      </Link>

      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-normal">
          Start submission
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Choose a published template. The draft keeps an immutable copy of that
          exact template revision.
        </p>
      </section>

      {templateResult.errorMessage && (
        <Alert variant="destructive">
          <AlertTitle>Templates unavailable</AlertTitle>
          <AlertDescription>{templateResult.errorMessage}</AlertDescription>
        </Alert>
      )}

      {!templateResult.errorMessage && templateResult.templates.length === 0 ? (
        <Alert>
          <AlertTitle>No published templates</AlertTitle>
          <AlertDescription>
            A manager needs to publish a template before staff can start a
            submission.
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Draft details</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createSubmissionAction} className="flex flex-col gap-5">
              <input name="submissionId" type="hidden" value={randomUUID()} />
              <Field>
                <FieldLabel htmlFor="submission-title">Title</FieldLabel>
                <Input
                  id="submission-title"
                  maxLength={180}
                  minLength={1}
                  name="title"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="submission-template">Template</FieldLabel>
                <select
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  id="submission-template"
                  name="templateId"
                  required
                >
                  <option value="">Choose a published template</option>
                  {templateResult.templates.map(
                    (template: DocumentTemplate) => (
                      <option key={template.id} value={template.id}>
                        {template.title} · revision {template.revision}
                      </option>
                    )
                  )}
                </select>
              </Field>
              <button className={cn(buttonVariants(), "w-fit")} type="submit">
                Create draft
              </button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
