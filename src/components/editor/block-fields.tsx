"use client"

import { Plus, X } from "lucide-react"
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useRef,
  useState,
} from "react"

import { Button } from "@/components/ui/button"
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
import { boxSigner, MAX_SIGNING_RECIPIENTS } from "@/types/box-signers"
import { MAX_FIELD_LABEL_LENGTH, type TemplateBlock } from "@/types/template"
import { evaluateTemplateDropdownOptionEdit } from "@/types/template-structure"

// A choice shows as a dropdown, or with every option on show as radio
// buttons, or as checkboxes when any number may be ticked.
const CHOICE_DISPLAYS = [
  { label: "Dropdown", value: "dropdown" },
  { label: "Radio buttons", value: "radios" },
  { label: "Checkboxes", value: "checkboxes" },
] as const

// What a typed answer holds, so it is checked and a phone shows the right keys.
const TEXT_FORMATS = [
  { label: "Any text", value: "" },
  { label: "Number", value: "number" },
  { label: "Money", value: "money" },
  { label: "Email", value: "email" },
  { label: "Phone", value: "phone" },
  { label: "Time", value: "time" },
  { label: "Month and year", value: "month" },
] as const

const COLUMN_FORMATS = [
  { label: "Text", value: "" },
  { label: "Number", value: "number" },
  { label: "Money", value: "money" },
  { label: "Date", value: "date" },
  { label: "Time", value: "time" },
] as const

// Radio buttons go one a line, or side by side along a line.
const RADIO_LAYOUTS = [
  { label: "One a line", value: "down" },
  { label: "Side by side", value: "across" },
] as const

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
      | "choice_grid_field"
      | "table_field"
      | "initials_field"
      | "signature_field"
      | "file_field"
  }
>

/**
 * A field's own settings: its label, key and choices, in its popover on the page.
 *
 * @param props - The block, the page's blocks, and how to change the block.
 * @returns The settings.
 */
export function BlockFields({
  block,
  blocks,
  onChange,
}: {
  block: TemplateBlock
  blocks: readonly TemplateBlock[]
  onChange: (block: TemplateBlock) => void
}): ReactElement | null {
  switch (block.type) {
    case "text_field":
      return (
        <FieldBlockFields block={block} blocks={blocks} onChange={onChange}>
          <Field>
            <FieldLabel htmlFor={`${block.id}-format`}>Answer</FieldLabel>
            <Select
              id={`${block.id}-format`}
              onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
                const format = event.target.value as NonNullable<typeof block.format> | ""
                const next: typeof block = { ...block, format: format || undefined }

                // A typed answer is one line.
                onChange(format ? { ...next, multiline: false } : next)
              }}
              value={block.format ?? ""}
            >
              {TEXT_FORMATS.map((format) => (
                <option key={format.value} value={format.value}>
                  {format.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <AffixField blockId={block.id} label="Before" maxLength={12} onChange={(prefix) => onChange({ ...block, prefix })} value={block.prefix} />
            <AffixField blockId={block.id} label="After" maxLength={24} onChange={(suffix) => onChange({ ...block, suffix })} value={block.suffix} />
          </div>
          <PlaceholderField
            blockId={block.id}
            onChange={(placeholder: string | null): void =>
              onChange({ ...block, placeholder })
            }
            value={block.placeholder}
          />
          <CharacterBoxes block={block} onChange={onChange} />
          {block.format || block.comb ? null : (
            <CheckboxControl
              checked={block.multiline}
              id={`${block.id}-multiline`}
              label="Allow multiple lines"
              onChange={(multiline: boolean): void =>
                onChange({ ...block, multiline })
              }
            />
          )}
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
          <fieldset className="grid gap-2">
            <FieldLegend variant="label">Show as</FieldLegend>
            <Segmented
              className="w-fit"
              label="Show as"
              onChange={(display): void => {
                const next: typeof block = { ...block, display: "radios" }

                delete next.multiple

                if (display === "checkboxes") {
                  next.multiple = true
                }

                if (display === "dropdown") {
                  delete next.display
                  delete next.across
                }

                onChange(next)
              }}
              options={CHOICE_DISPLAYS}
              value={block.multiple ? "checkboxes" : (block.display ?? "dropdown")}
            />
          </fieldset>
          {block.display === "radios" || block.multiple ? (
            <fieldset className="grid gap-2">
              <FieldLegend variant="label">Layout</FieldLegend>
              <Segmented
                className="w-fit"
                label="Layout"
                onChange={(layout): void => {
                  const next: typeof block = { ...block, across: true }

                  if (layout === "down") {
                    delete next.across
                  }

                  onChange(next)
                }}
                options={RADIO_LAYOUTS}
                value={block.across ? "across" : "down"}
              />
            </fieldset>
          ) : (
            <PlaceholderField
              blockId={block.id}
              onChange={(placeholder: string | null): void =>
                onChange({ ...block, placeholder })
              }
              value={block.placeholder}
            />
          )}
          <OptionsField block={block} blocks={blocks} onChange={onChange} />
        </FieldBlockFields>
      )
    case "date_field":
      return (
        <FieldBlockFields block={block} blocks={blocks} onChange={onChange}>
          <DateFormatField block={block} onChange={onChange} />
        </FieldBlockFields>
      )
    case "choice_grid_field":
      return (
        <FieldBlockFields block={block} blocks={blocks} onChange={onChange}>
          <WordListField legend="Statements" max={40} maxLength={240} min={1} noun="statement" onChange={(rows) => onChange({ ...block, rows })} values={block.rows} />
          <WordListField legend="Choices" max={10} maxLength={60} min={2} noun="choice" onChange={(options) => onChange({ ...block, options })} values={block.options} />
        </FieldBlockFields>
      )
    case "table_field":
      return (
        <FieldBlockFields block={block} blocks={blocks} onChange={onChange}>
          <TableColumnsField block={block} onChange={onChange} />
          <Field>
            <FieldLabel htmlFor={`${block.id}-rows`}>Rows</FieldLabel>
            <Input
              id={`${block.id}-rows`}
              inputMode="numeric"
              max={50}
              min={1}
              onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                const rows = Number(event.target.value)

                if (Number.isInteger(rows) && rows >= 1 && rows <= 50) {
                  onChange({ ...block, rows })
                }
              }}
              type="number"
              value={block.rows}
            />
          </Field>
          <CheckboxControl
            checked={block.addRows === true}
            id={`${block.id}-add-rows`}
            label="People can add rows"
            onChange={(addRows: boolean): void => {
              const next: typeof block = { ...block, addRows: true }

              if (!addRows) {
                delete next.addRows
              }

              onChange(next)
            }}
          />
        </FieldBlockFields>
      )
    case "initials_field":
    case "signature_field":
      return (
        <FieldBlockFields block={block} blocks={blocks} onChange={onChange}>
          <SignerField block={block} blocks={blocks} onChange={onChange} />
        </FieldBlockFields>
      )
    case "file_field":
      return (
        <FieldBlockFields block={block} blocks={blocks} onChange={onChange} />
      )
    // Every other block is set on the page, or in its own panel.
    default:
      return null
  }
}

/**
 * Who signs a signature or initials box: the sender, or a signer by the order
 * they are added when it is sent. Offers one signer past the highest in use.
 */
function SignerField({
  block,
  blocks,
  onChange,
}: {
  block: Extract<TemplateBlock, { type: "initials_field" | "signature_field" }>
  blocks: readonly TemplateBlock[]
  onChange: (block: TemplateBlock) => void
}): ReactElement {
  const highest = Math.max(
    0,
    ...blocks.map((other: TemplateBlock): number => {
      const signer = "signer" in other ? other.signer : undefined

      return typeof signer === "number" ? signer : 0
    })
  )
  const count = Math.min(MAX_SIGNING_RECIPIENTS, Math.max(5, highest + 1))

  return (
    <Field>
      <FieldLabel htmlFor={`${block.id}-signer`}>Signed by</FieldLabel>
      <Select
        id={`${block.id}-signer`}
        onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
          onChange({
            ...block,
            signer: event.target.value === "sender" ? "sender" : Number(event.target.value),
          })
        }
        value={String(boxSigner(block))}
      >
        <option value="sender">Sender</option>
        {Array.from({ length: count }, (_, index: number) => (
          <option key={index} value={index + 1}>
            Signer {index + 1}
          </option>
        ))}
      </Select>
    </Field>
  )
}

function AffixField({
  blockId,
  label,
  maxLength,
  onChange,
  value,
}: {
  blockId: string
  label: "After" | "Before"
  maxLength: number
  onChange: (value: string | undefined) => void
  value: string | undefined
}): ReactElement {
  const id = `${blockId}-${label.toLowerCase()}`

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        maxLength={maxLength}
        onChange={(event: ChangeEvent<HTMLInputElement>): void => onChange(event.target.value.trim() || undefined)}
        placeholder={label === "Before" ? "£" : "kg"}
        value={value ?? ""}
      />
    </Field>
  )
}

/**
 * A grid's statements or choices, each its own input. The saved list changes
 * only once what is typed is a list the grid can use: filled, each said once,
 * and enough of them.
 */
function WordListField({
  legend,
  max,
  maxLength,
  min,
  noun,
  onChange,
  values,
}: {
  legend: string
  max: number
  maxLength: number
  min: number
  noun: string
  onChange: (values: string[]) => void
  values: readonly string[]
}): ReactElement {
  const [draft, setDraft] = useState<readonly string[]>(values)
  const [seen, setSeen] = useState<readonly string[]>(values)
  const usable = (list: readonly string[]): boolean => {
    const words = filled(list)

    return words.length >= min && words.length <= max && new Set(words.map((word) => word.trim().toLowerCase())).size === words.length
  }

  // Undo or Flow changed the list: show theirs, unless this list says the same.
  if (values !== seen) {
    setSeen(values)

    if (!sameOptions(filled(draft).map((word) => word.trim()), values)) {
      setDraft(values)
    }
  }

  return (
    <fieldset className="grid gap-2">
      <FieldLegend variant="label">{legend}</FieldLegend>
      <OptionList
        maxLength={maxLength}
        noun={noun}
        onChange={(next: readonly string[]): void => {
          setDraft(next)

          if (usable(next) && !sameOptions(filled(next), values)) {
            onChange(filled(next).map((word) => word.trim()))
          }
        }}
        options={draft}
      />
      {usable(draft) ? null : (
        <p className="text-xs text-destructive" role="alert">
          {`Needs ${min === 1 ? "a" : `at least ${min}`} ${noun}${min === 1 ? "" : "s"}, each said once${max ? `, ${max} at most` : ""}.`}
        </p>
      )}
    </fieldset>
  )
}

function TableColumnsField({
  block,
  onChange,
}: {
  block: Extract<TemplateBlock, { type: "table_field" }>
  onChange: (block: TemplateBlock) => void
}): ReactElement {
  const columns = block.columns
  // Names as typed; one blank or said twice waits there until it is a name of its own.
  const [names, setNames] = useState<readonly string[]>(columns.map((column) => column.label))
  const [seen, setSeen] = useState(columns)

  if (columns !== seen) {
    setSeen(columns)

    if (!sameOptions(names.map((name) => name.trim()), columns.map((column) => column.label.trim()))) {
      setNames(columns.map((column) => column.label))
    }
  }

  return (
    <fieldset className="grid gap-2">
      <FieldLegend variant="label">Columns</FieldLegend>
      <div className="grid gap-1.5">
        {columns.map((column, index: number) => (
          <div className="flex items-center gap-1" key={index}>
            <Input
              aria-label={`Column ${index + 1}`}
              maxLength={60}
              onChange={(event: ChangeEvent<HTMLInputElement>): void => {
                const label = event.target.value

                setNames(names.map((name, at) => (at === index ? label : name)))

                if (label.trim() && !columns.some((other, at) => at !== index && other.label.trim().toLowerCase() === label.trim().toLowerCase())) {
                  onChange({ ...block, columns: columns.map((other, at) => (at === index ? { ...other, label } : other)) })
                }
              }}
              value={names[index] ?? column.label}
            />
            <Select
              aria-label={`Column ${index + 1} holds`}
              className="w-28"
              onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
                const format = event.target.value as NonNullable<typeof column.format> | ""

                onChange({ ...block, columns: columns.map((other, at) => (at === index ? { label: other.label, ...(format ? { format } : {}) } : other)) })
              }}
              value={column.format ?? ""}
            >
              {COLUMN_FORMATS.map((format) => (
                <option key={format.value} value={format.value}>
                  {format.label}
                </option>
              ))}
            </Select>
            <Button
              aria-label={`Remove column ${index + 1}`}
              disabled={columns.length === 1}
              onClick={(): void => onChange({ ...block, columns: columns.filter((_, at) => at !== index) })}
              size="icon-sm"
              title="Remove"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
        ))}
      </div>
      {columns.length < 8 ? (
        <Button
          className="justify-self-start"
          onClick={(): void => {
            const taken = new Set(columns.map((column) => column.label.toLowerCase()))
            const label = Array.from({ length: 9 }, (_, at) => `Column ${at + 1}`).find((name) => !taken.has(name.toLowerCase())) ?? "Column"

            onChange({ ...block, columns: [...columns, { label }] })
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Plus />
          Add column
        </Button>
      ) : null}
    </fieldset>
  )
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
  maxLength = 240,
  noun = "option",
  onChange,
  options,
}: {
  maxLength?: number
  noun?: string
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
            aria-label={`${noun[0]?.toUpperCase()}${noun.slice(1)} ${index + 1}`}
            maxLength={maxLength}
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
            aria-label={`Remove ${noun} ${index + 1}`}
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
        Add {noun}
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
          maxLength={MAX_FIELD_LABEL_LENGTH}
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

export function CheckboxControl({
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

/**
 * How many boxes a text field's answer is written in, one a character, for a
 * reference or account number; blank is none. What is typed is kept while it
 * is typed, so 12 can be reached through 1, and only a count from 2 to 40 is kept.
 *
 * @param props - The text field and where its change goes.
 * @returns The count's field.
 */
function CharacterBoxes({
  block,
  onChange,
}: {
  block: Extract<TemplateBlock, { type: "text_field" }>
  onChange: (block: TemplateBlock) => void
}): ReactElement {
  const [typed, setTyped] = useState<string | null>(null)

  return (
    <Field>
      <FieldLabel htmlFor={`${block.id}-comb`}>Character boxes</FieldLabel>
      <Input
        id={`${block.id}-comb`}
        inputMode="numeric"
        max={40}
        min={2}
        onBlur={() => setTyped(null)}
        onChange={(event: ChangeEvent<HTMLInputElement>): void => {
          const count = Number(event.target.value)
          const valid = Number.isInteger(count) && count >= 2 && count <= 40

          setTyped(event.target.value)

          if (valid) {
            onChange({ ...block, comb: count, multiline: false })
          } else if (event.target.value === "" && block.comb !== undefined) {
            onChange({ ...block, comb: undefined })
          }
        }}
        placeholder="None"
        type="number"
        value={typed ?? block.comb ?? ""}
      />
    </Field>
  )
}
