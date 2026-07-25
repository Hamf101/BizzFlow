import { CheckCircle2, LockKeyhole, Send } from "lucide-react"
import type { Metadata } from "next"
import type { ReactElement } from "react"

import { BizFlowWordmark } from "@/components/brand/bizflow-mark"
import { DrawnSignatureField } from "@/components/documents/drawn-signature-field"
import { GeneratedDocumentContent } from "@/components/documents/generated-document-content"
import { getGeneratedDocumentAnswerBaselineFields } from "@/components/documents/generated-document-form-data"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatMediumDateTime } from "@/lib/date-format"
import {
  SigningRecipientStatusBadge,
  SigningWorkflowBadge,
} from "@/lib/page-status-badges"
import { getPublicDocumentSigningView } from "@/services/document-signing-service"
import type {
  PublicDocumentSigningView,
  PublicSignerStatus,
} from "@/types/signing"

import { completePublicSigningAction } from "./actions"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { follow: false, index: false },
}

type PublicSigningParams = Promise<{
  token: string
}>

type PublicSigningSearchParams = Promise<{
  error?: string
  message?: string
}>

/**
 * Loads a generated document through one private, expiring recipient token.
 *
 * @param props - Raw route token and optional signing action feedback.
 * @returns A safe recipient view that never exposes co-signer emails.
 */
export default async function PublicSigningPage({
  params,
  searchParams,
}: {
  params: PublicSigningParams
  searchParams: PublicSigningSearchParams
}): Promise<ReactElement> {
  const [{ token }, query] = await Promise.all([params, searchParams])
  const viewResult = await getPublicDocumentSigningView({ token })
    .then((view: PublicDocumentSigningView) => ({
      view,
      errorMessage: null as string | null,
    }))
    .catch((error: unknown) => {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "This signing link is invalid or no longer available."

      // The private token and token-derived path must never enter logs.
      console.warn("public_document_signing_view_failed", {
        reason: errorMessage,
      })
      return { view: null, errorMessage }
    })

  if (!viewResult.view) {
    return (
      <PublicSigningShell query={query}>
        <Card className="mx-auto w-full max-w-xl">
          <CardHeader>
            <CardTitle>Signing link unavailable</CardTitle>
            <CardDescription>
              The private link may be invalid, expired, or replaced by a newer
              invitation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertTitle>Unable to open document</AlertTitle>
              <AlertDescription>{viewResult.errorMessage}</AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter>
            <span className="text-xs text-muted-foreground">
              Ask the document sender to resend your invitation.
            </span>
          </CardFooter>
        </Card>
      </PublicSigningShell>
    )
  }

  const view = viewResult.view
  const isRecipientSigned = view.recipient.status === "signed"
  const isCompleted = view.workflowStatus === "completed"
  const isEditable = !isRecipientSigned && !isCompleted

  return (
    <PublicSigningShell query={query}>
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <LockKeyhole className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Private signing link</span>
          <SigningWorkflowBadge status={view.workflowStatus} />
        </div>
        <h1 className="text-2xl font-semibold tracking-normal">
          {view.document.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          {view.organizationName} invited {view.recipient.name} ({view.recipient.email})
          to review and complete this document.
        </p>
      </section>

      {isCompleted ? (
        <Alert className="mx-auto w-full max-w-6xl">
          <CheckCircle2 />
          <AlertTitle>All parties have signed</AlertTitle>
          <AlertDescription>
            This document is complete and its answers are read only.
          </AlertDescription>
        </Alert>
      ) : isRecipientSigned ? (
        <Alert className="mx-auto w-full max-w-6xl">
          <CheckCircle2 />
          <AlertTitle>Your signature is recorded</AlertTitle>
          <AlertDescription>
            The document is still waiting for one or more other parties.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="mx-auto w-full max-w-6xl">
          <AlertTitle>Review before signing</AlertTitle>
          <AlertDescription>
            Shared answers may be completed by any recipient. Your signature is
            recorded only after you submit the acknowledgement below.
          </AlertDescription>
        </Alert>
      )}

      <div className="mx-auto grid w-full max-w-6xl items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <PublicDocumentForm editable={isEditable} token={token} view={view} />
        <PublicSigningStatusCard view={view} />
      </div>
    </PublicSigningShell>
  )
}

function PublicDocumentForm({
  editable,
  token,
  view,
}: {
  editable: boolean
  token: string
  view: PublicDocumentSigningView
}): ReactElement {
  const answerBaselineFields = getGeneratedDocumentAnswerBaselineFields(
    view.document.templateSnapshot,
    view.answers
  )

  return (
    <form action={completePublicSigningAction} className="flex min-w-0 flex-col gap-6">
      <input name="token" type="hidden" value={token} />
      {answerBaselineFields.map((field) => (
        <input key={field.name} name={field.name} type="hidden" value={field.value} />
      ))}

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Document</CardTitle>
          <CardDescription>
            {editable
              ? "Complete any outstanding fields, then sign below."
              : "This submitted document is read only."}
          </CardDescription>
          <CardAction>
            <Badge variant="outline">{editable ? "Editable" : "Read only"}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="overflow-auto bg-muted/30 p-4 sm:p-6">
          <GeneratedDocumentContent
            answers={view.answers}
            content={view.document.templateSnapshot}
            editable={editable}
            recipientSigned={view.recipient.status === "signed"}
            recipientSigning
          />
        </CardContent>
        <CardFooter>
          <span className="text-xs text-muted-foreground">
            The document uses the immutable template snapshot selected by the sender.
          </span>
        </CardFooter>
      </Card>

      {editable && (
        <Card>
          <CardHeader>
            <CardTitle>Signing acknowledgement</CardTitle>
            <CardDescription>
              A drawn signature is a basic acknowledgement for this workflow.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <DrawnSignatureField
              label="Signature"
              name="signatureDataUrl"
              required
            />
            <DrawnSignatureField
              description={
                view.requiresInitials
                  ? "Required because this document contains a required initials field."
                  : "Optional. Add initials if this document calls for them."
              }
              label="Initials"
              name="initialsDataUrl"
              required={view.requiresInitials}
            />
            <Alert>
              <AlertTitle>Basic electronic acknowledgement</AlertTitle>
              <AlertDescription>
                This MVP drawing is not a qualified or regulated electronic
                signature product.
              </AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              By submitting, you confirm the answers and drawing shown here.
            </span>
            <Button type="submit">
              <Send />
              Submit signature
            </Button>
          </CardFooter>
        </Card>
      )}
    </form>
  )
}

function PublicSigningStatusCard({
  view,
}: {
  view: PublicDocumentSigningView
}): ReactElement {
  const signedCount = view.signers.filter(
    (signer: PublicSignerStatus) => signer.status === "signed"
  ).length

  return (
    <Card className="xl:sticky xl:top-6">
      <CardHeader>
        <CardTitle>Signing status</CardTitle>
        <CardDescription>
          {signedCount} of {view.signers.length} signatures recorded.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {view.signers.map((signer: PublicSignerStatus) => (
            <div
              className="flex items-start justify-between gap-3 rounded-lg border bg-background p-3"
              key={signer.id}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{signer.name}</p>
                <p className="text-xs text-muted-foreground">
                  {signer.signedAt
                    ? `Signed ${formatMediumDateTime(signer.signedAt)}`
                    : "Signature required"}
                </p>
              </div>
              <SigningRecipientStatusBadge status={signer.status} />
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter>
        <span className="text-xs text-muted-foreground">
          Co-signer email addresses and drawings are never shown on this page.
        </span>
      </CardFooter>
    </Card>
  )
}

function PublicSigningShell({
  children,
  query,
}: {
  children: ReactElement | ReactElement[]
  query: Awaited<PublicSigningSearchParams>
}): ReactElement {
  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:py-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between gap-4 border-b pb-4">
          <BizFlowWordmark />
          <Badge variant="secondary">Private access</Badge>
        </div>
        {query.error && (
          <Alert variant="destructive">
            <AlertTitle>Signing could not be completed</AlertTitle>
            <AlertDescription>{query.error}</AlertDescription>
          </Alert>
        )}
        {query.message && (
          <Alert>
            <CheckCircle2 />
            <AlertTitle>Signing updated</AlertTitle>
            <AlertDescription>{query.message}</AlertDescription>
          </Alert>
        )}
        {children}
      </div>
    </main>
  )
}
