import { AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react"
import { cookies } from "next/headers"
import type { ReactElement } from "react"

import { PublicFormFields } from "@/components/submissions/public-form-fields"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PUBLIC_FORM_DRAFT_COOKIE_NAME } from "@/lib/public-form-draft-cookie"
import {
  getPublicFormDraftState,
  getPublicFormLinkByToken,
  type PublicFormDraftState,
} from "@/services/public-form-service"
import type { TemplateContent } from "@/types/template"

import { submitPublicFormAction } from "./actions"

type PublicFormPageParams = Promise<{
  token: string
}>

type PublicFormPageSearchParams = Promise<{
  error?: string
}>

/**
 * Renders one active public form and restores its path-scoped draft session.
 *
 * @param props - Async route params and optional redirected error message.
 * @returns Public form, unavailable state, or restored draft controls.
 */
export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: PublicFormPageParams
  searchParams: PublicFormPageSearchParams
}): Promise<ReactElement> {
  const [{ token }, query] = await Promise.all([params, searchParams])
  const preview = await getPublicFormLinkByToken(token)

  if (!preview.valid || !preview.template) {
    let title = "Form unavailable"
    let description = "This public form link is invalid or no longer exists."

    if (preview.invalidReason === "expired") {
      title = "Form link expired"
      description = "This form link has expired. Please request an updated link from the organization."
    } else if (preview.invalidReason === "disabled") {
      title = "Form link disabled"
      description = "This form link has been deactivated by the organization."
    } else if (preview.invalidReason === "max_submissions_reached") {
      title = "Submission limit reached"
      description = "This form has received the maximum allowed number of public submissions."
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-5" />
              <CardTitle>{title}</CardTitle>
            </div>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const templateContent = preview.template.content as TemplateContent | null
  const content = templateContent ?? null
  const cookieStore = await cookies()
  const storedDraftToken =
    cookieStore.get(PUBLIC_FORM_DRAFT_COOKIE_NAME)?.value ?? null
  let draftState: PublicFormDraftState | null = null

  if (storedDraftToken) {
    try {
      draftState = await getPublicFormDraftState(token, storedDraftToken)
    } catch (error: unknown) {
      console.warn("public_form_draft_restore_rejected", {
        reason: error instanceof Error ? error.message : "Unknown draft error",
        templateId: preview.template.id,
      })
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/20 px-4 py-8">
      <div className="mx-auto w-full max-w-2xl flex-1">
        {query.error && (
          <Alert className="mb-6" variant="destructive">
            <AlertTitle>Submission error</AlertTitle>
            <AlertDescription>{query.error}</AlertDescription>
          </Alert>
        )}

        <Card className="border-border shadow-sm">
          <CardHeader>
            {preview.organizationName && (
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {preview.organizationName}
              </span>
            )}
            <CardTitle className="text-2xl">{preview.template.title}</CardTitle>
            {preview.template.description && (
              <CardDescription>{preview.template.description}</CardDescription>
            )}
          </CardHeader>

          <CardContent>
            <form action={submitPublicFormAction} className="flex flex-col gap-6">
              <input name="token" type="hidden" value={token} />
              {/* Shared public draft handle. File fields write the server-issued
                  value here so every upload is parented by one draft submission. */}
              <input
                name="draftToken"
                type="hidden"
                defaultValue={draftState?.draftToken ?? ""}
              />
              <input
                name="draftRevision"
                type="hidden"
                defaultValue={draftState?.revision ?? ""}
              />

              {content && (
                <PublicFormFields
                  content={content}
                  initialAnswers={draftState?.values}
                  initialFiles={draftState?.files}
                  token={token}
                />
              )}

              <div className="flex flex-col gap-3 pt-4 border-t border-border">
                <Button size="lg" type="submit">
                  <CheckCircle2 className="mr-2 size-4" />
                  Submit form
                </Button>
                <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5" />
                  <span>Secure public form powered by BizFlow</span>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
