"use client"

import Image from "next/image"
import {
  type ChangeEvent,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useState
} from "react"

import { DrawnSignatureField } from "@/components/documents/drawn-signature-field"
import {
  isStaticTemplateBlock,
  TemplateStaticBlock
} from "@/components/templates/template-static-block"
import {
  groupTemplateRenderBlocks,
  type TemplateWebRenderGroup
} from "@/components/templates/template-render-groups"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { formatDateAnswer } from "@/lib/date-format"
import { resolveDocumentSurfaceInk } from "@/lib/document-surface"
import { cn } from "@/lib/utils"
import {
  createTemplateRenderPlan,
  shouldRenderTemplateFooter,
  shouldRenderTemplateHeader,
  type TemplateRenderBlock,
  type TemplateRenderPlan,
  type TemplateRenderSection
} from "@/services/templates/template-render-plan"
import {
  IMAGE_DATA_URL_PATTERN,
  MAX_IMAGE_DATA_URL_LENGTH,
  type TemplateBlock,
  type TemplateBranding,
  type TemplateContent,
  type TemplateLayout
} from "@/types/template"
import {
  applyVisibleTemplateFieldValue,
  pruneHiddenTemplateFieldValues
} from "@/types/template-visibility"

import { getGeneratedDocumentAnswerName } from "./generated-document-form-data"
import { imageSource } from "@/types/template-images"

/**
 * Hands answer ownership to the caller so it survives this component's mount.
 *
 * Supplying a control makes the component fully controlled: it renders exactly
 * the answers it is given and reports every edit instead of storing one.
 */
export type GeneratedDocumentAnswerControl = Readonly<{
  answers: Record<string, unknown>
  onChange: (answers: Record<string, unknown>) => void
}>

type GeneratedDocumentContentProps = {
  /** Present when the caller owns answer state across mounts. */
  answerControl?: GeneratedDocumentAnswerControl
  /** Seed answers for the uncontrolled component. Ignored beside `answerControl`. */
  answers?: Record<string, unknown>
  content: TemplateContent
  editable: boolean
  fileFieldContent?: Readonly<Record<string, ReactNode>>
  onAnswersChange?: (answers: Record<string, unknown>) => void
  recipientSigning?: boolean
  recipientSigned?: boolean
  title?: string
}

/**
 * Renders all snapshot regions and block types as editable or read-only content.
 *
 * @param props - Immutable snapshot, shared answers, and interaction mode.
 * @returns A paper-like generated document suitable for member and public forms.
 */
export function GeneratedDocumentContent({
  answerControl,
  answers = {},
  content,
  editable,
  fileFieldContent = {},
  onAnswersChange,
  recipientSigning = false,
  recipientSigned = false,
  title
}: GeneratedDocumentContentProps): ReactElement {
  // Server-rendered call sites post answers through FormData and cannot own
  // React state, so the uncontrolled path stays the default.
  const [uncontrolledAnswers, setUncontrolledAnswers] =
    useState<Record<string, unknown>>(() =>
      pruneHiddenTemplateFieldValues(content, answers)
    )
  const ownedAnswers = answerControl?.answers
  const currentAnswers = useMemo((): Record<string, unknown> => {
    if (!ownedAnswers) {
      return uncontrolledAnswers
    }

    const visibleAnswers = pruneHiddenTemplateFieldValues(content, ownedAnswers)

    // Pruning only ever drops keys, so an equal key count means an equal map.
    // Returning the caller's own object then keeps identity stable, which stops
    // an owner that also observes `onAnswersChange` from looping on two equal
    // objects.
    return Object.keys(visibleAnswers).length ===
      Object.keys(ownedAnswers).length
      ? ownedAnswers
      : visibleAnswers
  }, [content, ownedAnswers, uncontrolledAnswers])

  useEffect((): void => {
    onAnswersChange?.(currentAnswers)
  }, [currentAnswers, onAnswersChange])

  const renderPlan = useMemo(
    () =>
      createTemplateRenderPlan({
        title: title ?? "",
        content,
        answers: currentAnswers,
        mode: editable ? "test" : "final"
      }),
    [content, currentAnswers, editable, title]
  )

  function applyAnswer(fieldKey: string, value: unknown): void {
    if (answerControl) {
      answerControl.onChange(
        applyVisibleTemplateFieldValue(
          content,
          answerControl.answers,
          fieldKey,
          value
        )
      )
      return
    }

    setUncontrolledAnswers(
      (priorAnswers: Record<string, unknown>): Record<string, unknown> =>
        applyVisibleTemplateFieldValue(content, priorAnswers, fieldKey, value)
    )
  }
  // This component is only ever an editing or review surface: every caller
  // renders it inside the themed app, and none offers a print view. Fidelity
  // to the author's brand colours belongs to the Studio's Preview mode and to
  // the finalized PDF, both of which draw on real paper.
  const ink = resolveDocumentSurfaceInk("screen", renderPlan.branding)
  const paperStyle = {
    "--document-accent": ink.accent,
    "--document-primary": ink.primary,
    aspectRatio: `${renderPlan.geometry.widthPoints} / ${renderPlan.geometry.heightPoints}`
  } as CSSProperties
  // CSS percentage margins on every side resolve against container width.
  // Scaling points by page width therefore preserves one physical margin.
  const marginPercent =
    (renderPlan.geometry.marginPoints / renderPlan.geometry.widthPoints) * 100
  const printableAreaStyle = {
    margin: `${marginPercent}%`
  } as CSSProperties

  return (
    <article
      aria-label="Generated document content"
      className={cn(
        "mx-auto min-h-[34rem] w-full overflow-hidden rounded-sm border bg-card text-foreground shadow-sm",
        renderPlan.layout.orientation === "portrait"
          ? "max-w-[50rem]"
          : "max-w-[68rem]"
      )}
      data-template-density={renderPlan.layout.density}
      data-template-footer-policy={renderPlan.layout.footerPolicy}
      data-template-header-policy={renderPlan.layout.headerPolicy}
      data-template-orientation={renderPlan.layout.orientation}
      data-template-page-numbering={renderPlan.layout.pageNumbering}
      data-template-page-size={renderPlan.layout.pageSize}
      style={paperStyle}
    >
      <div
        className="min-h-[30rem] min-w-0"
        data-template-printable-area="true"
        style={printableAreaStyle}
      >
        {shouldRenderTemplateHeader(renderPlan.layout, 1) && (
          <GeneratedBrandHeader branding={renderPlan.branding} />
        )}

        {renderPlan.title.length > 0 && (
          <h2
            className="px-1 pt-7 font-editorial text-3xl font-semibold leading-tight"
            data-template-printed-title="true"
            style={{ color: "var(--document-primary)" }}
          >
            {renderPlan.title}
          </h2>
        )}

        <DocumentFlow
          answers={currentAnswers}
          editable={editable}
          fileFieldContent={fileFieldContent}
          renderPlan={renderPlan}
          onAnswerChange={applyAnswer}
          recipientSigned={recipientSigned}
          recipientSigning={recipientSigning}
        />
        {shouldRenderTemplateFooter(renderPlan.layout, 1) &&
          renderPlan.layout.pageNumbering === "page_x_of_y" && (
            <GeneratedPageFooter />
          )}
      </div>
    </article>
  )
}

function GeneratedBrandHeader({
  branding
}: {
  branding: TemplateBranding
}): ReactElement | null {
  const logo = imageSource(branding.logoAsset, branding.logoDataUrl)

  if (!logo && !branding.organizationName) {
    return null
  }

  return (
    <header
      className={cn(
        "flex min-w-0 flex-col gap-2 overflow-hidden border-b border-border px-1 pb-5",
        branding.logoAlignment === "left" && "items-start text-left",
        branding.logoAlignment === "center" && "items-center text-center",
        branding.logoAlignment === "right" && "items-end text-right"
      )}
      data-template-brand-header="true"
    >
      {logo && (
        <Image
          alt={`${branding.organizationName || "Organization"} logo`}
          className="h-auto max-h-16 object-contain"
          height={96}
          src={logo}
          style={{ width: `${branding.logoWidthPercent}%` }}
          unoptimized
          width={480}
        />
      )}
      {branding.organizationName && (
        <span
          className="text-sm font-semibold"
          style={{ color: "var(--document-primary)" }}
        >
          {branding.organizationName}
        </span>
      )}
    </header>
  )
}

function GeneratedPageFooter(): ReactElement {
  return (
    <footer
      className="border-t border-border pt-3 pb-1 text-right font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground"
      data-template-page-footer="true"
    >
      Page 1 of 1
    </footer>
  )
}

function DocumentFlow({
  answers,
  editable,
  fileFieldContent,
  onAnswerChange,
  renderPlan,
  recipientSigned,
  recipientSigning
}: {
  answers: Record<string, unknown>
  editable: boolean
  fileFieldContent: Readonly<Record<string, ReactNode>>
  onAnswerChange: (fieldKey: string, value: unknown) => void
  renderPlan: TemplateRenderPlan
  recipientSigned: boolean
  recipientSigning: boolean
}): ReactElement {
  return (
    <section
      aria-label="Document content"
      className={cn(
        "min-h-[24rem] min-w-0",
        renderPlan.layout.density === "compact" && "py-4",
        renderPlan.layout.density === "balanced" && "py-7",
        renderPlan.layout.density === "comfortable" && "py-10"
      )}
    >
      {renderPlan.blocks.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-7 text-center text-xs text-muted-foreground">
          This document has no content yet
        </div>
      ) : (
        <div
          className={cn(
            "flex min-w-0 flex-col",
            renderPlan.layout.density === "compact" && "gap-3",
            renderPlan.layout.density === "balanced" && "gap-5",
            renderPlan.layout.density === "comfortable" && "gap-7"
          )}
        >
          {renderPlan.sections.map(
            (section: TemplateRenderSection, index: number) => (
              <GeneratedSection
                answers={answers}
                density={renderPlan.layout.density}
                editable={editable}
                fileFieldContent={fileFieldContent}
                key={section.id ?? `implicit-section-${index}`}
                onAnswerChange={onAnswerChange}
                recipientSigned={recipientSigned}
                recipientSigning={recipientSigning}
                section={section}
              />
            )
          )}
        </div>
      )}
    </section>
  )
}

function GeneratedSection({
  answers,
  density,
  editable,
  fileFieldContent,
  onAnswerChange,
  recipientSigned,
  recipientSigning,
  section
}: {
  answers: Record<string, unknown>
  density: TemplateLayout["density"]
  editable: boolean
  fileFieldContent: Readonly<Record<string, ReactNode>>
  onAnswerChange: (fieldKey: string, value: unknown) => void
  recipientSigned: boolean
  recipientSigning: boolean
  section: TemplateRenderSection
}): ReactElement {
  const groups = groupTemplateRenderBlocks(section.blocks)

  return (
    <section
      className={cn(
        "flex min-w-0 flex-col",
        density === "compact" && "gap-1.5",
        density === "balanced" && "gap-3",
        density === "comfortable" && "gap-5"
      )}
      data-keep-together={section.keepTogether ? "true" : undefined}
      data-page-break-before={section.pageBreakBefore ? "true" : undefined}
      data-template-section-id={section.id ?? "implicit"}
      style={getGeneratedPaginationStyle({
        keepTogether: section.keepTogether,
        pageBreakBefore: section.pageBreakBefore
      })}
    >
      {section.label && (
        <h2
          className="font-editorial text-xl font-semibold leading-tight"
          data-template-section-label="true"
          style={{ color: "var(--document-primary)" }}
        >
          {section.label}
        </h2>
      )}
      {groups.map((group: TemplateWebRenderGroup, groupIndex: number) => (
        <GeneratedFieldGroup
          answers={answers}
          density={density}
          editable={editable}
          fileFieldContent={fileFieldContent}
          group={group}
          isFirstInSection={groupIndex === 0}
          key={group.id ?? `ungrouped-${group.blocks[0]?.block.id}`}
          onAnswerChange={onAnswerChange}
          recipientSigned={recipientSigned}
          recipientSigning={recipientSigning}
          sectionBreaksBefore={section.pageBreakBefore}
        />
      ))}
    </section>
  )
}

function GeneratedFieldGroup({
  answers,
  density,
  editable,
  fileFieldContent,
  group,
  isFirstInSection,
  onAnswerChange,
  recipientSigned,
  recipientSigning,
  sectionBreaksBefore
}: {
  answers: Record<string, unknown>
  density: TemplateLayout["density"]
  editable: boolean
  fileFieldContent: Readonly<Record<string, ReactNode>>
  group: TemplateWebRenderGroup
  isFirstInSection: boolean
  onAnswerChange: (fieldKey: string, value: unknown) => void
  recipientSigned: boolean
  recipientSigning: boolean
  sectionBreaksBefore: boolean
}): ReactElement {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col",
        density === "compact" && "gap-1.5",
        density === "balanced" && "gap-3",
        density === "comfortable" && "gap-5"
      )}
      data-keep-together={group.keepTogether ? "true" : undefined}
      data-template-field-group-columns={group.columns}
      data-template-field-group-id={group.id ?? "ungrouped"}
      style={getGeneratedPaginationStyle({
        keepTogether: group.keepTogether
      })}
    >
      {group.label && (
        <h3
          className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground"
          data-template-field-group-label="true"
        >
          {group.label}
        </h3>
      )}
      <div
        className={cn(
          "grid min-w-0",
          group.columns === 1
            ? "grid-cols-1"
            : "grid-cols-1 sm:grid-cols-[repeat(2,minmax(0,1fr))]",
          density === "compact" && "gap-1.5",
          density === "balanced" && "gap-3",
          density === "comfortable" && "gap-5"
        )}
      >
        {group.blocks.map(
          (renderBlock: TemplateRenderBlock, blockIndex: number) => (
            <div
              data-keep-with-next={
                renderBlock.keepWithNext ? "true" : undefined
              }
              data-page-break-before={
                renderBlock.pageBreakBefore ? "true" : undefined
              }
              data-template-block-id={renderBlock.block.id}
              key={renderBlock.block.id}
              style={getGeneratedPaginationStyle({
                keepWithNext: renderBlock.keepWithNext,
                pageBreakBefore:
                  renderBlock.pageBreakBefore &&
                  !(
                    sectionBreaksBefore &&
                    isFirstInSection &&
                    blockIndex === 0
                  )
              })}
            >
              <GeneratedBlock
                answers={answers}
                block={renderBlock.block}
                editable={editable}
                fileFieldContent={fileFieldContent}
                onAnswerChange={onAnswerChange}
                recipientSigned={recipientSigned}
                recipientSigning={recipientSigning}
              />
            </div>
          )
        )}
      </div>
    </section>
  )
}

function getGeneratedPaginationStyle({
  keepTogether = false,
  keepWithNext = false,
  pageBreakBefore = false
}: {
  keepTogether?: boolean
  keepWithNext?: boolean
  pageBreakBefore?: boolean
}): CSSProperties {
  return {
    ...(pageBreakBefore
      ? { breakBefore: "page", pageBreakBefore: "always" }
      : {}),
    ...(keepTogether
      ? { breakInside: "avoid-page", pageBreakInside: "avoid" }
      : {}),
    ...(keepWithNext
      ? { breakAfter: "avoid-page", pageBreakAfter: "avoid" }
      : {})
  }
}

/**
 * Renders one block of a generated document: static content as printed, and
 * each field as its answer control, or its saved answer when read only.
 *
 * @param props - The block, the answers, and whether it can be filled.
 * @returns The block.
 */
export function GeneratedBlock({
  answers,
  block,
  editable,
  fileFieldContent,
  onAnswerChange,
  recipientSigned,
  recipientSigning
}: {
  answers: Record<string, unknown>
  block: TemplateBlock
  editable: boolean
  fileFieldContent: Readonly<Record<string, ReactNode>>
  onAnswerChange: (fieldKey: string, value: unknown) => void
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
                id={block.id}
                maxLength={20_000}
                name={getGeneratedDocumentAnswerName("text", block.fieldKey)}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                  onAnswerChange(block.fieldKey, event.target.value)
                }
                placeholder={block.placeholder ?? undefined}
                value={readStringAnswer(answers, block.fieldKey)}
              />
            ) : (
              <Input
                className="border-input"
                id={block.id}
                maxLength={20_000}
                name={getGeneratedDocumentAnswerName("text", block.fieldKey)}
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  onAnswerChange(block.fieldKey, event.target.value)
                }
                placeholder={block.placeholder ?? undefined}
                value={readStringAnswer(answers, block.fieldKey)}
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
            <DatePicker
              format={block.dateFormat}
              id={block.id}
              name={getGeneratedDocumentAnswerName("text", block.fieldKey)}
              onChange={(value: string): void => onAnswerChange(block.fieldKey, value)}
              value={readStringAnswer(answers, block.fieldKey)}
            />
          ) : (
            <ReadOnlyAnswer value={formatDateAnswer(readStringAnswer(answers, block.fieldKey), block.dateFormat)} />
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
                checked={readBooleanAnswer(
                  answers,
                  block.fieldKey,
                  block.checkedByDefault
                )}
                id={block.id}
                name={answerName}
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  onAnswerChange(block.fieldKey, event.target.checked)
                }
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
            <Select
              id={block.id}
              name={getGeneratedDocumentAnswerName("text", block.fieldKey)}
              onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                onAnswerChange(block.fieldKey, event.target.value)
              }
              value={readStringAnswer(answers, block.fieldKey)}
            >
              <option value="">
                {block.placeholder || "Select an option"}
              </option>
              {block.options.map((option: string) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
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
              Uploads are only in submissions.
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
