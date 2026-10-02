"use client"

import {
  type ChangeEvent,
  type ComponentProps,
  type FormEvent,
  Fragment,
  lazy,
  type ReactElement,
  Suspense,
  useMemo,
  useState
} from "react"

import {
  isStaticTemplateBlock,
  TemplateStaticBlock
} from "@/components/templates/template-static-block"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { CheckboxChoices, RadioChoices } from "@/components/ui/radio-choices"
import { Select } from "@/components/ui/select"
import { describeInvalidField } from "@/components/ui/toaster"
import { TypedInput } from "@/components/ui/typed-input"
import {
  groupTemplateRenderBlocks,
  rowGridStyle,
  type TemplateWebRenderGroup
} from "@/components/templates/template-render-groups"
import {
  createTemplateRenderPlan,
  type TemplateRenderBlock
} from "@/services/templates/template-render-plan"
import type { TemplateBlock, TemplateContent } from "@/types/template"

import { PublicSubmissionFileField } from "./public-submission-file-field"

type PublicFormFieldsProps = Readonly<{
  content: TemplateContent
  initialAnswers?: Readonly<Record<string, unknown>>
  initialFiles?: readonly PublicFormInitialFile[]
  token: string
}>

export type PublicFormInitialFile = Readonly<{
  fieldKey: string
  fileId: string
  originalFilename: string
}>

type PublicFormFieldListProps = Readonly<{
  answers: Readonly<Record<string, unknown>>
  content: TemplateContent
  files?: readonly PublicFormInitialFile[]
  onFileChange?: (
    fieldKey: string,
    file: Omit<PublicFormInitialFile, "fieldKey"> | null
  ) => void
  onFilesCheckpointed?: (activeFieldKeys: readonly string[]) => void
  onAnswerChange: (fieldKey: string, value: unknown) => void
  token: string
}>

/**
 * Renders the answer-aware field list for a public submission form.
 *
 * @param props - Immutable template snapshot and public-link token.
 * @returns A client-side field list that reacts to checkbox and dropdown answers.
 */
export function PublicFormFields({
  content,
  initialAnswers = {},
  initialFiles = [],
  token
}: PublicFormFieldsProps): ReactElement {
  const [answers, setAnswers] = useState<Record<string, unknown>>(() =>
    createInitialPublicFormAnswers(content, initialAnswers)
  )
  const [files, setFiles] = useState<readonly PublicFormInitialFile[]>(
    initialFiles
  )

  return (
    <PublicFormFieldList
      answers={answers}
      content={content}
      files={files}
      onAnswerChange={(fieldKey: string, value: unknown): void =>
        setAnswers(
          (currentAnswers: Record<string, unknown>): Record<string, unknown> => ({
            ...currentAnswers,
            [fieldKey]: value
          })
        )
      }
      onFileChange={(
        fieldKey: string,
        file: Omit<PublicFormInitialFile, "fieldKey"> | null
      ): void =>
        setFiles((currentFiles: readonly PublicFormInitialFile[]) => [
          ...currentFiles.filter(
            (currentFile: PublicFormInitialFile): boolean =>
              currentFile.fieldKey !== fieldKey
          ),
          ...(file ? [{ fieldKey, ...file }] : [])
        ])
      }
      onFilesCheckpointed={(activeFieldKeys: readonly string[]): void =>
        setFiles((currentFiles: readonly PublicFormInitialFile[]) =>
          currentFiles.filter((file: PublicFormInitialFile): boolean =>
            activeFieldKeys.includes(file.fieldKey)
          )
        )
      }
      token={token}
    />
  )
}

/**
 * Projects public form fields from a supplied answer state.
 *
 * This stateless view keeps visibility deterministic and makes the same
 * browser projection available to focused rendering tests.
 *
 * @param props - Current scalar answers, template snapshot, callback, and token.
 * @returns Only blocks that are visible under the canonical render plan.
 */
export function PublicFormFieldList({
  answers,
  content,
  files = [],
  onAnswerChange,
  onFileChange = (): void => undefined,
  onFilesCheckpointed = (): void => undefined,
  token
}: PublicFormFieldListProps): ReactElement {
  const renderPlan = useMemo(
    () =>
      createTemplateRenderPlan({
        title: "",
        content,
        answers,
        mode: "test"
      }),
    [answers, content]
  )

  const groups = groupTemplateRenderBlocks(renderPlan.blocks)
  const renderField = ({ block }: TemplateRenderBlock): ReactElement => (
    <PublicFormFieldBlock
      answers={answers}
      block={block}
      initialFile={files.find(
        (file: PublicFormInitialFile): boolean =>
          "fieldKey" in block && file.fieldKey === block.fieldKey
      )}
      key={block.id}
      onAnswerChange={onAnswerChange}
      onFileChange={onFileChange}
      onFilesCheckpointed={onFilesCheckpointed}
      token={token}
    />
  )

  return (
    <>
      {groups.map((group: TemplateWebRenderGroup, index: number): ReactElement => {
        const first = group.blocks[0]
        const opensSection =
          first?.sectionLabel != null && first.sectionId !== groups[index - 1]?.blocks.at(-1)?.sectionId

        return (
          <Fragment key={group.id ?? first?.block.id ?? index}>
            {opensSection && (
              <h2 className="pt-2 text-base font-semibold">
                {/* Numbered as it prints, so words such as "see section B" hold. */}
                {first.sectionNumber ? `${first.sectionNumber} ` : null}
                {first.sectionLabel}
              </h2>
            )}
            {group.label && <h3 className="text-sm font-medium text-muted-foreground">{group.label}</h3>}
            {group.columns > 1 ? (
              // A row stacks on a phone and sits side by side, at its widths, from sm up.
              <div
                className="grid grid-cols-1 gap-4 sm:grid-cols-[var(--row-columns)]"
                data-public-form-row=""
                style={rowGridStyle(group)}
              >
                {group.blocks.map(renderField)}
              </div>
            ) : (
              group.blocks.map(renderField)
            )}
          </Fragment>
        )
      })}
    </>
  )
}

function PublicFormFieldBlock({
  answers,
  block,
  initialFile,
  onAnswerChange,
  onFileChange,
  onFilesCheckpointed,
  token
}: {
  answers: Readonly<Record<string, unknown>>
  block: TemplateBlock
  initialFile?: PublicFormInitialFile
  onAnswerChange: (fieldKey: string, value: unknown) => void
  onFileChange: (
    fieldKey: string,
    file: Omit<PublicFormInitialFile, "fieldKey"> | null
  ) => void
  onFilesCheckpointed: (activeFieldKeys: readonly string[]) => void
  token: string
}): ReactElement | null {
  if (isStaticTemplateBlock(block)) {
    return (
      <TemplateStaticBlock
        accentColorVariable="var(--template-accent)"
        block={block}
        primaryColorVariable="var(--template-primary)"
      />
    )
  }

  const fieldName = `field_${block.fieldKey}`

  switch (block.type) {
    case "file_field":
      return (
        <PublicSubmissionFileField
          answers={answers}
          block={block}
          initialFile={initialFile}
          onFileChange={(file) => onFileChange(block.fieldKey, file)}
          onFilesCheckpointed={onFilesCheckpointed}
          token={token}
        />
      )

    case "text_field":
      return (
        <ErrorField block={block} data-public-form-field-key={block.fieldKey}>
          <PublicFormFieldLabel block={block} />
          {block.multiline ? (
            <textarea
              className="min-h-24 w-full rounded-lg border border-input bg-background p-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
              id={block.id}
              name={fieldName}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                onAnswerChange(block.fieldKey, event.target.value)
              }
              placeholder={block.placeholder ?? ""}
              required={block.required}
              value={readStringAnswer(answers, block.fieldKey)}
            />
          ) : (
            <TypedInput
              block={block}
              id={block.id}
              name={fieldName}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                onAnswerChange(block.fieldKey, event.target.value)
              }
              placeholder={block.placeholder ?? ""}
              required={block.required}
              value={readStringAnswer(answers, block.fieldKey)}
            />
          )}
          <PublicFormFieldHelpText block={block} />
        </ErrorField>
      )

    case "date_field":
      return (
        <ErrorField block={block} data-public-form-field-key={block.fieldKey}>
          <PublicFormFieldLabel block={block} />
          <DatePicker
            format={block.dateFormat}
            id={block.id}
            name={fieldName}
            onChange={(value: string): void => onAnswerChange(block.fieldKey, value)}
            required={block.required}
            value={readStringAnswer(answers, block.fieldKey)}
          />
          <PublicFormFieldHelpText block={block} />
        </ErrorField>
      )

    case "checkbox_field":
      return (
        <ErrorField
          block={block}
          className="flex flex-row items-start gap-3 rounded-lg border p-3"
          data-public-form-field-key={block.fieldKey}
        >
          <input
            checked={readBooleanAnswer(
              answers,
              block.fieldKey,
              block.checkedByDefault
            )}
            className="mt-0.5 size-4 rounded border-input text-primary focus:ring-primary"
            id={block.id}
            name={fieldName}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              onAnswerChange(block.fieldKey, event.target.checked)
            }
            required={block.required}
            type="checkbox"
            value="true"
          />
          <div className="flex flex-col gap-1">
            <PublicFormFieldLabel block={block} />
            <PublicFormFieldHelpText block={block} />
          </div>
        </ErrorField>
      )

    case "dropdown_field":
      return (
        <ErrorField block={block} data-public-form-field-key={block.fieldKey}>
          <PublicFormFieldLabel block={block} />
          {block.multiple ? (
            <CheckboxChoices
              across={block.across}
              id={block.id}
              label={block.label}
              name={fieldName}
              onChange={(value: string[]): void => onAnswerChange(block.fieldKey, value)}
              options={block.options}
              value={readListAnswer(answers, block.fieldKey)}
            />
          ) : block.display === "radios" ? (
            <RadioChoices
              across={block.across}
              id={block.id}
              label={block.label}
              name={fieldName}
              onChange={(value: string): void => onAnswerChange(block.fieldKey, value)}
              options={block.options}
              required={block.required}
              value={readStringAnswer(answers, block.fieldKey)}
            />
          ) : (
            <Select
              id={block.id}
              name={fieldName}
              onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                onAnswerChange(block.fieldKey, event.target.value)
              }
              required={block.required}
              value={readStringAnswer(answers, block.fieldKey)}
            >
              <option value="">
                {block.placeholder || "Choose an option..."}
              </option>
              {block.options.map((option: string) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          )}
          <PublicFormFieldHelpText block={block} />
        </ErrorField>
      )

    // Grids and tables load only on the forms that have them.
    case "choice_grid_field":
    case "table_field":
      return (
        <ErrorField block={block} data-public-form-field-key={block.fieldKey}>
          <PublicFormFieldLabel block={block} />
          <Suspense fallback={null}>
            {block.type === "choice_grid_field" ? (
              <PaperGrid block={block} mode="fill" name={fieldName} onChange={(value) => onAnswerChange(block.fieldKey, value)} value={answers[block.fieldKey]} />
            ) : (
              <PaperTable block={block} mode="fill" name={fieldName} onChange={(value) => onAnswerChange(block.fieldKey, value)} value={answers[block.fieldKey]} />
            )}
          </Suspense>
          <PublicFormFieldHelpText block={block} />
        </ErrorField>
      )

    default:
      return null
  }
}

const PaperGrid = lazy(() => import("@/components/editor/paper-answer-kinds").then((kinds) => ({ default: kinds.PaperGrid })))
const PaperTable = lazy(() => import("@/components/editor/paper-answer-kinds").then((kinds) => ({ default: kinds.PaperTable })))

function readListAnswer(answers: Readonly<Record<string, unknown>>, fieldKey: string): string[] {
  const value = answers[fieldKey]

  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

type FieldControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

function asControl(target: EventTarget): FieldControl | null {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement
    ? target
    : null
}

/**
 * A field that keeps its own error on the page. When the browser refuses to
 * submit it, the message appears under it and is tied to the control, so it is
 * announced once and can be read again; typing clears it. The toast every form
 * shows stays as well.
 */
function ErrorField({
  block,
  children,
  ...props
}: ComponentProps<typeof Field> & { block: Extract<TemplateBlock, { fieldKey: string }> }): ReactElement {
  const [message, setMessage] = useState<string | null>(null)
  const errorId = `${block.id}-error`

  function clear(event: FormEvent<HTMLElement>): void {
    const control = asControl(event.target)

    if (control && message !== null) {
      control.removeAttribute("aria-invalid")
      control.removeAttribute("aria-describedby")
      setMessage(null)
    }
  }

  return (
    <Field
      {...props}
      onChangeCapture={clear}
      onInputCapture={clear}
      onInvalidCapture={(event: FormEvent<HTMLElement>): void => {
        const control = asControl(event.target)

        if (control) {
          control.setAttribute("aria-invalid", "true")
          control.setAttribute("aria-describedby", errorId)
          setMessage(describeInvalidField(control))
        }
      }}
    >
      {children}
      {message === null ? null : (
        <p className="text-sm text-destructive" id={errorId} role="alert">
          {message}
        </p>
      )}
    </Field>
  )
}

function PublicFormFieldLabel({
  block
}: {
  block: Extract<TemplateBlock, { fieldKey: string }>
}): ReactElement {
  return (
    <FieldLabel htmlFor={block.id}>
      {block.label}
      {block.required && (
        <span aria-hidden="true" className="ml-1 text-destructive">
          *
        </span>
      )}
    </FieldLabel>
  )
}

function PublicFormFieldHelpText({
  block
}: {
  block: Extract<TemplateBlock, { fieldKey: string }>
}): ReactElement | null {
  return block.helpText ? (
    <FieldDescription>{block.helpText}</FieldDescription>
  ) : null
}

function readStringAnswer(
  answers: Readonly<Record<string, unknown>>,
  fieldKey: string
): string {
  const value = answers[fieldKey]
  return typeof value === "string" ? value : ""
}

function readBooleanAnswer(
  answers: Readonly<Record<string, unknown>>,
  fieldKey: string,
  defaultValue: boolean
): boolean {
  return Object.prototype.hasOwnProperty.call(answers, fieldKey)
    ? answers[fieldKey] === true
    : defaultValue
}

function createInitialPublicFormAnswers(
  content: TemplateContent,
  initialAnswers: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const checkboxDefaults = Object.fromEntries(
    content.blocks
      .filter(
        (
          block: TemplateBlock
        ): block is Extract<TemplateBlock, { type: "checkbox_field" }> =>
          block.type === "checkbox_field"
      )
      .map((block) => [block.fieldKey, block.checkedByDefault])
  )

  return { ...checkboxDefaults, ...initialAnswers }
}
