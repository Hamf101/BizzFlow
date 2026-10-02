"use client"

import { Download, Pencil } from "lucide-react"
import Link from "next/link"
import { type ReactElement, useMemo, useState } from "react"

import { EditorCanvas } from "@/components/editor/editor-canvas"
import { EditorFrame, EditorNotice } from "@/components/editor/editor-frame"
import { useReadOnlyController } from "@/components/editor/read-only-controller"
import { ShareButton } from "@/components/sharing/share-button"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { resolvePageGeometry } from "@/services/templates/template-render-plan"
import type { GeneratedDocumentSigningView } from "@/types/signing"
import { upgradeV2TemplateContentToV3 } from "@/types/template"
import { applyVisibleTemplateFieldValue } from "@/types/template-visibility"

const ignore = (): void => undefined

/**
 * A document as the people filling it see it. Its fields can be tried, but
 * nothing typed here is kept; Edit opens it in the editor.
 *
 * @param props - The document, where Back goes and its name, and whether this person may edit or share it.
 * @returns The full-screen preview.
 */
export function DocumentPreview({
  backHref,
  backLabel = "Back to Files",
  canEdit,
  canShare,
  view,
}: {
  backHref: string
  backLabel?: string
  canEdit: boolean
  canShare: boolean
  view: GeneratedDocumentSigningView
}): ReactElement {
  const document = view.document
  const content = useMemo(() => upgradeV2TemplateContentToV3(document.templateSnapshot), [document.templateSnapshot])
  const controller = useReadOnlyController(content)
  const [answers, setAnswers] = useState<Record<string, unknown>>(view.answers)
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
        <EditorCanvas
          allowFiles={false}
          answers={answers}
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
      )}
    </EditorFrame>
  )
}
