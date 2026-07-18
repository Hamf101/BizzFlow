"use client"

import {
  ArrowDown,
  ArrowUp,
  Trash2,
} from "lucide-react"
import Image from "next/image"
import {
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
  useState,
} from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { TemplateBlock } from "@/types/template"

import { readTemplateImage } from "./template-image"

const CONTROL_CLASS_NAME =
  "w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"

const BLOCK_LABELS: Record<TemplateBlock["type"], string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  bullet_list: "Bullet list",
  numbered_list: "Numbered list",
  image: "Image or logo",
  table: "Table",
  divider: "Divider",
  text_field: "Text field",
  date_field: "Date field",
  checkbox_field: "Checkbox",
  dropdown_field: "Dropdown",
  initials_field: "Initials field",
  signature_field: "Signature field",
  file_field: "File upload",
}

type TemplateFieldBlock = Extract<
  TemplateBlock,
  {
    type:
      | "text_field"
      | "date_field"
      | "checkbox_field"
      | "dropdown_field"
      | "initials_field"
      | "signature_field"
      | "file_field"
  }
>

type TemplateBlockEditorProps = {
  block: TemplateBlock
  canMoveDown: boolean
  canMoveUp: boolean
  onChange: (block: TemplateBlock) => void
  onDelete: () => void
  onMoveDown: () => void
  onMoveUp: () => void
}

/**
 * Renders accessible controls for one canonical template block.
 *
 * @param props - Block value and explicit update, delete, and ordering callbacks.
 * @returns A bordered editor panel for the selected block type.
 */
export function TemplateBlockEditor({
  block,
  canMoveDown,
  canMoveUp,
  onChange,
  onDelete,
  onMoveDown,
  onMoveUp,
}: TemplateBlockEditorProps): ReactElement {
  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold">{BLOCK_LABELS[block.type]}</span>
        <div className="flex items-center gap-1">
          <Button
            aria-label={`Move ${BLOCK_LABELS[block.type]} up`}
            disabled={!canMoveUp}
            onClick={onMoveUp}
            size="icon-sm"
            title="Move up"
            type="button"
            variant="ghost"
          >
            <ArrowUp />
          </Button>
          <Button
            aria-label={`Move ${BLOCK_LABELS[block.type]} down`}
            disabled={!canMoveDown}
            onClick={onMoveDown}
            size="icon-sm"
            title="Move down"
            type="button"
            variant="ghost"
          >
            <ArrowDown />
          </Button>
          <Button
            aria-label={`Delete ${BLOCK_LABELS[block.type]}`}
            onClick={onDelete}
            size="icon-sm"
            title="Delete block"
            type="button"
            variant="destructive"
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <BlockFields block={block} onChange={onChange} />
    </div>
  )
}

function BlockFields({
  block,
  onChange,
}: {
  block: TemplateBlock
  onChange: (block: TemplateBlock) => void
}): ReactElement {
  switch (block.type) {
    case "heading":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor={`${block.id}-heading-text`}>Text</FieldLabel>
            <Input
              id={`${block.id}-heading-text`}
              maxLength={500}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                onChange({ ...block, text: event.target.value })
              }
              required
              value={block.text}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${block.id}-heading-level`}>Level</FieldLabel>
            <select
              className={CONTROL_CLASS_NAME}
              id={`${block.id}-heading-level`}
              onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                onChange({
                  ...block,
                  level: Number(event.target.value) as 1 | 2 | 3,
                })
              }
              value={block.level}
            >
              <option value={1}>Heading 1</option>
              <option value={2}>Heading 2</option>
              <option value={3}>Heading 3</option>
            </select>
          </Field>
          <AlignmentField
            id={`${block.id}-heading-alignment`}
            onChange={(alignment: "left" | "center" | "right"): void =>
              onChange({ ...block, alignment })
            }
            value={block.alignment}
          />
        </div>
      )
    case "paragraph":
      return (
        <div className="grid gap-4">
          <Field>
            <FieldLabel htmlFor={`${block.id}-paragraph-text`}>Text</FieldLabel>
            <textarea
              className={cn(CONTROL_CLASS_NAME, "min-h-28 resize-y")}
              id={`${block.id}-paragraph-text`}
              maxLength={20_000}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                onChange({ ...block, text: event.target.value })
              }
              value={block.text}
            />
          </Field>
          <AlignmentField
            id={`${block.id}-paragraph-alignment`}
            onChange={(alignment: "left" | "center" | "right"): void =>
              onChange({ ...block, alignment })
            }
            value={block.alignment}
          />
        </div>
      )
    case "bullet_list":
    case "numbered_list":
      return (
        <Field>
          <FieldLabel htmlFor={`${block.id}-list-items`}>
            Items, one per line
          </FieldLabel>
          <textarea
            className={cn(CONTROL_CLASS_NAME, "min-h-28 resize-y")}
            id={`${block.id}-list-items`}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
              onChange({ ...block, items: event.target.value.split("\n") })
            }
            value={block.items.join("\n")}
          />
        </Field>
      )
    case "image":
      return <ImageFields block={block} onChange={onChange} />
    case "table":
      return (
        <div className="grid gap-4">
          <Field>
            <FieldLabel htmlFor={`${block.id}-table-headers`}>
              Column headings, separated by | characters
            </FieldLabel>
            <Input
              id={`${block.id}-table-headers`}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                onChange({
                  ...block,
                  headers: event.target.value.split("|").map((value: string) =>
                    value.trim()
                  ),
                })
              }
              value={block.headers.join(" | ")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${block.id}-table-rows`}>
              Rows, one per line with cells separated by | characters
            </FieldLabel>
            <textarea
              className={cn(CONTROL_CLASS_NAME, "min-h-28 resize-y font-mono")}
              id={`${block.id}-table-rows`}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                onChange({
                  ...block,
                  rows: event.target.value.split("\n").map((row: string) =>
                    row.split("|").map((value: string) => value.trim())
                  ),
                })
              }
              value={block.rows.map((row: string[]) => row.join(" | ")).join("\n")}
            />
          </Field>
        </div>
      )
    case "divider":
      return (
        <p className="text-sm text-muted-foreground">
          The divider creates a full-width rule in this region.
        </p>
      )
    case "text_field":
      return (
        <FieldBlockFields block={block} onChange={onChange}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TemplatePlaceholderField
              blockId={block.id}
              onChange={(placeholder: string | null): void =>
                onChange({ ...block, placeholder })
              }
              value={block.placeholder}
            />
            <CheckboxControl
              checked={block.multiline}
              id={`${block.id}-multiline`}
              label="Allow multiple lines"
              onChange={(multiline: boolean): void =>
                onChange({ ...block, multiline })
              }
            />
          </div>
        </FieldBlockFields>
      )
    case "checkbox_field":
      return (
        <FieldBlockFields block={block} onChange={onChange}>
          <CheckboxControl
            checked={block.checkedByDefault}
            id={`${block.id}-checked-default`}
            label="Checked by default"
            onChange={(checkedByDefault: boolean): void =>
              onChange({ ...block, checkedByDefault })
            }
          />
        </FieldBlockFields>
      )
    case "dropdown_field":
      return (
        <FieldBlockFields block={block} onChange={onChange}>
          <div className="grid gap-4">
            <TemplatePlaceholderField
              blockId={block.id}
              onChange={(placeholder: string | null): void =>
                onChange({ ...block, placeholder })
              }
              value={block.placeholder}
            />
            <Field>
              <FieldLabel htmlFor={`${block.id}-options`}>
                Options, one per line
              </FieldLabel>
              <textarea
                className={cn(CONTROL_CLASS_NAME, "min-h-24 resize-y")}
                id={`${block.id}-options`}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                  onChange({ ...block, options: event.target.value.split("\n") })
                }
                value={block.options.join("\n")}
              />
            </Field>
          </div>
        </FieldBlockFields>
      )
    case "date_field":
    case "initials_field":
    case "signature_field":
    case "file_field":
      return <FieldBlockFields block={block} onChange={onChange} />
  }
}

function TemplatePlaceholderField({
  blockId,
  onChange,
  value,
}: {
  blockId: string
  onChange: (value: string | null) => void
  value: string | null
}): ReactElement {
  return (
    <Field>
      <FieldLabel htmlFor={`${blockId}-placeholder`}>Placeholder</FieldLabel>
      <Input
        id={`${blockId}-placeholder`}
        maxLength={240}
        onChange={(event: ChangeEvent<HTMLInputElement>): void =>
          onChange(event.target.value || null)
        }
        value={value ?? ""}
      />
    </Field>
  )
}

function ImageFields({
  block,
  onChange,
}: {
  block: Extract<TemplateBlock, { type: "image" }>
  onChange: (block: TemplateBlock) => void
}): ReactElement {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleFileChange(
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    setErrorMessage(null)

    try {
      const dataUrl = await readTemplateImage(file)
      onChange({ ...block, dataUrl })
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : "Unable to read image."

      console.warn("template_block_image_read_failed", {
        blockId: block.id,
        fileName: file.name,
        reason,
      })
      setErrorMessage(reason)
    } finally {
      event.target.value = ""
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex items-center justify-center rounded-lg border bg-muted/30 p-3 sm:row-span-3">
        <Image
          alt={block.altText}
          className="h-auto max-h-44 w-auto max-w-full rounded object-contain"
          height={320}
          src={block.dataUrl}
          unoptimized
          width={480}
        />
      </div>
      <Field>
        <FieldLabel htmlFor={`${block.id}-image-file`}>PNG or JPEG</FieldLabel>
        <Input
          accept="image/png,image/jpeg"
          aria-describedby={errorMessage ? `${block.id}-image-error` : undefined}
          id={`${block.id}-image-file`}
          onChange={handleFileChange}
          type="file"
        />
        {errorMessage && (
          <p className="text-sm text-destructive" id={`${block.id}-image-error`}>
            {errorMessage}
          </p>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor={`${block.id}-alt-text`}>Alternative text</FieldLabel>
        <Input
          id={`${block.id}-alt-text`}
          maxLength={500}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange({ ...block, altText: event.target.value })
          }
          required
          value={block.altText}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${block.id}-caption`}>Caption</FieldLabel>
        <Input
          id={`${block.id}-caption`}
          maxLength={500}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange({ ...block, caption: event.target.value || null })
          }
          value={block.caption ?? ""}
        />
      </Field>
      <AlignmentField
        id={`${block.id}-image-alignment`}
        onChange={(alignment: "left" | "center" | "right"): void =>
          onChange({ ...block, alignment })
        }
        value={block.alignment}
      />
      <Field>
        <FieldLabel htmlFor={`${block.id}-image-width`}>
          Width ({block.widthPercent}%)
        </FieldLabel>
        <input
          className="accent-primary"
          id={`${block.id}-image-width`}
          max={100}
          min={10}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange({ ...block, widthPercent: Number(event.target.value) })
          }
          step={5}
          type="range"
          value={block.widthPercent}
        />
      </Field>
    </div>
  )
}

function AlignmentField({
  id,
  onChange,
  value,
}: {
  id: string
  onChange: (alignment: "left" | "center" | "right") => void
  value: "left" | "center" | "right"
}): ReactElement {
  return (
    <Field>
      <FieldLabel htmlFor={id}>Alignment</FieldLabel>
      <select
        className={CONTROL_CLASS_NAME}
        id={id}
        onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
          onChange(event.target.value as "left" | "center" | "right")
        }
        value={value}
      >
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
      </select>
    </Field>
  )
}

function FieldBlockFields({
  block,
  children,
  onChange,
}: {
  block: TemplateFieldBlock
  children?: ReactNode
  onChange: (block: TemplateBlock) => void
}): ReactElement {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${block.id}-field-label`}>Label</FieldLabel>
          <Input
            id={`${block.id}-field-label`}
            maxLength={160}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              onChange({ ...block, label: event.target.value })
            }
            required
            value={block.label}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${block.id}-field-key`}>Field key</FieldLabel>
          <Input
            id={`${block.id}-field-key`}
            maxLength={80}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              onChange({ ...block, fieldKey: event.target.value })
            }
            pattern="[A-Za-z][A-Za-z0-9_-]{0,79}"
            required
            value={block.fieldKey}
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={`${block.id}-help-text`}>Help text</FieldLabel>
        <Input
          id={`${block.id}-help-text`}
          maxLength={500}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange({ ...block, helpText: event.target.value || null })
          }
          value={block.helpText ?? ""}
        />
      </Field>
      <CheckboxControl
        checked={block.required}
        id={`${block.id}-required`}
        label="Required field"
        onChange={(required: boolean): void => onChange({ ...block, required })}
      />
      {children}
    </div>
  )
}

function CheckboxControl({
  checked,
  id,
  label,
  onChange,
}: {
  checked: boolean
  id: string
  label: string
  onChange: (checked: boolean) => void
}): ReactElement {
  return (
    <label className="flex w-fit items-center gap-2 text-sm" htmlFor={id}>
      <input
        checked={checked}
        className="size-4 accent-primary"
        id={id}
        onChange={(event: ChangeEvent<HTMLInputElement>): void =>
          onChange(event.target.checked)
        }
        type="checkbox"
      />
      {label}
    </label>
  )
}
