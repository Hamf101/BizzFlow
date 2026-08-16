"use client"

import {
  type ChangeEvent,
  type ReactElement,
  useMemo,
  useState
} from "react"

import {
  isStaticTemplateBlock,
  TemplateStaticBlock
} from "@/components/templates/template-static-block"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { createTemplateRenderPlan } from "@/services/templates/template-render-plan"
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

  return (
    <>
      {renderPlan.blocks.map(({ block }) => (
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
      ))}
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
        <Field data-public-form-field-key={block.fieldKey}>
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
            <Input
              id={block.id}
              name={fieldName}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                onAnswerChange(block.fieldKey, event.target.value)
              }
              placeholder={block.placeholder ?? ""}
              required={block.required}
              type="text"
              value={readStringAnswer(answers, block.fieldKey)}
            />
          )}
          <PublicFormFieldHelpText block={block} />
        </Field>
      )

    case "date_field":
      return (
        <Field data-public-form-field-key={block.fieldKey}>
          <PublicFormFieldLabel block={block} />
          <Input
            id={block.id}
            name={fieldName}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              onAnswerChange(block.fieldKey, event.target.value)
            }
            required={block.required}
            type="date"
            value={readStringAnswer(answers, block.fieldKey)}
          />
          <PublicFormFieldHelpText block={block} />
        </Field>
      )

    case "checkbox_field":
      return (
        <Field
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
        </Field>
      )

    case "dropdown_field":
      return (
        <Field data-public-form-field-key={block.fieldKey}>
          <PublicFormFieldLabel block={block} />
          <select
            className="h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
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
          </select>
          <PublicFormFieldHelpText block={block} />
        </Field>
      )

    default:
      return null
  }
}

function PublicFormFieldLabel({
  block
}: {
  block: Extract<TemplateBlock, { fieldKey: string }>
}): ReactElement {
  return (
    <FieldLabel htmlFor={block.id}>
      {block.label}
      {block.required && <span className="ml-1 text-destructive">*</span>}
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
