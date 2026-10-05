"use client"

import { Download, Pencil, Send } from "lucide-react"
import Link from "next/link"
import { type ReactElement, useMemo, useState } from "react"

import { EditorCanvas } from "@/components/editor/editor-canvas"
import { EditorFrame, EditorNotice } from "@/components/editor/editor-frame"
import { PaperSigning } from "@/components/editor/paper-field"
import { useReadOnlyController } from "@/components/editor/read-only-controller"
import { SendToAnswerDialog } from "@/components/editor/lazy-panels"
import { ShareButton } from "@/components/sharing/share-button"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { resolvePageGeometry } from "@/services/templates/template-render-plan"
import { withBoxMarks } from "@/types/box-signers"
import type { GeneratedDocumentSigningView } from "@/types/signing"
import { upgradeV2TemplateContentToV3 } from "@/types/template"
import { applyVisibleTemplateFieldValue } from "@/types/template-visibility"

const ignore = (): void => undefined

/**
 * A document as the people filling it see it. Its fields can be tried, but
 * nothing typed here is kept; Edit opens it in the editor.
 *
 * @param props - The document, where Back goes and its name, and whether this person may edit, send or share it.
 * @returns The full-screen preview.
 */
export function DocumentPreview({
  backHref,
  backLabel = "Back to Files",
  canEdit,
  canSendToAnswer,
  canShare,
  view,
}: {
  backHref: string
  backLabel?: string
  canEdit: boolean
  canSendToAnswer: boolean
  canShare: boolean
  view: GeneratedDocumentSigningView
}): ReactElement {
  const document = view.document
  const content = useMemo(() => upgradeV2TemplateContentToV3(document.templateSnapshot), [document.templateSnapshot])
  const controller = useReadOnlyController(content)
  const [answers, setAnswers] = useState<Record<string, unknown>>(view.answers)
  // As in the editor: each drawn box is its signer's, and shows only their mark.
  const marked = useMemo(() => withBoxMarks(content.blocks, answers, view.recipients), [answers, content.blocks, view.recipients])
  const signing = useMemo(() => ({ sent: view.workflowStatus !== "draft" || view.recipients.length > 0, signers: view.recipients }), [view.recipients, view.workflowStatus])
  const [sending, setSending] = useState(false)
  const geometry = resolvePageGeometry(content.layout)
  const editHref = `/documents/${encodeURIComponent(document.id)}/edit`

  return (
    <EditorFrame
      backHref={backHref}
      backLabel={backLabel}
      banner={<EditorNotice actions={[]}>Preview · what you fill in here isn&apos;t saved</EditorNotice>}
      canRedo={false}
      canUndo={false}
      dock={() => null}
      menu={
        <>
          {canSendToAnswer ? (
            <Button aria-label="Send to answer" className="size-10 max-md:size-11" onClick={() => setSending(true)} size="icon" title="Send to answer" type="button" variant="ghost">
              <Send />
            </Button>
          ) : null}
          {sending ? (
            <SendToAnswerDialog name={document.title} onOpenChange={setSending} open source={{ documentId: document.id, kind: "document" }} />
          ) : null}
          {canShare ? <ShareButton iconOnly name={document.title} resource={{ id: document.id, kind: "document" }} /> : null}
          <a
            aria-label="Download PDF"
            className={cn(buttonVariants({ size: "icon", variant: "ghost" }), "size-10")}
            href={`/api/documents/${encodeURIComponent(document.id)}/pdf`}
            rel="noreferrer"
            target="_blank"
            title="Download PDF"
          >
            <Download />
          </a>
        </>
      }
      onRedo={ignore}
      onTitleChange={ignore}
      onUndo={ignore}
      pageWidthPoints={geometry.widthPoints * geometry.scale}
      primary={
        canEdit ? (
          <Link className={cn(buttonVariants(), "h-10 px-4")} href={editHref}>
            <Pencil />
            Edit
          </Link>
        ) : null
      }
      saveStatus={null}
      title={document.title}
      titleEditable={false}
    >
      {({ narrow, zoom }) => (
        <PaperSigning.Provider value={signing}>
          <EditorCanvas
            allowFiles={false}
            answers={marked}
            controller={controller}
            designable={false}
            documentTitle={document.title}
            fields="fill"
            narrow={narrow}
            onAnswerChange={(fieldKey, value) =>
              setAnswers((current) => applyVisibleTemplateFieldValue(content, current, fieldKey, value))
            }
            textEditable={false}
            zoom={zoom}
          />
        </PaperSigning.Provider>
      )}
    </EditorFrame>
  )
}
