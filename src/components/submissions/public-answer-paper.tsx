"use client"

import { type FormEvent, type ReactElement, useEffect, useMemo, useRef, useState } from "react"

import { parseGeneratedDocumentAnswers } from "@/components/documents/generated-document-form-data"
import { EditorCanvas, POINT_PX } from "@/components/editor/editor-canvas"
import { PaperAnswering, PaperSigning } from "@/components/editor/paper-field"
import { useReadOnlyController } from "@/components/editor/read-only-controller"
import { describeInvalidField } from "@/components/ui/toaster"
import { resolvePageGeometry } from "@/services/templates/template-render-plan"
import { answeringSigner } from "@/types/box-signers"
import type { TemplateBlock, TemplateContentV3 } from "@/types/template"
import { applyVisibleTemplateFieldValue } from "@/types/template-visibility"

import { PublicSubmissionFileField } from "./public-submission-file-field"
import { useMediaQuery } from "@/lib/use-media-query"

export type PublicFormInitialFile = Readonly<{
  fieldKey: string
  fileId: string
  originalFilename: string
}>

// The editor's own phone test: a narrow window, or a touch screen short of a laptop's.
const NARROW = "(width < 48rem), (pointer: coarse) and (width < 64rem)"

// What was typed before the page's code arrived, read from the boxes
// themselves, so the code takes over from it rather than from blank boxes.
function typedSoFar(token: string): Record<string, unknown> {
  const form = [...document.querySelectorAll<HTMLInputElement>('input[name="token"]')].find((input) => input.value === token)?.form

  try {
    return form ? parseGeneratedDocumentAnswers(new FormData(form)) : {}
  } catch {
    return {}
  }
}

// What the page shows before anyone answers: a checkbox's default answers it
// until it is changed, so what it shows is what is sent.
function startingAnswers(content: TemplateContentV3, initialAnswers: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return {
    ...Object.fromEntries(
      content.blocks.flatMap((block: TemplateBlock) => (block.type === "checkbox_field" ? [[block.fieldKey, block.checkedByDefault]] : []))
    ),
    ...initialAnswers,
  }
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

// The control an event came from, and the block it answers.
function answering(event: FormEvent<HTMLElement>): { blockId: string; control: Control } | null {
  const control = event.target

  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) {
    return null
  }

  const blockId = control.closest<HTMLElement>("[data-block-id]")?.dataset.blockId
  return blockId ? { blockId, control } : null
}

/**
 * The document someone was sent, drawn as the editor draws it, for them to
 * answer: they type into its boxes, upload into its file fields, and Submit.
 * Nothing they do changes the document.
 *
 * @param props - The frozen content, any answers and files from an earlier try, whether a phone asked, whose boxes they sign, and the link's token.
 * @returns The page of paper, inside the answering form.
 */
export function PublicAnswerPaper({
  content,
  initialAnswers,
  initialFiles,
  phone,
  signer = 1,
  title,
  token,
}: {
  content: TemplateContentV3
  initialAnswers: Readonly<Record<string, unknown>>
  initialFiles: readonly PublicFormInitialFile[]
  /** Whether the request came from a phone, so the first paint is already the phone's column. */
  phone: boolean
  /** Their place in the send, which says whose drawn boxes they sign; every other box shows what the sender put there. */
  signer?: number
  title: string
  token: string
}): ReactElement {
  const controller = useReadOnlyController(content)
  const signing = useMemo(() => ({ drawer: answeringSigner(content.blocks, signer), signers: [] }), [content.blocks, signer])
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => startingAnswers(content, initialAnswers))
  const [files, setFiles] = useState(initialFiles)
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const narrow = useMediaQuery(NARROW, phone)
  const frameRef = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(0)
  const geometry = resolvePageGeometry(content.layout)
  const zoom = narrow || available === 0 ? 1 : Math.min(1, Math.max(0.3, available / (geometry.widthPoints * geometry.scale * POINT_PX)))

  // Read once the page has taken over from the server's, so both drew the same first.
  // Only what differs from what the server drew was typed: a box still blank
  // here must not blank out what someone types before the next tick.
  useEffect(() => {
    const drawn = startingAnswers(content, initialAnswers)
    const typed = Object.entries(typedSoFar(token)).filter(([key, value]) => value !== (drawn[key] ?? ""))
    const timer = window.setTimeout(() => setAnswers((current) => ({ ...current, ...Object.fromEntries(typed) })), 0)

    return () => window.clearTimeout(timer)
  }, [content, initialAnswers, token])

  useEffect(() => {
    const element = frameRef.current

    if (!element) {
      return
    }

    const observer = new ResizeObserver(() => setAvailable(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // The browser refused a field: say why under it, tied to it, until it changes.
  function refuse(event: FormEvent<HTMLElement>): void {
    const found = answering(event)

    if (found) {
      found.control.setAttribute("aria-invalid", "true")
      found.control.setAttribute("aria-describedby", `${found.blockId}-error`)
      const message = describeInvalidField(found.control)
      setErrors((current) => ({ ...current, [found.blockId]: message }))
    }
  }

  function clear(event: FormEvent<HTMLElement>): void {
    const found = answering(event)

    if (found && found.blockId in errors) {
      found.control.removeAttribute("aria-invalid")
      found.control.removeAttribute("aria-describedby")
      setErrors((current) => Object.fromEntries(Object.entries(current).filter(([blockId]) => blockId !== found.blockId)))
    }
  }

  return (
    <div className="flex justify-center" onChangeCapture={clear} onInputCapture={clear} onInvalidCapture={refuse} ref={frameRef}>
      <PaperAnswering.Provider value={errors}>
        <PaperSigning.Provider value={signing}>
        <EditorCanvas
          allowFiles={false}
          answers={answers}
          controller={controller}
          designable={false}
          documentTitle={title}
          fields="fill"
          narrow={narrow}
          onAnswerChange={(fieldKey, value) => setAnswers((current) => applyVisibleTemplateFieldValue(content, current, fieldKey, value))}
          renderFileField={(block) => (
            <PublicSubmissionFileField
              answers={answers}
              block={block}
              initialFile={files.find((file) => file.fieldKey === block.fieldKey)}
              onFileChange={(file) =>
                setFiles((current) => [...current.filter((other) => other.fieldKey !== block.fieldKey), ...(file ? [{ fieldKey: block.fieldKey, ...file }] : [])])
              }
              onFilesCheckpointed={(active) => setFiles((current) => current.filter((file) => active.includes(file.fieldKey)))}
              token={token}
            />
          )}
          textEditable={false}
          zoom={zoom}
        />
        </PaperSigning.Provider>
      </PaperAnswering.Provider>
    </div>
  )
}
