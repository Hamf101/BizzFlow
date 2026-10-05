"use client"

import { Plus, X } from "lucide-react"
import { useState, type ChangeEvent, type ReactElement } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Segmented } from "@/components/ui/segmented"
import { Select } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  MAX_VISIBILITY_CONDITIONS,
  visibilityConditionProblem,
  visibilityConditions,
  visibilityRule,
  type TemplateBlock,
  type TemplateVisibility,
  type TemplateVisibilityCondition,
  type VisibilityOperator,
} from "@/types/template"

type Row = Partial<TemplateVisibilityCondition> & { key: number }
type Source = Extract<TemplateBlock, { type: "checkbox_field" | "dropdown_field" | "text_field" | "date_field" }>

// A tick box reads as ticked or not; every other answer by what it holds.
const TESTS: Record<Source["type"], ReadonlyArray<readonly [string, string]>> = {
  checkbox_field: [["ticked", "is ticked"], ["unticked", "is not ticked"]],
  dropdown_field: [["equals", "is"], ["not_equals", "is not"], ["answered", "is answered"], ["not_answered", "is not answered"]],
  text_field: [["equals", "is"], ["not_equals", "is not"], ["answered", "is answered"], ["not_answered", "is not answered"]],
  date_field: [["equals", "is"], ["not_equals", "is not"], ["answered", "is answered"], ["not_answered", "is not answered"]],
}
const NUMBER_TESTS = [["greater_than", "is more than"], ["less_than", "is less than"]] as const

/**
 * When a block shows: tests of earlier answers, all or any of them holding.
 * A row is kept here until it is whole, so the document only ever holds a
 * rule it can run.
 */
export function VisibilityRuleFields({
  block,
  blocks,
  className,
  onChange,
}: {
  block: TemplateBlock
  blocks: readonly TemplateBlock[]
  className?: string
  onChange: (block: TemplateBlock) => void
}): ReactElement {
  const rule = "visibleWhen" in block ? block.visibleWhen : undefined
  const sources = blocks.slice(0, Math.max(0, blocks.findIndex((candidate) => candidate.id === block.id))).filter(isSource)
  const [match, setMatch] = useState<"all" | "any">(rule && "conditions" in rule ? rule.match : "all")
  const [rows, setRows] = useState<Row[]>(() => toRows(rule))
  // The rule as last written here; another one means undo, or Flow, changed it.
  const [emitted, setEmitted] = useState(rule)

  if (JSON.stringify(rule) !== JSON.stringify(emitted)) {
    setEmitted(rule)
    setRows(toRows(rule))
    setMatch(rule && "conditions" in rule ? rule.match : "all")
  }

  function commit(nextRows: Row[], nextMatch = match): void {
    const whole = nextRows.flatMap(({ operator, sourceBlockId, value }): TemplateVisibilityCondition[] => {
      const source = sources.find((candidate) => candidate.id === sourceBlockId)
      const condition = { sourceBlockId, operator, ...(value === undefined ? {} : { value }) } as TemplateVisibilityCondition

      return source && operator && visibilityConditionProblem(source, condition) === null ? [condition] : []
    })
    const next = visibilityRule(nextMatch, whole)

    setRows(nextRows)
    setMatch(nextMatch)
    setEmitted(next)

    const rest: Record<string, unknown> = { ...block }

    delete rest.visibleWhen
    onChange((next === undefined ? rest : { ...rest, visibleWhen: next }) as TemplateBlock)
  }

  function update(key: number, patch: Partial<TemplateVisibilityCondition>): void {
    commit(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function chooseSource(key: number, sourceBlockId: string): void {
    const source = sources.find((candidate) => candidate.id === sourceBlockId)

    update(key, source ? firstTest(source) : { sourceBlockId: undefined, operator: undefined, value: undefined })
  }

  function chooseTest(row: Row, source: Source, test: string): void {
    if (source.type === "checkbox_field") {
      update(row.key, { operator: "equals", value: test === "ticked" })
      return
    }

    const operator = test as VisibilityOperator
    const keepsValue = operator !== "answered" && operator !== "not_answered"
    const value = !keepsValue
      ? undefined
      : typeof row.value === "string"
        ? row.value
        : source.type === "dropdown_field"
          ? source.options[0]
          : ""

    update(row.key, { operator, value })
  }

  const addRow = (): void => commit([...rows, { key: Math.max(0, ...rows.map((row) => row.key)) + 1 }])

  return (
    <fieldset className={cn("grid gap-3 border-t border-border pt-4", className)}>
      <legend className="text-sm font-semibold">Show when</legend>
      {sources.length === 0 ? (
        <p className="text-xs text-muted-foreground">Add a question above first; this shows by its answer.</p>
      ) : null}
      {rows.length > 1 ? (
        <Segmented
          className="w-fit"
          label="How the tests combine"
          onChange={(next) => commit(rows, next)}
          options={[
            { label: "All of these", value: "all" },
            { label: "Any of these", value: "any" },
          ]}
          value={match}
        />
      ) : null}
      {rows.map((row, index) => {
        const source = sources.find((candidate) => candidate.id === row.sourceBlockId)
        const id = `${block.id}-rule-${row.key}`

        return (
          <div className="grid gap-2" data-slot="visibility-condition" key={row.key}>
            <div className="flex items-end gap-1">
              <Field className="min-w-0 flex-1">
                <FieldLabel htmlFor={`${id}-source`}>{index === 0 ? "If" : match === "all" ? "And" : "Or"}</FieldLabel>
                <Select
                  id={`${id}-source`}
                  onChange={(event: ChangeEvent<HTMLSelectElement>): void => chooseSource(row.key, event.target.value)}
                  value={row.sourceBlockId ?? ""}
                >
                  <option value="">Choose a question</option>
                  {sources.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                aria-label={`Remove test ${index + 1}`}
                onClick={() => commit(rows.filter((candidate) => candidate.key !== row.key))}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <X />
              </Button>
            </div>
            {source ? (
              <div className="grid grid-cols-2 gap-2">
                <Select
                  aria-label="Test"
                  className={needsValue(row, source) ? undefined : "col-span-2"}
                  onChange={(event: ChangeEvent<HTMLSelectElement>): void => chooseTest(row, source, event.target.value)}
                  value={source.type === "checkbox_field" ? (row.value === false ? "unticked" : "ticked") : (row.operator ?? "")}
                >
                  {testsFor(source).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                {needsValue(row, source) ? <ValueInput onChange={(value) => update(row.key, { value })} row={row} source={source} /> : null}
              </div>
            ) : null}
          </div>
        )
      })}
      {sources.length > 0 && rows.length < MAX_VISIBILITY_CONDITIONS ? (
        <Button className="w-fit" onClick={addRow} size="sm" type="button" variant="ghost">
          <Plus />
          {rows.length === 0 ? "Add a condition" : "Add another"}
        </Button>
      ) : null}
    </fieldset>
  )
}

// A row's key tells it apart while it is edited; it is never stored.
function toRows(rule: TemplateVisibility | undefined): Row[] {
  return visibilityConditions(rule).map((condition, index) => ({ ...condition, key: index + 1 }))
}

function ValueInput({ onChange, row, source }: { onChange: (value: string) => void; row: Row; source: Source }): ReactElement {
  const value = typeof row.value === "string" ? row.value : ""

  if (source.type === "dropdown_field") {
    return (
      <Select aria-label="Choice" onChange={(event: ChangeEvent<HTMLSelectElement>): void => onChange(event.target.value)} value={value}>
        {source.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    )
  }

  const numeric = row.operator === "greater_than" || row.operator === "less_than"

  return (
    <Input
      aria-label={numeric ? "Number" : "Value"}
      inputMode={numeric ? "decimal" : undefined}
      maxLength={240}
      onChange={(event: ChangeEvent<HTMLInputElement>): void => onChange(event.target.value)}
      type={source.type === "date_field" ? "date" : "text"}
      value={value}
    />
  )
}

function isSource(block: TemplateBlock): block is Source {
  return (
    block.type === "checkbox_field" ||
    block.type === "text_field" ||
    block.type === "date_field" ||
    (block.type === "dropdown_field" && block.options.length > 0)
  )
}

function testsFor(source: Source): ReadonlyArray<readonly [string, string]> {
  const numeric = source.type === "text_field" && (source.format === "number" || source.format === "money")

  return numeric ? [...TESTS[source.type], ...NUMBER_TESTS] : TESTS[source.type]
}

function firstTest(source: Source): Partial<TemplateVisibilityCondition> {
  return source.type === "checkbox_field"
    ? { sourceBlockId: source.id, operator: "equals", value: true }
    : source.type === "dropdown_field"
      ? { sourceBlockId: source.id, operator: "equals", value: source.options[0] }
      : { sourceBlockId: source.id, operator: "answered", value: undefined }
}

function needsValue(row: Row, source: Source): boolean {
  return source.type !== "checkbox_field" && row.operator !== "answered" && row.operator !== "not_answered"
}
