"use client"

import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  ImageUp,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import Image from "next/image"
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useRef,
  useState,
} from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { Field, FieldLabel, FieldLegend } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Segmented } from "@/components/ui/segmented"
import { Select } from "@/components/ui/select"
import {
  type DateFormat,
  formatDateAnswer,
  MONTH_NAMES,
  toIsoDate,
} from "@/lib/date-format"
import { cn } from "@/lib/utils"
import type { TemplateBlock } from "@/types/template"
import { imageSource } from "@/types/template-images"
import { evaluateTemplateDropdownOptionEdit } from "@/types/template-structure"
import { requestImageUploadAction } from "@/app/(editor)/image-actions"

import { storeTemplateImage } from "./template-image"

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

// How answers are stored, and how a field without a format has always printed them.
const STORED_DATE_FORMAT: DateFormat = { month: "number", order: "ymd", separator: "-" }

const DATE_ORDERS = [
  { label: "Day first", value: "dmy" },
  { label: "Month first", value: "mdy" },
  { label: "Year first", value: "ymd" },
] as const

const DATE_SEPARATORS = [
  { label: "/", value: "/" },
  { label: ".", value: "." },
  { label: "-", value: "-" },
  { label: "Space", value: " " },
] as const

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
  blocks?: readonly TemplateBlock[]
  canMoveDown: boolean
  canMoveUp: boolean
  onChange: (block: TemplateBlock) => void
  onDelete: () => void
  onDuplicate?: () => void
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
  blocks = [],
  canMoveDown,
  canMoveUp,
  onChange,
  onDelete,
  onDuplicate,
  onMoveDown,
  onMoveUp,
}: TemplateBlockEditorProps): ReactElement {
  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold">{BLOCK_LABELS[block.type]}</span>
        <div className="flex items-center gap-1">
          {onDuplicate && (
            <Button
              aria-label={`Duplicate ${BLOCK_LABELS[block.type]}`}
              onClick={onDuplicate}
              size="icon-sm"
              title="Duplicate block"
              type="button"
              variant="ghost"
            >
              <Copy />
            </Button>
          )}
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

      {/* Keyed, so options still being written never carry over to another block. */}
      <BlockFields block={block} blocks={blocks} key={block.id} onChange={onChange} />
    </div>
  )
}

function BlockFields({
  block,
  blocks,
  onChange,
}: {
  block: TemplateBlock
  blocks: readonly TemplateBlock[]
  onChange: (block: TemplateBlock) => void
}): ReactElement | null {
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
            <Select
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
            </Select>
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
              Headings, separated by |
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
              Rows, one per line, cells separated by |
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
      return null
    case "text_field":
      return (
        <FieldBlockFields block={block} blocks={blocks} onChange={onChange}>
          <PlaceholderField
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
        </FieldBlockFields>
      )
    case "checkbox_field":
      return (
        <FieldBlockFields block={block} blocks={blocks} onChange={onChange}>
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
        <FieldBlockFields block={block} blocks={blocks} onChange={onChange}>
          <PlaceholderField
            blockId={block.id}
            onChange={(placeholder: string | null): void =>
              onChange({ ...block, placeholder })
            }
            value={block.placeholder}
          />
          <OptionsField block={block} blocks={blocks} onChange={onChange} />
        </FieldBlockFields>
      )
    case "date_field":
      return (
        <FieldBlockFields block={block} blocks={blocks} onChange={onChange}>
          <DateFormatField block={block} onChange={onChange} />
        </FieldBlockFields>
      )
    case "initials_field":
    case "signature_field":
    case "file_field":
      return (
        <FieldBlockFields block={block} blocks={blocks} onChange={onChange} />
      )
  }
}

function DateFormatField({
  block,
  onChange,
}: {
  block: Extract<TemplateBlock, { type: "date_field" }>
  onChange: (block: TemplateBlock) => void
}): ReactElement {
  // Examples use today, so every choice reads as a real date.
  const [today] = useState<string>(() => toIsoDate(new Date()))
  const monthName = MONTH_NAMES[Number(today.slice(5, 7)) - 1] ?? ""
  const months = [
    { label: today.slice(5, 7), value: "number" },
    { label: monthName.slice(0, 3), value: "short" },
    { label: monthName, value: "long" },
  ] as const
  const format = block.dateFormat ?? STORED_DATE_FORMAT

  function change(dateFormat: DateFormat): void {
    onChange({ ...block, dateFormat })
  }

  return (
    <fieldset className="grid gap-2">
      <FieldLegend variant="label">Date format</FieldLegend>
      <p aria-live="polite" className="text-sm font-medium tabular-nums">
        {formatDateAnswer(today, format)}
      </p>
      <Segmented
        label="Order"
        onChange={(order) => change({ ...format, order })}
        options={DATE_ORDERS}
        value={format.order}
      />
      <Segmented
        label="Month"
        onChange={(month) => change({ ...format, month })}
        options={months}
        value={format.month}
      />
      {format.month === "number" ? (
        <Segmented
          label="Separator"
          onChange={(separator) => change({ ...format, separator })}
          options={DATE_SEPARATORS}
          value={format.separator}
        />
      ) : null}
    </fieldset>
  )
}

/**
 * A dropdown's options, each in its own input. A change reaches the page as
 * it is typed, unless it would break the document: then the list keeps what
 * was typed and says why, and the saved options stay as they were.
 */
function OptionsField({
  block,
  blocks,
  onChange,
}: {
  block: Extract<TemplateBlock, { type: "dropdown_field" }>
  blocks: readonly TemplateBlock[]
  onChange: (block: TemplateBlock) => void
}): ReactElement {
  const [draft, setDraft] = useState<readonly string[]>(block.options)
  const [seen, setSeen] = useState<readonly string[]>(block.options)
  const edit = evaluateTemplateDropdownOptionEdit(blocks, block.id, filled(draft))

  // Undo or Flow changed the options: show theirs, unless this list says the same.
  if (block.options !== seen) {
    setSeen(block.options)

    if (!edit.success || !sameOptions(edit.options, block.options)) {
      setDraft(block.options)
    }
  }

  function change(next: readonly string[]): void {
    const nextEdit = evaluateTemplateDropdownOptionEdit(blocks, block.id, filled(next))

    setDraft(next)

    if (nextEdit.success && !sameOptions(nextEdit.options, block.options)) {
      onChange({ ...block, options: nextEdit.options })
    }
  }

  const affected = edit.success
    ? []
    : edit.dependentBlockIds.flatMap((id: string): string[] => {
        const dependent = blocks.find((candidate: TemplateBlock): boolean => candidate.id === id)

        return dependent && "label" in dependent ? [dependent.label] : []
      })

  return (
    <fieldset className="grid gap-2">
      <FieldLegend variant="label">Options</FieldLegend>
      <OptionList onChange={change} options={draft} />
      {edit.success ? null : (
        <div className="grid gap-1 text-xs leading-relaxed text-destructive" role="alert">
          <p>{edit.message}</p>
          {affected.length > 0 ? <p>Affected fields: {affected.join(", ")}.</p> : null}
        </div>
      )}
    </fieldset>
  )
}

// Options still being written are empty; they are not options yet.
function filled(options: readonly string[]): string[] {
  return options.filter((option: string): boolean => option.trim().length > 0)
}

function sameOptions(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((option: string, index: number): boolean => option === right[index])
}

/**
 * A dropdown's options as a list of their own inputs. Enter on a filled
 * option starts the next one.
 */
function OptionList({
  onChange,
  options,
}: {
  onChange: (options: readonly string[]) => void
  options: readonly string[]
}): ReactElement {
  const list = useRef<HTMLDivElement>(null)

  function focusOption(index: number): void {
    requestAnimationFrame(() => list.current?.querySelectorAll("input")[index]?.focus())
  }

  function add(at: number): void {
    onChange([...options.slice(0, at), "", ...options.slice(at)])
    focusOption(at)
  }

  return (
    <div className="grid gap-1.5" ref={list}>
      {options.map((option: string, index: number) => (
        // Options may repeat or be blank while being written, so their place names them.
        <div className="flex items-center gap-1" key={index}>
          <Input
            aria-label={`Option ${index + 1}`}
            maxLength={240}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              onChange(options.map((candidate: string, at: number) =>
                at === index ? event.target.value : candidate
              ))
            }
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>): void => {
              if (event.key === "Enter" && option.trim()) {
                event.preventDefault()
                add(index + 1)
              }
            }}
            value={option}
          />
          <Button
            aria-label={`Remove option ${index + 1}`}
            onClick={(): void => {
              onChange(options.filter((_: string, at: number): boolean => at !== index))
              focusOption(Math.max(0, index - 1))
            }}
            size="icon-sm"
            title="Remove"
            type="button"
            variant="ghost"
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        className="justify-self-start"
        onClick={(): void => add(options.length)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Plus />
        Add option
      </Button>
    </div>
  )
}

function PlaceholderField({
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
  const [uploading, setUploading] = useState(false)
  const altTextMissing = block.altText.trim().length === 0
  const source = imageSource(block.asset, block.dataUrl)

  async function handleFileChange(
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    setErrorMessage(null)
    setUploading(true)

    try {
      const asset = await storeTemplateImage(file, requestImageUploadAction)
      onChange({ ...block, asset, dataUrl: undefined })
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : "Unable to read image."

      console.warn("template_block_image_read_failed", {
        blockId: block.id,
        fileName: file.name,
        reason,
      })
      setErrorMessage(reason)
    } finally {
      setUploading(false)
      event.target.value = ""
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid justify-items-center gap-2 rounded-lg border bg-muted/30 p-3">
        {source ? (
          <Image
            alt={block.altText}
            className="h-auto max-h-44 w-auto max-w-full rounded object-contain"
            height={block.asset?.height ?? 320}
            src={source}
            unoptimized
            width={block.asset?.width ?? 480}
          />
        ) : null}
        <div className="flex flex-wrap justify-center gap-1">
          <label
            className={cn(
              buttonVariants({ size: "sm", variant: "ghost" }),
              "cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/35",
              uploading && "pointer-events-none opacity-60"
            )}
          >
            <ImageUp />
            {uploading ? "Uploading…" : "Replace"}
            <input
              accept="image/png,image/jpeg"
              disabled={uploading}
              aria-describedby={errorMessage ? `${block.id}-image-error` : undefined}
              className="sr-only"
              onChange={handleFileChange}
              type="file"
            />
          </label>
          {block.asset?.originalUrl ? (
            <a className={buttonVariants({ size: "sm", variant: "ghost" })} href={block.asset.originalUrl}>
              <Download />
              Download original
            </a>
          ) : null}
        </div>
        {errorMessage && (
          <p className="text-sm text-destructive" id={`${block.id}-image-error`} role="alert">
            {errorMessage}
          </p>
        )}
      </div>
      <Field>
        <FieldLabel htmlFor={`${block.id}-alt-text`}>Alternative text</FieldLabel>
        <Input
          aria-describedby={altTextMissing ? `${block.id}-alt-text-error` : undefined}
          aria-invalid={altTextMissing}
          id={`${block.id}-alt-text`}
          maxLength={500}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange({ ...block, altText: event.target.value })
          }
          required
          value={block.altText}
        />
        {altTextMissing ? (
          <p className="text-xs text-destructive" id={`${block.id}-alt-text-error`}>
            Describe the picture for people who cannot see it.
          </p>
        ) : null}
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
      <Select
        id={id}
        onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
          onChange(event.target.value as "left" | "center" | "right")
        }
        value={value}
      >
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
      </Select>
    </Field>
  )
}

function FieldBlockFields({
  block,
  blocks,
  children,
  onChange,
}: {
  block: TemplateFieldBlock
  blocks: readonly TemplateBlock[]
  children?: ReactNode
  onChange: (block: TemplateBlock) => void
}): ReactElement {
  const labelMissing = block.label.trim().length === 0

  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel htmlFor={`${block.id}-field-label`}>Label</FieldLabel>
        <Input
          aria-describedby={labelMissing ? `${block.id}-field-label-error` : undefined}
          aria-invalid={labelMissing}
          id={`${block.id}-field-label`}
          maxLength={160}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange({ ...block, label: event.target.value })
          }
          required
          value={block.label}
        />
        {labelMissing ? (
          <p className="text-xs text-destructive" id={`${block.id}-field-label-error`}>
            A field needs a label.
          </p>
        ) : null}
      </Field>
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
      <VisibilityFields block={block} blocks={blocks} onChange={onChange} />
      {children}
    </div>
  )
}

function VisibilityFields({
  block,
  blocks,
  onChange,
}: {
  block: TemplateFieldBlock
  blocks: readonly TemplateBlock[]
  onChange: (block: TemplateBlock) => void
}): ReactElement {
  const blockIndex = blocks.findIndex(
    (candidate: TemplateBlock): boolean => candidate.id === block.id
  )
  const sources = blocks.slice(0, Math.max(0, blockIndex)).filter(
    (
      candidate: TemplateBlock
    ): candidate is Extract<
      TemplateBlock,
      { type: "checkbox_field" | "dropdown_field" }
    > =>
      candidate.type === "checkbox_field" ||
      (candidate.type === "dropdown_field" && candidate.options.length > 0)
  )
  const condition = block.visibleWhen
  const source = sources.find(
    (candidate): boolean => candidate.id === condition?.sourceBlockId
  )

  function selectSource(sourceBlockId: string): void {
    const next = sources.find((candidate): boolean => candidate.id === sourceBlockId)

    onChange({
      ...block,
      visibleWhen: next
        ? {
            sourceBlockId: next.id,
            operator: "equals",
            value: next.type === "checkbox_field" ? true : (next.options[0] ?? ""),
          }
        : undefined,
    })
  }

  return (
    <fieldset className="grid gap-3 border-t border-border pt-4">
      <legend className="text-sm font-semibold">Conditional visibility</legend>
      <Field>
        <FieldLabel htmlFor={`${block.id}-visibility-source`}>
          Show this field when
        </FieldLabel>
        <Select
          id={`${block.id}-visibility-source`}
          onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
            selectSource(event.target.value)
          }
          value={condition?.sourceBlockId ?? ""}
        >
          <option value="">Always visible</option>
          {sources.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </Select>
        {sources.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Add a checkbox or dropdown above first.
          </p>
        )}
      </Field>
      {source && condition ? (
        <Field>
          <FieldLabel htmlFor={`${block.id}-visibility-value`}>Equals</FieldLabel>
          <Select
            id={`${block.id}-visibility-value`}
            onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
              onChange({
                ...block,
                visibleWhen: {
                  ...condition,
                  value:
                    source.type === "checkbox_field"
                      ? event.target.value === "true"
                      : event.target.value,
                },
              })
            }
            value={String(condition.value)}
          >
            {source.type === "checkbox_field" ? (
              <>
                <option value="true">Checked</option>
                <option value="false">Unchecked</option>
              </>
            ) : (
              source.options.map((option: string) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))
            )}
          </Select>
        </Field>
      ) : null}
    </fieldset>
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
