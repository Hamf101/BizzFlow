import { Fragment, type MouseEvent, type ReactElement, type Ref } from "react"

import { EditableText } from "@/components/editor/editable-text"
import type { TemplateBlock } from "@/types/template"

export type TableBlock = Extract<TemplateBlock, { type: "table" }>
/** A cell; the heading row is row -1. */
export type Cell = Readonly<{ column: number; row: number }>

type CellProps = Omit<Parameters<typeof EditableText>[0], "as" | "className">

/**
 * A table's cells as the page shows them, typed into or only read. Editing
 * wraps it in its menus; a page that is only read or filled in shows it alone.
 *
 * @param props - The table, the page breaks inside it, and each cell's text and behaviour.
 * @returns The table.
 */
export function TableCells({
  block,
  breaks,
  cellProps,
  onContextMenu,
  tableRef,
}: {
  block: TableBlock
  breaks: Readonly<Record<string, number>>
  cellProps: (at: Cell, value: string) => CellProps
  onContextMenu?: (event: MouseEvent<HTMLTableElement>) => void
  tableRef?: Ref<HTMLTableElement>
}): ReactElement {
  return (
    <table
      className="w-full border-collapse"
      onContextMenu={onContextMenu}
      ref={tableRef}
      style={{ fontSize: "0.9em", lineHeight: 1.4 }}
    >
      <thead>
        <tr>
          {block.headers.map((header: string, column: number) => (
            <EditableText
              as="th"
              className="border border-border bg-muted/50 px-[0.6em] py-[0.4em] text-left font-semibold"
              key={column}
              {...cellProps({ column, row: -1 }, header)}
            />
          ))}
        </tr>
      </thead>
      <tbody>
        {block.rows.map((row: string[], rowIndex: number) => (
          <Fragment key={rowIndex}>
            {breaks[`${block.id}:row${rowIndex}`] ? (
              <tr aria-hidden="true" style={{ display: "var(--page-space-display, table-row)" }}>
                <td colSpan={block.headers.length} style={{ border: 0, height: breaks[`${block.id}:row${rowIndex}`], padding: 0 }} />
              </tr>
            ) : null}
            {/* The first row stays with the heading row, so a page never ends between them. */}
            <tr data-row-key={rowIndex > 0 ? `${block.id}:row${rowIndex}` : undefined}>
              {row.map((value: string, column: number) => (
                <EditableText
                  as="td"
                  className="border border-border px-[0.6em] py-[0.4em] align-top"
                  key={column}
                  {...cellProps({ column, row: rowIndex }, value)}
                />
              ))}
            </tr>
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}

/**
 * The text of a cell that is only read: no typing, nothing to save.
 *
 * @param blockId - The table.
 * @returns Each cell's props.
 */
export function readOnlyCell(blockId: string): (at: Cell, value: string) => CellProps {
  return (at, value) => ({
    caretKey: `${blockId}:${at.row < 0 ? `h${at.column}` : `${at.row}-${at.column}`}`,
    editable: false,
    label: at.row < 0 ? `Column ${at.column + 1} heading` : `Row ${at.row + 1}, column ${at.column + 1}`,
    onChange: () => undefined,
    value,
  })
}
