import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { PdfFieldPlacer } from "@/components/pdf-signing/pdf-field-placer"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { getPdfFieldEditor } from "@/services/pdf-signing-service"

export const metadata: Metadata = { title: "Send for signature" }

/**
 * Places each signer's fields on an uploaded PDF and sends it, the PDF itself
 * unchanged. Who may open and send it is decided by the signing service.
 *
 * @param props - Route document identifier.
 * @returns The placing screen, or a short way back when it can't open.
 */
export default async function PdfFieldsPage({ params }: { params: Promise<{ documentId: string }> }): Promise<ReactElement> {
  const { documentId } = await params
  const back = `/documents/${encodeURIComponent(documentId)}`
  const user = await loadAuthenticatedPageUser(`${back}/fields`)
  const { context } = await loadPageOrganizationContext({ failureDetails: { documentId }, failureEvent: "pdf_fields_context_load_failed", userId: user.id })

  if (!context) {
    redirect(buildFeedbackRedirect("/dashboard", "organization_required"))
  }

  const loaded = await getPdfFieldEditor({ actorUserId: user.id, documentId, organizationId: context.organization.id }).then(
    (view) => ({ view }),
    (error: unknown) => ({ message: getPageErrorMessage(error, "This PDF can't be opened for signing.") })
  )

  if ("message" in loaded) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-md place-content-center gap-4 px-6 text-center">
        <h1 className="text-lg font-medium">Can&apos;t send this for signature</h1>
        <p className="text-sm text-muted-foreground">{loaded.message}</p>
        <Link className={cn(buttonVariants({ variant: "outline" }))} href={back}>
          Back to the document
        </Link>
      </main>
    )
  }

  return <PdfFieldPlacer view={loaded.view} />
}
