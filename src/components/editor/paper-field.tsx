"use client"

import { Check } from "lucide-react"
import type { CSSProperties, ReactElement, ReactNode } from "react"

import { DrawnSignatureField } from "@/components/documents/drawn-signature-field"
import { getGeneratedDocumentAnswerName } from "@/components/documents/generated-document-form-data"
import { DatePicker } from "@/components/ui/date-picker"
import { Select } from "@/components/ui/select"
import { describeDateFormat, formatDateAnswer } from "@/lib/date-format"
import { cn } from "@/lib/utils"
import type { TemplateBlock } from "@/types/template"

type FieldBlock = Extract<TemplateBlock, { fieldKey: string }>

/**
 * Space the PDF leaves around a block, as CSS: its own points, plus what the
 * layout's spacing adds under every block, never below nothing.
 *
 * @param points - The block's own space, in points.
 * @param adjusted - Whether the layout's spacing applies; it does below a block, not above.
 * @returns A CSS length.
 */
export function printedSpace(points: number, adjusted = true): string {
  return adjusted ? `max(0px, calc(${points} * var(--doc-pt) + var(--doc-adjust, 0px)))` : `calc(${points} * var(--doc-pt))`
}

/** A heading prints in the page's face, not the app's, and without the app's tightened letters. */
export const PRINTED_HEADING: CSSProperties = { fontFamily: "inherit", letterSpacing: "normal" }

/** A section's title as it prints: 15 points bold on 22, with 10 points under it. */
export const SECTION_TITLE: CSSProperties = {
  ...PRINTED_HEADING,
  color: "var(--doc-primary)",
  fontSize: "1.5em",
  lineHeight: 22 / 15,
  marginBottom: printedSpace(10),
}

// The PDF's field, in ems of its 10-point text, so the page shows each field
// at the size and place it prints (see drawPdfLibField): a 9-point bold
// label, a box two lines tall (four when multi-line, 56 points for a
// signature) padded by 6 points, and 7-point help beneath.
const BOX_HEIGHT = { line: 3, lines: 6, drawing: 5.6 } as const
// The printed box's edge; a box is only its edge, so the page shows through.
const EDGE = "rgb(156 163 176)"
// A control inside a box is bare: the box is the field.
const BARE =
  "h-auto min-h-0 rounded-none border-0 bg-transparent p-0 text-[1em] leading-[1.5] shadow-none focus-visible:border-0 focus-visible:ring-0 data-popup-open:border-0 md:h-auto md:text-[1em]"

/**
 * A field as it prints: its label, and the box its answer is written in. The
 * author sees what each box will hold; someone filling it in types into the
 * box itself, and a finished document shows the answers.
 *
 * @param props - The field, how it is shown, the answers, and where a changed one goes.
 * @returns The field.
 */
export function PaperField({
  answers,
  block,
  mode,
  onAnswerChange,
}: {
  answers: Readonly<Record<string, unknown>>
  block: FieldBlock
  mode: "design" | "fill" | "read"
  onAnswerChange: (fieldKey: string, value: unknown) => void
}): ReactElement {
  const fill = mode === "fill"
  const value = answers[block.fieldKey]
  const text = typeof value === "string" ? value : ""
  const set = (next: unknown): void => onAnswerChange(block.fieldKey, next)
  const textName = getGeneratedDocumentAnswerName("text", block.fieldKey)
  const required = block.required ? <span className="text-destructive"> *</span> : null

  if (block.type === "checkbox_field") {
    const checked = value === undefined ? block.checkedByDefault : value === true
    const booleanName = getGeneratedDocumentAnswerName("boolean", block.fieldKey)

    return (
      <label className="relative block" htmlFor={fill ? block.id : undefined} style={{ lineHeight: 1.5, paddingLeft: "1.6em" }}>
        {fill ? (
          <>
            <input name={booleanName} type="hidden" value="false" />
            <input
              checked={checked}
              className="peer absolute top-[0.2em] left-0 size-[1em] cursor-pointer opacity-0"
              id={block.id}
              name={booleanName}
              onChange={(event) => set(event.target.checked)}
              type="checkbox"
              value="true"
            />
          </>
        ) : null}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-[0.2em] left-0 flex size-[1em] items-center justify-center peer-focus-visible:ring-2 peer-focus-visible:ring-ring/40"
          style={{ border: `0.07em solid ${EDGE}` }}
        >
          {checked && mode !== "design" ? <Check className="size-[0.85em]" strokeWidth={3} /> : null}
        </span>
        {block.label}
        {required}
        <Help block={block} inset="-1.6em" />
      </label>
    )
  }

  let answer: ReactNode
  let height: number = BOX_HEIGHT.line
  const placeholder = (words: string): ReactElement => <span className="text-muted-foreground">{words}</span>

  switch (block.type) {
    case "text_field":
      height = block.multiline ? BOX_HEIGHT.lines : BOX_HEIGHT.line
      answer = fill ? (
        block.multiline ? (
          <textarea
            className="w-full resize-none bg-transparent outline-none placeholder:text-muted-foreground"
            id={block.id}
            maxLength={20_000}
            name={textName}
            onChange={(event) => set(event.target.value)}
            placeholder={block.placeholder ?? undefined}
            // It grows with its answer, as the printed box does.
            style={{ fieldSizing: "content", minHeight: `${BOX_HEIGHT.lines - 1.2}em` }}
            value={text}
          />
        ) : (
          <input
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground"
            id={block.id}
            maxLength={20_000}
            name={textName}
            onChange={(event) => set(event.target.value)}
            placeholder={block.placeholder ?? undefined}
            value={text}
          />
        )
      ) : mode === "read" ? (
        <span className="whitespace-pre-wrap">{text}</span>
      ) : (
        placeholder(block.placeholder || "Text")
      )
      break
    case "date_field":
      answer = fill ? (
        <DatePicker className={BARE} format={block.dateFormat} id={block.id} name={textName} onChange={set} value={text} />
      ) : mode === "read" ? (
        formatDateAnswer(text, block.dateFormat)
      ) : (
        placeholder(describeDateFormat(block.dateFormat))
      )
      break
    case "dropdown_field":
      answer = fill ? (
        <Select className={BARE} id={block.id} name={textName} onChange={(event) => set(event.target.value)} value={text}>
          <option value="">{block.placeholder || "Select an option"}</option>
          {block.options.map((option: string) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      ) : mode === "read" ? (
        text
      ) : (
        placeholder(block.placeholder || "Choose an option")
      )
      break
    case "signature_field":
    case "initials_field":
      height = BOX_HEIGHT.drawing
      answer = fill ? (
        <DrawnSignatureField
          bare
          label={block.label}
          name={getGeneratedDocumentAnswerName("drawing", block.fieldKey)}
          saved={text}
        />
      ) : text ? (
        // eslint-disable-next-line @next/next/no-img-element -- a drawn data URL, already sized
        <img alt={`Saved ${block.label}`} className="doc-drawing max-h-[4.5em] max-w-[15em] object-contain object-left" src={text} />
      ) : mode === "design" ? (
        placeholder(block.type === "signature_field" ? "Sign here" : "Initials")
      ) : null
      break
    case "file_field":
      answer = placeholder(mode === "design" ? "Choose a file" : "Uploads are only in submissions.")
      break
  }

  const LabelTag = fill && block.type !== "signature_field" && block.type !== "initials_field" && block.type !== "file_field" ? "label" : "span"

  return (
    <div className="flex flex-col">
      <LabelTag className="font-bold" htmlFor={LabelTag === "label" ? block.id : undefined} style={{ fontSize: "0.9em", lineHeight: 13 / 9, marginBottom: "0.3em" }}>
        {block.label}
        {required}
      </LabelTag>
      <div
        className={cn("relative flex flex-col focus-within:ring-2 focus-within:ring-ring/40", fill && "cursor-text")}
        data-slot="paper-box"
        style={{ border: `0.07em solid ${EDGE}`, lineHeight: 1.5, minHeight: `${height}em`, padding: "0.6em" }}
      >
        {answer}
      </div>
      <Help block={block} />
    </div>
  )
}

// Help prints 3 points under its field, flush with the field's left edge;
// the gap is kept with no help too, as the PDF keeps it.
function Help({ block, inset }: { block: FieldBlock; inset?: string }): ReactElement {
  return (
    <span className="block text-muted-foreground" style={{ fontSize: "0.7em", lineHeight: 10 / 7, marginLeft: inset && `calc(${inset} / 0.7)`, marginTop: "calc(3 * var(--doc-pt))" }}>
      {block.helpText}
    </span>
  )
}
