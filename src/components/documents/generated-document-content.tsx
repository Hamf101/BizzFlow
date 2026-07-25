import Image from "next/image"
import type { CSSProperties, ReactElement, ReactNode } from "react"

import { DrawnSignatureField } from "@/components/documents/drawn-signature-field"
import {
  isStaticTemplateBlock,
  TemplateStaticBlock
} from "@/components/templates/template-static-block"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  IMAGE_DATA_URL_PATTERN,
  MAX_IMAGE_DATA_URL_LENGTH,
  type TemplateBlock,
  type TemplateContent
} from "@/types/template"

import { getGeneratedDocumentAnswerName } from "./generated-document-form-data"

type GeneratedDocumentContentProps = {
  answers: Record<string, unknown>
  content: TemplateContent
  editable: boolean
  fileFieldContent?: Readonly<Record<string, ReactNode>>
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
  fileFieldContent = {},
  recipientSigning = false,
  recipientSigned = false
}: GeneratedDocumentContentProps): ReactElement {
  const paperStyle = {
    "--document-accent": content.branding.accentColor,
    "--document-primary": content.branding.primaryColor
  } as CSSProperties

  return (
    <article
      aria-label="Generated document content"
      className="mx-auto min-h-[48rem] w-full max-w-[50rem] overflow-hidden rounded-sm border bg-card text-foreground shadow-sm"
      style={paperStyle}
    >
      <div className="mx-6 my-8 min-h-[42rem] min-w-0 overflow-hidden sm:mx-10">
        {(content.branding.logoDataUrl ||
          content.branding.organizationName) && (
          <div
            className={cn(
              "flex min-w-0 flex-col gap-2 overflow-hidden border-b border-border px-1 pb-5",
              content.branding.logoAlignment === "left" &&
                "items-start text-left",
              content.branding.logoAlignment === "center" &&
                "items-center text-center",
              content.branding.logoAlignment === "right" &&
                "items-end text-right"
            )}
          >
            {content.branding.logoDataUrl && (
              <Image
                alt={`${content.branding.organizationName || "Organization"} logo`}
                className="h-auto max-h-16 object-contain"
                height={96}
                src={content.branding.logoDataUrl}
                style={{ width: `${content.branding.logoWidthPercent}%` }}
                unoptimized
                width={480}
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

        <DocumentFlow
          answers={answers}
          blocks={content.blocks}
          editable={editable}
          fileFieldContent={fileFieldContent}
          recipientSigned={recipientSigned}
          recipientSigning={recipientSigning}
        />
      </div>
    </article>
  )
}

function DocumentFlow({
  answers,
  blocks,
  editable,
  fileFieldContent,
  recipientSigned,
  recipientSigning
}: {
  answers: Record<string, unknown>
  blocks: TemplateBlock[]
  editable: boolean
  fileFieldContent: Readonly<Record<string, ReactNode>>
  recipientSigned: boolean
  recipientSigning: boolean
}): ReactElement {
  return (
    <section
      aria-label="Document content"
      className="min-h-[32rem] min-w-0 overflow-hidden py-7"
    >
      {blocks.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-7 text-center text-xs text-muted-foreground">
          This document has no content yet
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {blocks.map((block: TemplateBlock) => (
            <GeneratedBlock
              answers={answers}
              block={block}
              editable={editable}
              fileFieldContent={fileFieldContent}
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
  fileFieldContent,
  recipientSigned,
  recipientSigning
}: {
  answers: Record<string, unknown>
  block: TemplateBlock
  editable: boolean
  fileFieldContent: Readonly<Record<string, ReactNode>>
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
        <AnswerFieldFrame
          block={block}
          labelFor={editable ? block.id : undefined}
        >
          {editable ? (
            block.multiline ? (
              <textarea
                className="min-h-24 w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                defaultValue={readStringAnswer(answers, block.fieldKey)}
                id={block.id}
                maxLength={20_000}
                name={getGeneratedDocumentAnswerName("text", block.fieldKey)}
                placeholder={block.placeholder ?? undefined}
              />
            ) : (
              <Input
                className="border-input"
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
        <AnswerFieldFrame
          block={block}
          labelFor={editable ? block.id : undefined}
        >
          {editable ? (
            <Input
              className="border-input"
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
      const answerName = getGeneratedDocumentAnswerName(
        "boolean",
        block.fieldKey
      )

      return (
        <AnswerFieldFrame block={block} hideLabel>
          {editable ? (
            <label
              className="flex items-start gap-3 text-sm"
              htmlFor={block.id}
            >
              <input name={answerName} type="hidden" value="false" />
              <input
                className="mt-0.5 size-4 accent-primary"
                defaultChecked={readBooleanAnswer(
                  answers,
                  block.fieldKey,
                  block.checkedByDefault
                )}
                id={block.id}
                name={answerName}
                type="checkbox"
                value="true"
              />
              <span>
                {block.label}
                {block.required && <span className="ml-1 text-destructive">*</span>}
              </span>
            </label>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className="flex size-4 items-center justify-center rounded-sm border border-muted-foreground/40 text-[10px]"
              >
                {readBooleanAnswer(
                  answers,
                  block.fieldKey,
                  block.checkedByDefault
                )
                  ? "✓"
                  : ""}
              </span>
              {block.label}
            </div>
          )}
        </AnswerFieldFrame>
      )
    }
    case "dropdown_field":
      return (
        <AnswerFieldFrame
          block={block}
          labelFor={editable ? block.id : undefined}
        >
          {editable ? (
            <select
              className="h-8 w-full rounded-lg border border-input bg-card px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              defaultValue={readStringAnswer(answers, block.fieldKey)}
              id={block.id}
              name={getGeneratedDocumentAnswerName("text", block.fieldKey)}
            >
              <option value="">
                {block.placeholder || "Select an option"}
              </option>
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
    case "file_field":
      return (
        <AnswerFieldFrame block={block}>
          {fileFieldContent[block.fieldKey] ?? (
            <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
              File uploads are available only in internal submissions.
            </div>
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
            <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
              {recipientSigned
                ? `${drawingLabel === "signature" ? "Signature" : "Initials"} recorded.`
                : `${drawingLabel === "signature" ? "Signature" : "Initials"} will be captured in the signing acknowledgement below.`}
            </div>
          </AnswerFieldFrame>
        )
      }

      return (
        <AnswerFieldFrame block={block} hideLabel={editable}>
          {existingValue && (
            <DrawingPreview label={block.label} value={existingValue} />
          )}
          {editable && (
            <DrawnSignatureField
              description={
                existingValue
                  ? `Draw new ${drawingLabel} only if you want to replace the saved one.`
                  : (block.helpText ?? undefined)
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
  labelFor
}: {
  block: Extract<TemplateBlock, { fieldKey: string }>
  children: ReactNode
  hideLabel?: boolean
  labelFor?: string
}): ReactElement {
  const labelContent = (
    <>
      {block.label}
      {block.required && <span className="ml-1 text-destructive">*</span>}
    </>
  )

  return (
    <div className="flex flex-col gap-2">
      {!hideLabel &&
        (labelFor ? (
          <label
            className="text-xs font-semibold text-foreground"
            htmlFor={labelFor}
          >
            {labelContent}
          </label>
        ) : (
          <span className="text-xs font-semibold text-foreground">
            {labelContent}
          </span>
        ))}
      {children}
      {block.helpText && (
        <p className="text-xs leading-5 text-muted-foreground">{block.helpText}</p>
      )}
    </div>
  )
}

function ReadOnlyAnswer({ value }: { value: string }): ReactElement {
  return (
    <div className="min-h-9 whitespace-pre-wrap rounded-sm border border-border bg-muted px-3 py-2 text-sm">
      {value || <span className="text-muted-foreground">Not completed</span>}
    </div>
  )
}

function DrawingPreview({
  label,
  value
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
    <div className="rounded-lg border border-border bg-white p-3">
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
  fieldKey: string,
  defaultValue: boolean
): boolean {
  return Object.prototype.hasOwnProperty.call(answers, fieldKey)
    ? answers[fieldKey] === true
    : defaultValue
}
