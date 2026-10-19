import type { Metadata } from "next"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { DocumentOpenTracker } from "@/components/documents/document-open-tracker"
import { DocumentPreview } from "@/components/documents/document-preview"
import { canEditDocument, canSendDocument, canShareResource } from "@/lib/permissions"

import { loadDocumentPage } from "../load-document-page"

export const metadata: Metadata = { title: "Document" }

/**
 * Opens a generated document to look at and try, without changing it. Back
 * to editing is offered to those who may change it while it is still in use.
 *
 * @param props - Route document identifier.
 * @returns The preview, or a short way back when it cannot open.
 */
export default async function DocumentPreviewPage({
  params,
}: {
  params: Promise<{ documentId: string }>
}): Promise<ReactElement> {
  const { documentId } = await params
  const loaded = await loadDocumentPage(documentId, `/documents/${encodeURIComponent(documentId)}/preview`)

  if ("failure" in loaded) {
    return loaded.failure
  }

  // A sheet has no preview: its grid is read-only for whoever may not change it.
  if ("sheet" in loaded) {
    redirect(`/documents/${encodeURIComponent(documentId)}/edit`)
  }

  const { backHref, context, view } = loaded

  // Someone outside the workspace reads it and saves a copy, and an Editor may edit it.
  if (!context) {
    return (
      <DocumentPreview
        backHref={backHref}
        backLabel="Shared with you"
        canEdit={canEditDocument(null, { accessLevel: view.accessLevel, lifecycleState: view.document.lifecycleState })}
        canSendToAnswer={false}
        canShare={false}
        view={view}
      />
    )
  }

  const canEdit = canEditDocument(context.membership, { accessLevel: view.accessLevel, lifecycleState: view.document.lifecycleState })

  return (
    <>
      <DocumentOpenTracker documentId={view.document.id} organizationId={context.organization.id} />
      <DocumentPreview
        backHref={backHref}
        canEdit={canEdit}
        canSendToAnswer={view.document.templateId !== null && canSendDocument(context.membership, { accessLevel: view.accessLevel, lifecycleState: view.document.lifecycleState })}
        canShare={canShareResource(context.membership, { accessLevel: view.accessLevel, lifecycleState: view.document.lifecycleState })}
        view={view}
      />
    </>
  )
}
