import { AlertCircle, ShieldCheck } from "lucide-react"
import { cookies, headers } from "next/headers"
import { userAgent } from "next/server"
import type { ReactElement } from "react"

import { PublicAnswerError, PublicAnswerForm, PublicAnswerSubmit } from "@/components/submissions/public-answer-form"
import { PublicAnswerPaper } from "@/components/submissions/public-answer-paper"
import {
  Card,
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
import { withTemplateImageUrls } from "@/services/template-image-service"
import { type TemplateContent, upgradeV2TemplateContentToV3 } from "@/types/template"

import { submitPublicFormAction } from "./actions"

type PublicFormPageParams = Promise<{
  token: string
}>

/**
 * Renders one active public form and restores its path-scoped draft session.
 *
 * @param props - Async route params.
 * @returns Public form, unavailable state, or restored draft controls.
 */
export default async function PublicFormPage({
  params,
}: {
  params: PublicFormPageParams
}): Promise<ReactElement> {
  const { token } = await params
  const preview = await getPublicFormLinkByToken(token)

  if (!preview.valid || !preview.template) {
    let title = "Form unavailable"
    let description = "This link is invalid or no longer exists."

    if (preview.invalidReason === "expired") {
      title = "Link expired"
      description = "Ask the sender for a new one."
    } else if (preview.invalidReason === "disabled") {
      title = "Link turned off"
      description = "Ask the sender for a new one."
    } else if (preview.invalidReason === "max_submissions_reached") {
      title = "No longer accepting responses"
      description = "This form reached its limit."
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-5" />
              <CardTitle>
                <h1>{title}</h1>
              </CardTitle>
            </div>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
        </Card>
      </main>
    )
  }

  const templateContent = preview.template.content as TemplateContent | null
  // The link was checked above, so its pictures get addresses the visitor can load.
  const content = templateContent
    ? upgradeV2TemplateContentToV3(await withTemplateImageUrls(templateContent, preview.template.organizationId))
    : null
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
    <main className="min-h-dvh bg-muted/20">
      <PublicAnswerForm action={submitPublicFormAction}>
        <input name="token" type="hidden" value={token} />
        {/* Shared public draft handle. File fields write the server-issued
            value here so every upload is parented by one draft submission. */}
        <input name="draftToken" type="hidden" defaultValue={draftState?.draftToken ?? ""} />
        <input name="draftRevision" type="hidden" defaultValue={draftState?.revision ?? ""} />

        <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              {preview.organizationName ? (
                <p className="truncate text-xs text-muted-foreground">{preview.organizationName}</p>
              ) : null}
              {/* The paper prints the title as the page's heading; this keeps it in view. */}
              <p className="truncate text-base font-semibold">{preview.template.title}</p>
            </div>
            <PublicAnswerSubmit />
          </div>
        </header>

        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 pt-4 empty:hidden">
          <PublicAnswerError />
          {preview.template.description ? (
            <p className="text-sm text-muted-foreground">{preview.template.description}</p>
          ) : null}
        </div>

        <div className="py-4 md:px-4 md:py-6">
          {content ? (
            <PublicAnswerPaper
              content={content}
              initialAnswers={{ ...preview.answers, ...draftState?.values }}
              initialFiles={draftState?.files ?? []}
              phone={userAgent({ headers: await headers() }).device.type === "mobile"}
              signer={preview.link?.signer}
              title={preview.template.title}
              token={token}
            />
          ) : null}
        </div>

        <p className="flex justify-center pb-8 text-xs text-muted-foreground">
          {/* A new tab, so the answers on this page are never lost to it. */}
          <a
            className="flex items-center gap-1.5 underline-offset-4 hover:text-foreground hover:underline"
            href="/signup?from=form"
            rel="noopener"
            target="_blank"
          >
            <ShieldCheck className="size-3.5" />
            Secured by BizFlow
          </a>
        </p>
      </PublicAnswerForm>
    </main>
  )
}
