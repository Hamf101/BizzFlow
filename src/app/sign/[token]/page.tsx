import { CheckCircle2, LockKeyhole } from "lucide-react"
import type { Metadata } from "next"
import { headers } from "next/headers"
import type { ReactElement } from "react"

import { BizFlowWordmark } from "@/components/brand/bizflow-mark"
import { PublicDocumentSigningForm } from "@/components/documents/public-document-signing-form"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getClientIp } from "@/lib/client-ip"
import { formatMediumDateTime } from "@/lib/date-format"
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit"
import {
  SigningRecipientStatusBadge,
  SigningWorkflowBadge,
} from "@/lib/page-status-badges"
import { getPublicDocumentSigningView } from "@/services/document-signing-service"
import type {
  PublicDocumentSigningView,
  PublicSignerStatus,
} from "@/types/signing"

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
  const viewResult = (await isSigningViewAllowed())
    ? await getPublicDocumentSigningView({ token })
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
    : {
        view: null,
        errorMessage:
          "Too many requests from your network. Wait a moment and reload.",
      }

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
        <PublicDocumentSigningForm
          editable={isEditable}
          token={token}
          view={view}
        />
        <PublicSigningStatusCard view={view} />
      </div>
    </PublicSigningShell>
  )
}

async function isSigningViewAllowed(): Promise<boolean> {
  try {
    await checkRateLimit("public_signing", getClientIp(await headers()))
    return true
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      return false
    }

    throw error
  }
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
