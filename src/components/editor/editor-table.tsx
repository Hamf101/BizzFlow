"use client"

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Trash2 } from "lucide-react"
import { Fragment, type KeyboardEvent, type ReactElement, useRef, useState } from "react"

import { EditableText } from "@/components/editor/editable-text"
import type { CanvasActions } from "@/components/editor/editor-block"
import { editTable, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, type TableEdit } from "@/components/editor/table-edit"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { TemplateBlock } from "@/types/template"

type TableBlock = Extract<TemplateBlock, { type: "table" }>
type Cell = Readonly<{ column: number; row: number }>

/**
 * A table typed into cell by cell. Tab moves to the next cell and, from the
 * last one, adds a row. Rows and columns come and go from the menu a cell
 * opens with a right-click, a long press or the menu key; on a touch screen a
 * button for the same menu floats over the table while a cell is being typed in.
 *
 * @param props - The table, the canvas's actions, and the page breaks inside it.
 * @returns The table.
 */
export function EditorTable({
  actions,
  block,
  breaks,
}: {
  actions: CanvasActions
  block: TableBlock
  breaks: Readonly<Record<string, number>>
}): ReactElement {
  const { controller } = actions
  const table = useRef<HTMLTableElement>(null)
  // The heading row is row -1.
  const [cell, setCell] = useState<Cell>({ column: 0, row: 0 })

  function change(edit: TableEdit, at: Cell = cell): void {
    controller.updateBlock(editTable(block, edit, at.row, at.column))
  }

  function write(at: Cell, text: string): void {
    const put = (values: readonly string[]): string[] => values.map((value, column) => (column === at.column ? text : value))

    controller.updateBlock(
      at.row < 0 ? { ...block, headers: put(block.headers) } : { ...block, rows: block.rows.map((row, index) => (index === at.row ? put(row) : row)) },
      `table:${block.id}`
    )
  }

  function keyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Enter") {
      event.preventDefault()
    }

    if (event.key !== "Tab") {
      return
    }

    const cells = [...(table.current?.querySelectorAll<HTMLElement>("[contenteditable]") ?? [])]
    const next = cells.indexOf(event.currentTarget) + (event.shiftKey ? -1 : 1)

    if (next >= 0 && next < cells.length) {
      event.preventDefault()
      cells[next]?.focus()
    } else if (!event.shiftKey && block.rows.length < MAX_TABLE_ROWS) {
      // Tab from the last cell starts a row, as in Google Docs.
      event.preventDefault()
      change("row-after", { column: 0, row: block.rows.length - 1 })
      requestAnimationFrame(() => table.current?.querySelectorAll<HTMLElement>("[contenteditable]")[cells.length]?.focus())
    }
  }

  const menu = (
    <DropdownMenuContent className="w-52">
      <DropdownMenuItem disabled={cell.row < 0 || block.rows.length >= MAX_TABLE_ROWS} onClick={() => change("row-before")}>
        <ArrowUp aria-hidden="true" />
        Insert row above
      </DropdownMenuItem>
      <DropdownMenuItem disabled={block.rows.length >= MAX_TABLE_ROWS} onClick={() => change("row-after")}>
        <ArrowDown aria-hidden="true" />
        Insert row below
      </DropdownMenuItem>
      <DropdownMenuItem disabled={block.headers.length >= MAX_TABLE_COLUMNS} onClick={() => change("column-before")}>
        <ArrowLeft aria-hidden="true" />
        Insert column left
      </DropdownMenuItem>
      <DropdownMenuItem disabled={block.headers.length >= MAX_TABLE_COLUMNS} onClick={() => change("column-after")}>
        <ArrowRight aria-hidden="true" />
        Insert column right
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={cell.row < 0} onClick={() => change("delete-row")} variant="destructive">
        <Trash2 aria-hidden="true" />
        Delete row
      </DropdownMenuItem>
      <DropdownMenuItem disabled={block.headers.length <= 1} onClick={() => change("delete-column")} variant="destructive">
        <Trash2 aria-hidden="true" />
        Delete column
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => controller.remove(block.id)} variant="destructive">
        <Trash2 aria-hidden="true" />
        Delete table
      </DropdownMenuItem>
    </DropdownMenuContent>
  )

  const cellProps = (at: Cell, value: string) => ({
    caretKey: `${block.id}:${at.row < 0 ? `h${at.column}` : `${at.row}-${at.column}`}`,
    editable: actions.textEditable,
    label: at.row < 0 ? `Column ${at.column + 1} heading` : `Row ${at.row + 1}, column ${at.column + 1}`,
    onChange: (text: string) => write(at, text),
    onFocus: () => setCell(at),
    onKeyDown: keyDown,
    value,
  })

  return (
    <div className="group/table relative">
      {actions.textEditable ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                className="invisible absolute bottom-full left-0 mb-1 h-9 bg-popover shadow-sm pointer-coarse:group-focus-within/table:visible data-popup-open:visible"
                size="sm"
                type="button"
                variant="outline"
              >
                Rows and columns
              </Button>
            }
          />
          {menu}
        </DropdownMenu>
      ) : null}
      <ContextMenu disabled={!actions.textEditable}>
        <ContextMenuTrigger render={<div />}>
          <table
            className="w-full border-collapse"
            // A right-click chooses its cell before the menu opens.
            onContextMenu={(event) => setCell((current) => cellOf(event.target, block.id) ?? current)}
            ref={table}
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
        </ContextMenuTrigger>
        {menu}
      </ContextMenu>
    </div>
  )
}

// The cell an element is in, from the caret key its text carries.
function cellOf(target: EventTarget, blockId: string): Cell | null {
  const [owner, place = ""] = ((target as Element).closest?.("[data-caret-key]")?.getAttribute("data-caret-key") ?? "").split(":")
  const heading = /^h(\d+)$/.exec(place)
  const body = /^(\d+)-(\d+)$/.exec(place)

  if (owner !== blockId) {
    return null
  }

  return heading ? { column: Number(heading[1]), row: -1 } : body ? { column: Number(body[2]), row: Number(body[1]) } : null
}
