import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

import { GuestFile } from "@/components/documents/guest-file"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { cn } from "@/lib/utils"
import { findGuestDocument } from "@/services/document-service"
import { getGeneratedDocumentSigningView } from "@/services/document-signing-service"
import { getSheet, isSheetDocument, type Sheet } from "@/services/sheet-service"
import { withTemplateImageUrls } from "@/services/template-image-service"
import type { GeneratedDocumentSigningView } from "@/types/signing"

type PageContext = NonNullable<Awaited<ReturnType<typeof loadPageOrganizationContext>>["context"]>

type PageUser = Awaited<ReturnType<typeof loadAuthenticatedPageUser>>

type Opened = {
  backHref: string
  /** Null for someone outside the workspace who was given this one document. */
  context: PageContext | null
  user: PageUser
}

export type LoadedDocumentPage =
  | { failure: ReactElement }
  | (Opened & { view: GeneratedDocumentSigningView })
  | (Opened & { sheet: Sheet })

/**
 * Loads a generated document for the editor or its preview, once the member
 * or guest may see it, with picture addresses they can load.
 *
 * @param documentId - The document to open.
 * @param path - Where sign-in returns to.
 * @returns The document and who is opening it, or what to show instead.
 */
export async function loadDocumentPage(documentId: string, path: string): Promise<LoadedDocumentPage> {
  const user = await loadAuthenticatedPageUser(path)
  // A link to this one document opens it in its own workspace, whichever one
  // the person usually works in.
  const guestResult = await findGuestDocument({ documentId, userId: user.id }).then(
    (guest) => ({ guest }),
    (error: unknown) => ({ errorMessage: getPageErrorMessage(error, "Unable to load generated document.") })
  )

  if ("errorMessage" in guestResult) {
    return { failure: <Unavailable message={guestResult.errorMessage} title="Generated document unavailable" /> }
  }

  const { guest } = guestResult

  if (guest?.sourceKind === "upload") {
    return { failure: <GuestFile documentId={documentId} guest={guest} /> }
  }

  if (guest) {
    const opening = { context: null, documentId, organizationId: guest.organizationId, user }

    return guest.sourceKind === "sheet" ? loadSheet(opening) : loadView(opening)
  }

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

  const opening = { context: contextResult.context, documentId, organizationId: contextResult.context.organization.id, user }

  // A sheet opens in the grid; a lookup that fails falls through to the document, which reports it.
  return (await isSheetDocument(opening).catch(() => false)) ? loadSheet(opening) : loadView(opening)
}

type Opening = {
  context: PageContext | null
  documentId: string
  organizationId: string
  user: PageUser
}

async function loadSheet({ context, documentId, organizationId, user }: Opening): Promise<LoadedDocumentPage> {
  try {
    const sheet = await getSheet({ actorUserId: user.id, organizationId, documentId })

    return { backHref: backTo(context, sheet.folderId), context, sheet, user }
  } catch (error: unknown) {
    return { failure: <Unavailable message={getPageErrorMessage(error, "Unable to load the sheet.")} title="Sheet unavailable" /> }
  }
}

function backTo(context: PageContext | null, folderId: string | null): string {
  return !context ? "/shared" : folderId ? `/documents?folderId=${encodeURIComponent(folderId)}` : "/documents"
}

async function loadView({ context, documentId, organizationId, user }: Opening): Promise<LoadedDocumentPage> {
  const viewResult = await getGeneratedDocumentSigningView({
    actorUserId: user.id,
    organizationId,
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
        organizationId,
        reason: errorMessage,
        userId: user.id,
      })
      return { view: null, errorMessage }
    })

  if (!viewResult.view) {
    return { failure: <Unavailable message={viewResult.errorMessage} title="Generated document unavailable" /> }
  }

  return {
    backHref: backTo(context, viewResult.view.document.folderId),
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
