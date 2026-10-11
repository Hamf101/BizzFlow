import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { DocumentEditor } from "@/components/documents/document-editor"
import { DocumentOpenTracker } from "@/components/documents/document-open-tracker"
import { getFallbackDisplayName } from "@/lib/display-name"
import { loadMemberName } from "@/lib/page-member-name"
import { canPerformOrganizationAction, canSendDocument, canShareResource } from "@/lib/permissions"
import { readPersonName } from "@/services/document-service"
import { getEditorLayout } from "@/services/organizations/editor-layout-service"
import type { EditorLayout } from "@/types/editor-layout"
import { saveEditorLayoutAction } from "@/app/(editor)/editor-layout-actions"

import { loadDocumentPage } from "../load-document-page"
import {
  fillDocumentAnswersAction,
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

  // Someone outside the workspace edits only what they were given as an Editor,
  // and never sends or shares it.
  if (!context) {
    if (view.accessLevel !== "contributor") {
      redirect(`/documents/${encodeURIComponent(documentId)}/preview`)
    }

    const [guestLayout, guestName] = await Promise.all([
      loadEditorLayout(user.id),
      readPersonName(user.id).catch(() => null),
    ])

    return (
      <DocumentEditor
        backHref={backHref}
        canFill={view.document.lifecycleState === "active"}
        canSend={false}
        canShare={false}
        editorLayout={{ initial: guestLayout, save: saveEditorLayoutAction }}
        guest
        me={{ id: user.id, name: guestName ?? getFallbackDisplayName(user.email) }}
        resendAction={resendGeneratedDocumentInvitationAction}
        fillAnswersAction={fillDocumentAnswersAction}
        saveAnswersAction={saveDocumentAnswersAction}
        saveContentAction={saveDocumentContentAction}
        sendAction={sendGeneratedDocumentAction}
        view={view}
      />
    )
  }

  const canFill =
    canPerformOrganizationAction(context.membership, "documents:fill") &&
    view.accessLevel === "contributor" &&
    view.document.lifecycleState === "active"
  const canSend = canSendDocument(context.membership, { accessLevel: view.accessLevel, lifecycleState: view.document.lifecycleState })
  const canShare = canShareResource(context.membership, { accessLevel: view.accessLevel, lifecycleState: view.document.lifecycleState })
  // Where the tools were left (without it they start at home), and how the
  // others in the room see this person: independent, so read together.
  const [editorLayout, name] = await Promise.all([
    loadEditorLayout(user.id),
    loadMemberName(user, context.organization.id),
  ])

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
        fillAnswersAction={fillDocumentAnswersAction}
        saveAnswersAction={saveDocumentAnswersAction}
        saveContentAction={saveDocumentContentAction}
        sendAction={sendGeneratedDocumentAction}
        view={view}
      />
    </>
  )
}

function loadEditorLayout(actorUserId: string): Promise<EditorLayout> {
  return getEditorLayout({ actorUserId }).catch((): EditorLayout => ({}))
}
