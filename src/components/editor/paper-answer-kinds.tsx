"use client"

import { Plus } from "lucide-react"
import { Fragment, type ReactElement, type ReactNode, useContext } from "react"

import { getGeneratedDocumentAnswerName } from "@/components/documents/generated-document-form-data"
import { PageBreaks } from "@/components/editor/table-cells"
import { cn } from "@/lib/utils"
import type { ChoiceGridFieldBlock, TableFieldBlock } from "@/types/template"
import { MAX_TABLE_FIELD_ROWS } from "@/types/template-answer-kinds"
import { tableTotalRow } from "@/types/template-formula"

// The printed edge of a checkbox, a signature's line, a boxed section, a
// grid's rules and a table's cells. An answer box's edge is fainter, the
// page's own border colour, as it prints.
export const EDGE = "rgb(156 163 176)"
export const RULE = `0.07em solid ${EDGE}`

type Mode = "design" | "fill" | "read"

// Container widths, in ems, below which a grid or table no longer fits as one
// and shows a statement or row at a time. Written out whole so the styles exist.
const NARROW = [
  { below: 16, narrow: "hidden flex-col @max-[16em]:flex", wide: "@max-[16em]:hidden" },
  { below: 22, narrow: "hidden flex-col @max-[22em]:flex", wide: "@max-[22em]:hidden" },
  { below: 28, narrow: "hidden flex-col @max-[28em]:flex", wide: "@max-[28em]:hidden" },
  { below: 36, narrow: "hidden flex-col @max-[36em]:flex", wide: "@max-[36em]:hidden" },
  { below: 44, narrow: "hidden flex-col @max-[44em]:flex", wide: "@max-[44em]:hidden" },
] as const

/**
 * When a grid or table changes to its narrow form: only once it no longer
 * fits, so a small one looks the same on a phone as on the page.
 *
 * @param needed - The width it needs, in ems.
 * @returns The classes for its wide and its narrow form.
 */
function narrowBelow(needed: number): (typeof NARROW)[number] {
  return NARROW.find((step) => step.below >= needed) ?? NARROW[NARROW.length - 1]
}

// A choice's column: wide enough for its words, and for a finger.
const choiceWidth = (options: readonly string[]): number => Math.max(3.2, ...options.map((option) => option.length * 0.55 + 1.2))
// A column's room by what it holds: a date's picker needs the most.
const COLUMN_WIDTH = { date: 8.5, money: 5, number: 5, text: 7, time: 5.5 } as const

/**
 * A grid's answer: the choice made on each statement, by its words.
 *
 * @param value - Whatever the answers hold for the grid.
 * @returns Each statement's choice, ignoring anything that is not one.
 */
export function readGridAnswer(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
}

/**
 * A table's answer: its rows of cells.
 *
 * @param value - Whatever the answers hold for the table.
 * @param columns - How many cells a row has.
 * @returns The rows, each as wide as the table.
 */
export function readTableAnswer(value: unknown, columns: number): string[][] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => Array.from({ length: columns }, (_, at) => (typeof row[at] === "string" ? (row[at] as string) : "")))
}

// What a form posts for an answer that is more than one word: the whole of it, as JSON.
function JsonAnswer({ fieldKey, name, value }: { fieldKey: string; name?: string; value: unknown }): ReactElement {
  return <input name={name ?? getGeneratedDocumentAnswerName("json", fieldKey)} type="hidden" value={JSON.stringify(value)} />
}

/**
 * Statements against shared choices, as the PDF draws them: the choices along
 * the top, a circle under each on every statement's row, rules between rows.
 * Too narrow for that, as on a phone, each statement shows its choices beneath.
 *
 * @param props - The grid, how it shows, its answer and where a change goes.
 * @returns The grid.
 */
export function PaperGrid({
  block,
  mode,
  name,
  onChange,
  value,
}: {
  /** The form name its answer posts under; a document's own by default. */
  name?: string
  block: ChoiceGridFieldBlock
  mode: Mode
  // Only filling in changes it; a page drawn on the server passes none.
  onChange?: (value: Record<string, string>) => void
  value: unknown
}): ReactElement {
  const answer = readGridAnswer(value)
  const fill = mode === "fill"
  // The statements need some room beside the choices; they wrap within it.
  const fit = narrowBelow(8 + block.options.length * choiceWidth(block.options))
  // Every choice's column as wide as the widest choice needs, as it prints
  // (36 points, or its 8-point words and 8 more), leaving the statements 40%.
  const longest = Math.max(...block.options.map((option) => option.length))
  const optionWidth = `min(calc(${Math.max(3.6, longest * 0.48 + 0.8)}em / 0.8), calc(60% / ${block.options.length}))`
  const Choice = fill ? "label" : "span"
  const mark = (row: string, option: string, rowIndex: number): ReactNode => {
    const chosen = mode !== "design" && answer[row] === option

    return (
      <>
        {fill ? (
          <input
            aria-label={`${row}: ${option}`}
            checked={chosen}
            className="peer absolute inset-0 m-auto size-[1em] cursor-pointer opacity-0"
            name={`${block.id}-row-${rowIndex}`}
            onChange={() => onChange?.({ ...answer, [row]: option })}
            type="radio"
            value={option}
          />
        ) : null}
        <span
          aria-hidden="true"
          className="pointer-events-none flex size-[1em] shrink-0 items-center justify-center rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-ring/40"
          style={{ border: RULE }}
        >
          {chosen ? <span className="size-[0.5em] rounded-full bg-current" /> : null}
        </span>
        {chosen && !fill ? <span className="sr-only">Chosen: {option}</span> : null}
      </>
    )
  }

  return (
    <div className="@container" data-slot="paper-grid">
      {fill ? <JsonAnswer fieldKey={block.fieldKey} name={name} value={answer} /> : null}
      <table className={cn("w-full border-collapse", fit.wide)} style={{ lineHeight: 1.5 }}>
        <thead>
          <tr style={{ borderBottom: RULE }}>
            <td />
            {block.options.map((option) => (
              <th className="text-center font-normal text-muted-foreground" key={option} scope="col" style={{ fontSize: "0.8em", lineHeight: 1.25, padding: "0.5em 0.25em", width: optionWidth }}>
                {option}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={row} style={{ borderBottom: RULE }}>
              <th className="text-left font-normal" scope="row" style={{ padding: "0.4em 0.6em 0.4em 0" }}>
                {row}
              </th>
              {block.options.map((option) => (
                <td className="text-center" key={option}>
                  <Choice className="relative inline-flex size-[1.6em] items-center justify-center">{mark(row, option, rowIndex)}</Choice>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {/* Narrow: each statement, then its choices across beneath it. */}
      <div className={fit.narrow} role={fill ? "group" : undefined}>
        {block.rows.map((row, rowIndex) => (
          <div key={row} role={fill ? "radiogroup" : undefined} aria-label={fill ? row : undefined} style={{ borderBottom: RULE, lineHeight: 1.5, padding: "0.4em 0" }}>
            <span className="block">{row}</span>
            <span className="flex flex-wrap" style={{ gap: "0.3em 1.4em" }}>
              {block.options.map((option) => (
                <Choice className="relative flex items-center gap-[0.5em]" key={option}>
                  <span className="relative flex">{mark(row, option, rowIndex + block.rows.length)}</span>
                  {option}
                </Choice>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * A table filled in row by row, as the PDF draws it: the column names along
 * the top, then its rows, answered ones first and blank ones to its length.
 * Too narrow for its columns, as on a phone, each row shows as its own list.
 *
 * @param props - The table, how it shows, its answer and where a change goes.
 * @returns The table.
 */
export function PaperTable({
  block,
  mode,
  name,
  onChange,
  value,
}: {
  /** The form name its answer posts under; a document's own by default. */
  name?: string
  block: TableFieldBlock
  mode: Mode
  // Only filling in changes it; a page drawn on the server passes none.
  onChange?: (value: string[][]) => void
  value: unknown
}): ReactElement {
  const fill = mode === "fill"
  const breaks = useContext(PageBreaks)
  const answered = mode === "design" ? [] : readTableAnswer(value, block.columns.length)
  const blank = (): string[] => block.columns.map(() => "")
  const rows = [...answered, ...Array.from({ length: Math.max(0, block.rows - answered.length) }, blank)]
  // Every row shown is kept as it is, blank ones too, so a row stays where it
  // was typed; saving leaves the wholly blank ones off.
  const write = (rowIndex: number, column: number, text: string): void =>
    onChange?.(rows.map((row, at) => (at === rowIndex ? row.map((cell, index) => (index === column ? text : cell)) : row)))
  // A phone's list repeats the table's cells; it names its rows on from the table's, so no two share a name.
  const cell = (rowIndex: number, column: number, text: string, named = rowIndex): ReactNode =>
    block.columns[column]?.formula !== undefined ? (
      // A worked-out cell is never typed: it shows what its formula gives, and while built, the formula.
      mode === "design" ? (
        // One line, so a long formula never makes its row, or a thumbnail's, taller.
        rowIndex === 0 ? <span className="block truncate text-muted-foreground">= {block.columns[column]?.formula}</span> : null
      ) : (
        <output aria-label={`${block.columns[column]?.label ?? ""}, row ${named + 1}`}>{text}</output>
      )
    ) : fill ? (
      <input
        aria-label={`${block.columns[column]?.label ?? ""}, row ${named + 1}`}
        className="w-full min-w-0 bg-transparent outline-none"
        inputMode={block.columns[column]?.format === "number" || block.columns[column]?.format === "money" ? "decimal" : undefined}
        maxLength={500}
        onChange={(event) => write(rowIndex, column, event.target.value)}
        type={block.columns[column]?.format === "date" ? "date" : block.columns[column]?.format === "time" ? "time" : "text"}
        value={text}
      />
    ) : (
      <span className="whitespace-pre-wrap">{text}</span>
    )
  const canAdd = fill && block.addRows === true && rows.length < MAX_TABLE_FIELD_ROWS
  const total = mode === "design" ? null : tableTotalRow(block, rows)
  // Columns share the width equally, as in print, so the widest need sets every column's.
  const fit = narrowBelow(block.columns.length * Math.max(...block.columns.map((column) => COLUMN_WIDTH[column.format ?? "text"])))

  return (
    <div className="@container" data-slot="paper-table">
      {fill ? <JsonAnswer fieldKey={block.fieldKey} name={name} value={answered} /> : null}
      <table className={cn("w-full table-fixed border-collapse", fit.wide)} style={{ lineHeight: 1.5 }}>
        <thead>
          <tr style={{ background: "color-mix(in oklab, var(--doc-primary) 8%, transparent)" }}>
            {block.columns.map((column) => (
              <th className="text-left font-bold" key={column.label} scope="col" style={{ border: RULE, fontSize: "0.9em", lineHeight: 13 / 9, padding: "calc(0.4em / 0.9)" }}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <Fragment key={rowIndex}>
              {/* A page ends before this row: the space to the next page's margin. */}
              {breaks[`${block.id}:row${rowIndex}`] ? (
                <tr aria-hidden="true" style={{ display: "var(--page-space-display, table-row)" }}>
                  <td colSpan={block.columns.length} style={{ border: 0, height: breaks[`${block.id}:row${rowIndex}`], padding: 0 }} />
                </tr>
              ) : null}
              {/* The first row stays with the heading row, so a page never ends between them. */}
              <tr data-row-key={rowIndex > 0 ? `${block.id}:row${rowIndex}` : undefined}>
                {row.map((text, column) => (
                  <td className="align-top focus-within:ring-2 focus-within:ring-ring/40 focus-within:ring-inset" key={column} style={{ border: RULE, height: "2em", padding: "0.25em 0.4em" }}>
                    {cell(rowIndex, column, text)}
                  </td>
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
        {total ? (
          <tfoot>
            <tr className="font-bold">
              {total.map((text, column) => (
                <td key={column} style={{ border: RULE, padding: "0.25em 0.4em" }}>
                  {text}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
      {/* Narrow: each row as its own list of the columns. */}
      <div className={fit.narrow} style={{ gap: "0.6em" }}>
        {rows.map((row, rowIndex) => (
          <div aria-label={`Row ${rowIndex + 1}`} key={rowIndex} role="group" style={{ border: RULE, lineHeight: 1.5, padding: "0.4em 0.6em" }}>
            {row.map((text, column) => (
              <div className="flex gap-[0.6em]" key={column} style={{ borderBottom: column < row.length - 1 ? RULE : undefined, padding: "0.2em 0" }}>
                <span className="w-2/5 shrink-0 font-bold" style={{ fontSize: "0.9em" }}>
                  {block.columns[column]?.label}
                </span>
                <span className="min-w-0 flex-1">{cell(rowIndex, column, text, rowIndex + rows.length)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {total ? (
        <div className={cn(fit.narrow, "font-bold")} role="group" aria-label="Total" style={{ border: RULE, marginTop: "0.6em", padding: "0.4em 0.6em" }}>
          {block.columns.map((column, at) =>
            column.total ? (
              <div className="flex gap-[0.6em]" key={at}>
                <span className="w-2/5 shrink-0">Total {column.label}</span>
                <span className="min-w-0 flex-1">{total[at]}</span>
              </div>
            ) : null
          )}
        </div>
      ) : null}
      {canAdd ? (
        <button
          className="mt-[0.4em] inline-flex items-center gap-[0.3em] text-[0.9em] text-muted-foreground hover:text-foreground"
          onClick={() => onChange?.([...rows, blank()])}
          type="button"
        >
          <Plus className="size-[1em]" />
          Add a row
        </button>
      ) : null}
    </div>
  )
}
