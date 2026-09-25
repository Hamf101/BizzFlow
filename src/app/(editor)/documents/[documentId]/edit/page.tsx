import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

import { DocumentEditor } from "@/components/documents/document-editor"
import { DocumentOpenTracker } from "@/components/documents/document-open-tracker"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { getGeneratedDocumentSigningView } from "@/services/document-signing-service"
import { getEditorLayout } from "@/services/editor-layout-service"
import { withTemplateImageOriginals } from "@/services/template-image-service"
import type { EditorLayout } from "@/types/editor-layout"
import type { GeneratedDocumentSigningView } from "@/types/signing"
import { saveEditorLayoutAction } from "@/app/(editor)/editor-layout-actions"

import {
  resendGeneratedDocumentInvitationAction,
  saveDocumentAnswersAction,
  saveDocumentContentAction,
  sendGeneratedDocumentAction,
} from "./actions"

type GeneratedDocumentEditorParams = Promise<{
  documentId: string
}>

/**
 * Opens a generated document in the editor canvas, with what the member may
 * write, fill in, and send.
 *
 * @param props - Route document identifier.
 * @returns The document editor, or a short way back when it cannot open.
 */
export default async function GeneratedDocumentEditorPage({
  params,
}: {
  params: GeneratedDocumentEditorParams
}): Promise<ReactElement> {
  const { documentId } = await params
  const editorPath = `/documents/${encodeURIComponent(documentId)}/edit`
  const user = await loadAuthenticatedPageUser(editorPath)
  const contextResult = await loadPageOrganizationContext({
    userId: user.id,
    failureEvent: "generated_document_editor_context_load_failed",
    failureDetails: { documentId },
  })

  if (!contextResult.context) {
    if (contextResult.errorMessage) {
      return (
        <GeneratedDocumentEditorShell>
          <Alert variant="destructive">
            <AlertTitle>Document editor unavailable</AlertTitle>
            <AlertDescription>{contextResult.errorMessage}</AlertDescription>
          </Alert>
        </GeneratedDocumentEditorShell>
      )
    }

    redirect(
      buildFeedbackRedirect("/dashboard", "organization_required")
    )
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
          templateSnapshot: await withTemplateImageOriginals(view.document.templateSnapshot, view.document.organizationId),
        },
      },
      errorMessage: null as string | null,
    }))
    .catch((error: unknown) => {
      const errorMessage = getPageErrorMessage(
        error,
        "Unable to load generated document."
      )

      console.warn("generated_document_editor_load_failed", {
        documentId,
        organizationId: context.organization.id,
        reason: errorMessage,
        userId: user.id,
      })
      return { view: null, errorMessage }
    })

  if (!viewResult.view) {
    return (
      <GeneratedDocumentEditorShell>
        <Alert variant="destructive">
          <AlertTitle>Generated document unavailable</AlertTitle>
          <AlertDescription>{viewResult.errorMessage}</AlertDescription>
        </Alert>
      </GeneratedDocumentEditorShell>
    )
  }

  const view = viewResult.view
  const canFill =
    canPerformOrganizationAction(context.membership, "documents:fill") &&
    view.accessLevel === "contributor" &&
    view.document.lifecycleState === "active"
  const canSend =
    canPerformOrganizationAction(context.membership, "documents:send") &&
    view.accessLevel === "contributor" &&
    view.document.lifecycleState === "active"
  // Where the tools were left; without it they start at home.
  const editorLayout = await getEditorLayout({ actorUserId: user.id }).catch((): EditorLayout => ({}))
  const backHref = view.document.folderId
    ? `/documents?folderId=${encodeURIComponent(view.document.folderId)}`
    : "/documents"

  return (
    <>
      <DocumentOpenTracker documentId={view.document.id} organizationId={context.organization.id} />
      <DocumentEditor
        backHref={backHref}
        canFill={canFill}
        canSend={canSend}
        editorLayout={{ initial: editorLayout, save: saveEditorLayoutAction }}
        resendAction={resendGeneratedDocumentInvitationAction}
        saveAnswersAction={saveDocumentAnswersAction}
        saveContentAction={saveDocumentContentAction}
        sendAction={sendGeneratedDocumentAction}
        view={view}
      />
    </>
  )
}

function GeneratedDocumentEditorShell({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-6">
      <div className="grid w-full max-w-md gap-4">
        {children}
        <Link className={cn(buttonVariants({ variant: "outline" }), "justify-self-start")} href="/documents">
          <ArrowLeft />
          Back to Files
        </Link>
      </div>
    </div>
  )
}
