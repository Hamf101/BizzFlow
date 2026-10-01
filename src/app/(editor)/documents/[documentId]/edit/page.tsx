import type { ReactElement } from "react"

import { DocumentEditor } from "@/components/documents/document-editor"
import { DocumentOpenTracker } from "@/components/documents/document-open-tracker"
import { loadMemberName } from "@/lib/page-member-name"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { getEditorLayout } from "@/services/editor-layout-service"
import type { EditorLayout } from "@/types/editor-layout"
import { saveEditorLayoutAction } from "@/app/(editor)/editor-layout-actions"

import { loadDocumentPage } from "../load-document-page"
import {
  resendGeneratedDocumentInvitationAction,
  saveDocumentAnswersAction,
  saveDocumentContentAction,
  sendGeneratedDocumentAction,
} from "./actions"
import type { Metadata } from "next"

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
export const metadata: Metadata = { title: "Document editor" }

export default async function GeneratedDocumentEditorPage({
  params,
}: {
  params: GeneratedDocumentEditorParams
}): Promise<ReactElement> {
  const { documentId } = await params
  const loaded = await loadDocumentPage(documentId, `/documents/${encodeURIComponent(documentId)}/edit`)

  if ("failure" in loaded) {
    return loaded.failure
  }

  const { backHref, context, user, view } = loaded
  const canFill =
    canPerformOrganizationAction(context.membership, "documents:fill") &&
    view.accessLevel === "contributor" &&
    view.document.lifecycleState === "active"
  const canSend =
    canPerformOrganizationAction(context.membership, "documents:send") &&
    view.accessLevel === "contributor" &&
    view.document.lifecycleState === "active"
  // Anyone who can edit it, and anyone who manages folders, may choose who else can open it.
  const canShare =
    view.document.lifecycleState === "active" &&
    (view.accessLevel === "contributor" || canPerformOrganizationAction(context.membership, "folders:manage"))
  // Where the tools were left; without it they start at home.
  const editorLayout = await getEditorLayout({ actorUserId: user.id }).catch((): EditorLayout => ({}))
  // How the others in the room see this person.
  const name = await loadMemberName(user, context.organization.id)

  return (
    <>
      <DocumentOpenTracker documentId={view.document.id} organizationId={context.organization.id} />
      <DocumentEditor
        backHref={backHref}
        canFill={canFill}
        canSend={canSend}
        canShare={canShare}
        editorLayout={{ initial: editorLayout, save: saveEditorLayoutAction }}
        me={{ id: user.id, name }}
        resendAction={resendGeneratedDocumentInvitationAction}
        saveAnswersAction={saveDocumentAnswersAction}
        saveContentAction={saveDocumentContentAction}
        sendAction={sendGeneratedDocumentAction}
        view={view}
      />
    </>
  )
}
