import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { DocumentEditor } from "@/components/documents/document-editor"
import { DocumentOpenTracker } from "@/components/documents/document-open-tracker"
import { SheetEditor } from "@/components/sheets/sheet-editor"
import { getFallbackDisplayName } from "@/lib/display-name"
import { loadMemberName } from "@/lib/page-member-name"
import { canEditDocument, canPerformOrganizationAction, canSendDocument, canShareResource } from "@/lib/permissions"
import { readPersonName } from "@/services/document-service"
import { getEditorLayout } from "@/services/organizations/editor-layout-service"
import type { EditorLayout } from "@/types/editor-layout"
import { saveEditorLayoutAction } from "@/app/(editor)/editor-layout-actions"

import { loadDocumentPage } from "../load-document-page"
import {
  cancelDocumentSigningAction,
  copyDocumentAction,
  fillDocumentAnswersAction,
  resendGeneratedDocumentInvitationAction,
  saveDocumentAnswersAction,
  saveDocumentContentAction,
  sendGeneratedDocumentAction,
} from "./actions"
import { saveSheetAction } from "./sheet-actions"
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
  searchParams,
}: {
  params: GeneratedDocumentEditorParams
  searchParams: Promise<{ new?: string | string[] }>
}): Promise<ReactElement> {
  const { documentId } = await params
  // Set by New on a blank document it just made.
  const startTyping = (await searchParams).new === "1"
  const loaded = await loadDocumentPage(documentId, `/documents/${encodeURIComponent(documentId)}/edit`)

  if ("failure" in loaded) {
    return loaded.failure
  }

  // A sheet opens in its grid, read-only for whoever may not change it.
  if ("sheet" in loaded) {
    const { backHref, context, sheet } = loaded
    const item = { accessLevel: sheet.accessLevel, lifecycleState: sheet.lifecycleState }

    return (
      <>
        {context ? <DocumentOpenTracker documentId={sheet.id} organizationId={context.organization.id} /> : null}
        <SheetEditor
          backHref={backHref}
          canEdit={canEditDocument(context?.membership ?? null, item)}
          canShare={context ? canShareResource(context.membership, item) : false}
          guest={!context}
          organizationId={context?.organization.id ?? null}
          saveAction={saveSheetAction}
          sheet={sheet}
        />
      </>
    )
  }

  const { backHref, context, user, view } = loaded
  const canFill = canEditDocument(context?.membership ?? null, { accessLevel: view.accessLevel, lifecycleState: view.document.lifecycleState })

  // Whoever may not change it reads its preview. An Editor still opens a
  // completed document here, where it is read-only with its export at hand.
  if (!canFill) {
    redirect(`/documents/${encodeURIComponent(documentId)}/preview`)
  }

  // Someone outside the workspace never sends or shares it.
  if (!context) {
    const [guestLayout, guestName] = await Promise.all([
      loadEditorLayout(user.id),
      readPersonName(user.id).catch(() => null),
    ])

    return (
      <DocumentEditor
        backHref={backHref}
        canCopy={false}
        cancelSigningAction={cancelDocumentSigningAction}
        canFill={canFill}
        canSend={false}
        canShare={false}
        copyAction={copyDocumentAction}
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
        canCopy={canPerformOrganizationAction(context.membership, "documents:create")}
        cancelSigningAction={cancelDocumentSigningAction}
        canFill={canFill}
        canSend={canSend}
        canShare={canShare}
        copyAction={copyDocumentAction}
        editorLayout={{ initial: editorLayout, save: saveEditorLayoutAction }}
        me={{ id: user.id, name }}
        resendAction={resendGeneratedDocumentInvitationAction}
        fillAnswersAction={fillDocumentAnswersAction}
        saveAnswersAction={saveDocumentAnswersAction}
        saveContentAction={saveDocumentContentAction}
        sendAction={sendGeneratedDocumentAction}
        startTyping={startTyping}
        view={view}
      />
    </>
  )
}

function loadEditorLayout(actorUserId: string): Promise<EditorLayout> {
  return getEditorLayout({ actorUserId }).catch((): EditorLayout => ({}))
}
