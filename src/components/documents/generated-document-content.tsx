import Image from "next/image"
import type { CSSProperties, ReactElement, ReactNode } from "react"

import { DrawnSignatureField } from "@/components/documents/drawn-signature-field"
import {
  isStaticTemplateBlock,
  TemplateStaticBlock,
} from "@/components/templates/template-static-block"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  IMAGE_DATA_URL_PATTERN,
  MAX_IMAGE_DATA_URL_LENGTH,
  type TemplateBlock,
  type TemplateContent,
} from "@/types/template"

import { getGeneratedDocumentAnswerName } from "./generated-document-form-data"

type GeneratedDocumentContentProps = {
  answers: Record<string, unknown>
  content: TemplateContent
  editable: boolean
  recipientSigning?: boolean
  recipientSigned?: boolean
}

/**
 * Renders all snapshot regions and block types as editable or read-only content.
 *
 * @param props - Immutable snapshot, shared answers, and interaction mode.
 * @returns A paper-like generated document suitable for member and public forms.
 */
export function GeneratedDocumentContent({
  answers,
  content,
  editable,
  recipientSigning = false,
  recipientSigned = false,
}: GeneratedDocumentContentProps): ReactElement {
  const paperStyle = {
    "--document-accent": content.branding.accentColor,
    "--document-primary": content.branding.primaryColor,
  } as CSSProperties

  return (
    <article
      aria-label="Generated document content"
      className="mx-auto flex min-h-[48rem] w-full max-w-[50rem] flex-col overflow-hidden rounded-sm border bg-white text-slate-900 shadow-sm"
      style={paperStyle}
    >
      {(content.branding.logoDataUrl || content.branding.organizationName) && (
        <div className="flex items-center gap-4 border-b border-slate-200 px-8 py-5 sm:px-12">
          {content.branding.logoDataUrl && (
            <Image
              alt={`${content.branding.organizationName || "Organization"} logo`}
              className="max-h-12 w-auto max-w-36 object-contain"
              height={48}
              src={content.branding.logoDataUrl}
              unoptimized
              width={144}
            />
          )}
          {content.branding.organizationName && (
            <span
              className="text-sm font-semibold"
              style={{ color: "var(--document-primary)" }}
            >
              {content.branding.organizationName}
            </span>
          )}
        </div>
      )}

      <DocumentRegion
        answers={answers}
        blocks={content.sections.header.blocks}
        editable={editable}
        label="Header"
        recipientSigned={recipientSigned}
        recipientSigning={recipientSigning}
        repeat={content.repeat.header}
        variant="header"
      />
      <DocumentRegion
        answers={answers}
        blocks={content.sections.body.blocks}
        editable={editable}
        label="Body"
        recipientSigned={recipientSigned}
        recipientSigning={recipientSigning}
        variant="body"
      />
      <DocumentRegion
        answers={answers}
        blocks={content.sections.footer.blocks}
        editable={editable}
        label="Footer"
        recipientSigned={recipientSigned}
        recipientSigning={recipientSigning}
        repeat={content.repeat.footer}
        variant="footer"
      />
    </article>
  )
}

function DocumentRegion({
  answers,
  blocks,
  editable,
  label,
  recipientSigned,
  recipientSigning,
  repeat = false,
  variant,
}: {
  answers: Record<string, unknown>
  blocks: TemplateBlock[]
  editable: boolean
  label: string
  recipientSigned: boolean
  recipientSigning: boolean
  repeat?: boolean
  variant: "header" | "body" | "footer"
}): ReactElement {
  return (
    <section
      aria-label={`${label} section`}
      className={cn(
        "px-8 py-6 sm:px-12",
        variant === "body" && "min-h-[32rem] flex-1",
        variant === "header" && "border-b border-dashed border-slate-200",
        variant === "footer" && "border-t border-dashed border-slate-200"
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        <span>{label}</span>
        {variant !== "body" && repeat && (
          <Badge className="border-slate-200 text-slate-500" variant="outline">
            Repeats when printed
          </Badge>
        )}
      </div>

      {blocks.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-200 px-4 py-7 text-center text-xs text-slate-400">
          No {label.toLowerCase()} content
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {blocks.map((block: TemplateBlock) => (
            <GeneratedBlock
              answers={answers}
              block={block}
              editable={editable}
              key={block.id}
              recipientSigned={recipientSigned}
              recipientSigning={recipientSigning}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function GeneratedBlock({
  answers,
  block,
  editable,
  recipientSigned,
  recipientSigning,
}: {
  answers: Record<string, unknown>
  block: TemplateBlock
  editable: boolean
  recipientSigned: boolean
  recipientSigning: boolean
}): ReactElement {
  if (isStaticTemplateBlock(block)) {
    return (
      <TemplateStaticBlock
        accentColorVariable="var(--document-accent)"
        block={block}
        primaryColorVariable="var(--document-primary)"
      />
    )
  }

  switch (block.type) {
    case "text_field":
      return (
        <AnswerFieldFrame block={block} labelFor={editable ? block.id : undefined}>
          {editable ? (
            block.multiline ? (
              <textarea
                className="min-h-24 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-slate-500 focus-visible:ring-2 focus-visible:ring-slate-300"
                defaultValue={readStringAnswer(answers, block.fieldKey)}
                id={block.id}
                maxLength={20_000}
                name={getGeneratedDocumentAnswerName("text", block.fieldKey)}
                placeholder={block.placeholder ?? undefined}
              />
            ) : (
              <Input
                className="border-slate-300 bg-white dark:bg-white"
                defaultValue={readStringAnswer(answers, block.fieldKey)}
                id={block.id}
                maxLength={20_000}
                name={getGeneratedDocumentAnswerName("text", block.fieldKey)}
                placeholder={block.placeholder ?? undefined}
              />
            )
          ) : (
            <ReadOnlyAnswer value={readStringAnswer(answers, block.fieldKey)} />
          )}
        </AnswerFieldFrame>
      )
    case "date_field":
      return (
        <AnswerFieldFrame block={block} labelFor={editable ? block.id : undefined}>
          {editable ? (
            <Input
              className="border-slate-300 bg-white dark:bg-white"
              defaultValue={readStringAnswer(answers, block.fieldKey)}
              id={block.id}
              name={getGeneratedDocumentAnswerName("text", block.fieldKey)}
              type="date"
            />
          ) : (
            <ReadOnlyAnswer value={readStringAnswer(answers, block.fieldKey)} />
          )}
        </AnswerFieldFrame>
      )
    case "checkbox_field": {
      const answerName = getGeneratedDocumentAnswerName("boolean", block.fieldKey)

      return (
        <AnswerFieldFrame block={block} hideLabel>
          {editable ? (
            <label className="flex items-start gap-3 text-sm" htmlFor={block.id}>
              <input name={answerName} type="hidden" value="false" />
              <input
                className="mt-0.5 size-4 accent-slate-900"
                defaultChecked={readBooleanAnswer(answers, block.fieldKey)}
                id={block.id}
                name={answerName}
                type="checkbox"
                value="true"
              />
              <span>
                {block.label}
                {block.required && <span className="ml-1 text-red-600">*</span>}
              </span>
            </label>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className="flex size-4 items-center justify-center rounded-sm border border-slate-400 text-[10px]"
              >
                {readBooleanAnswer(answers, block.fieldKey) ? "✓" : ""}
              </span>
              {block.label}
            </div>
          )}
        </AnswerFieldFrame>
      )
    }
    case "dropdown_field":
      return (
        <AnswerFieldFrame block={block} labelFor={editable ? block.id : undefined}>
          {editable ? (
            <select
              className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-sm outline-none focus-visible:border-slate-500 focus-visible:ring-2 focus-visible:ring-slate-300"
              defaultValue={readStringAnswer(answers, block.fieldKey)}
              id={block.id}
              name={getGeneratedDocumentAnswerName("text", block.fieldKey)}
            >
              <option value="">{block.placeholder || "Select an option"}</option>
              {block.options.map((option: string) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <ReadOnlyAnswer value={readStringAnswer(answers, block.fieldKey)} />
          )}
        </AnswerFieldFrame>
      )
    case "signature_field":
    case "initials_field": {
      const existingValue = readStringAnswer(answers, block.fieldKey)
      const drawingLabel =
        block.type === "signature_field" ? "signature" : "initials"

      if (recipientSigning) {
        return (
          <AnswerFieldFrame block={block}>
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
              {recipientSigned
                ? `${drawingLabel === "signature" ? "Signature" : "Initials"} recorded.`
                : `${drawingLabel === "signature" ? "Signature" : "Initials"} will be captured in the signing acknowledgement below.`}
            </div>
          </AnswerFieldFrame>
        )
      }

      return (
        <AnswerFieldFrame block={block} hideLabel={editable}>
          {existingValue && <DrawingPreview label={block.label} value={existingValue} />}
          {editable && (
            <DrawnSignatureField
              description={
                existingValue
                  ? `Draw new ${drawingLabel} only if you want to replace the saved one.`
                  : block.helpText ?? undefined
              }
              label={existingValue ? `Replace ${block.label}` : block.label}
              name={getGeneratedDocumentAnswerName("drawing", block.fieldKey)}
            />
          )}
          {!editable && !existingValue && <ReadOnlyAnswer value="" />}
        </AnswerFieldFrame>
      )
    }
  }
}

function AnswerFieldFrame({
  block,
  children,
  hideLabel = false,
  labelFor,
}: {
  block: Extract<TemplateBlock, { fieldKey: string }>
  children: ReactNode
  hideLabel?: boolean
  labelFor?: string
}): ReactElement {
  const labelContent = (
    <>
      {block.label}
      {block.required && <span className="ml-1 text-red-600">*</span>}
    </>
  )

  return (
    <div className="flex flex-col gap-2">
      {!hideLabel &&
        (labelFor ? (
          <label className="text-xs font-semibold text-slate-700" htmlFor={labelFor}>
            {labelContent}
          </label>
        ) : (
          <span className="text-xs font-semibold text-slate-700">
            {labelContent}
          </span>
        ))}
      {children}
      {block.helpText && (
        <p className="text-xs leading-5 text-slate-500">{block.helpText}</p>
      )}
    </div>
  )
}

function ReadOnlyAnswer({ value }: { value: string }): ReactElement {
  return (
    <div className="min-h-9 whitespace-pre-wrap rounded-sm border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
      {value || <span className="text-slate-400">Not completed</span>}
    </div>
  )
}

function DrawingPreview({
  label,
  value,
}: {
  label: string
  value: string
}): ReactElement {
  if (
    value.length > MAX_IMAGE_DATA_URL_LENGTH ||
    !IMAGE_DATA_URL_PATTERN.test(value)
  ) {
    return <ReadOnlyAnswer value="Drawing recorded" />
  }

  return (
    <div className="rounded-lg border border-slate-300 bg-white p-3">
      <Image
        alt={`Saved ${label}`}
        className="h-24 w-auto max-w-full object-contain"
        height={96}
        src={value}
        unoptimized
        width={400}
      />
    </div>
  )
}

function readStringAnswer(
  answers: Record<string, unknown>,
  fieldKey: string
): string {
  const value = answers[fieldKey]
  return typeof value === "string" ? value : ""
}

function readBooleanAnswer(
  answers: Record<string, unknown>,
  fieldKey: string
): boolean {
  return answers[fieldKey] === true
}
