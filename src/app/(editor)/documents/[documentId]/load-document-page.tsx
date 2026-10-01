import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { cn } from "@/lib/utils"
import { getGeneratedDocumentSigningView } from "@/services/document-signing-service"
import { withTemplateImageUrls } from "@/services/template-image-service"
import type { GeneratedDocumentSigningView } from "@/types/signing"

type PageContext = NonNullable<Awaited<ReturnType<typeof loadPageOrganizationContext>>["context"]>

export type LoadedDocumentPage =
  | { failure: ReactElement }
  | {
      backHref: string
      context: PageContext
      user: Awaited<ReturnType<typeof loadAuthenticatedPageUser>>
      view: GeneratedDocumentSigningView
    }

/**
 * Loads a generated document for the editor or its preview, once the member
 * may see it, with picture addresses they can load.
 *
 * @param documentId - The document to open.
 * @param path - Where sign-in returns to.
 * @returns The document and who is opening it, or what to show instead.
 */
export async function loadDocumentPage(documentId: string, path: string): Promise<LoadedDocumentPage> {
  const user = await loadAuthenticatedPageUser(path)
  const contextResult = await loadPageOrganizationContext({
    userId: user.id,
    failureEvent: "generated_document_editor_context_load_failed",
    failureDetails: { documentId },
  })

  if (!contextResult.context) {
    if (contextResult.errorMessage) {
      return { failure: <Unavailable message={contextResult.errorMessage} title="Document editor unavailable" /> }
    }

    redirect(buildFeedbackRedirect("/dashboard", "organization_required"))
  }

  const context = contextResult.context
  const viewResult = await getGeneratedDocumentSigningView({
    actorUserId: user.id,
    organizationId: context.organization.id,
    documentId,
  })
    .then(async (view: GeneratedDocumentSigningView) => ({
      // Pictures get addresses this person can load, now their access is checked.
      view: {
        ...view,
        document: {
          ...view.document,
          templateSnapshot: await withTemplateImageUrls(view.document.templateSnapshot, view.document.organizationId),
        },
      },
      errorMessage: null as string | null,
    }))
    .catch((error: unknown) => {
      const errorMessage = getPageErrorMessage(error, "Unable to load generated document.")

      console.warn("generated_document_editor_load_failed", {
        documentId,
        organizationId: context.organization.id,
        reason: errorMessage,
        userId: user.id,
      })
      return { view: null, errorMessage }
    })

  if (!viewResult.view) {
    return { failure: <Unavailable message={viewResult.errorMessage} title="Generated document unavailable" /> }
  }

  const folderId = viewResult.view.document.folderId

  return {
    backHref: folderId ? `/documents?folderId=${encodeURIComponent(folderId)}` : "/documents",
    context,
    user,
    view: viewResult.view,
  }
}

function Unavailable({ message, title }: { message: ReactNode; title: string }): ReactElement {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-6">
      <div className="grid w-full max-w-md gap-4">
        <Alert variant="destructive">
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <Link className={cn(buttonVariants({ variant: "outline" }), "justify-self-start")} href="/documents">
          <ArrowLeft />
          Back to Files
        </Link>
      </div>
    </div>
  )
}
