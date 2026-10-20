"use client"

import {
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type RefObject,
  useEffect,
  useId,
  useState,
} from "react"

import { columnLabel } from "@/lib/sheet/a1"
import { cellAddress, type Point, type Range } from "@/lib/sheet/edit"
import { formatCellValue, type DisplayOptions } from "@/lib/sheet/format"
import { isError, type CellValue } from "@/lib/sheet/values"
import { cn } from "@/lib/utils"
import { SHEET_COLUMNS, SHEET_ROWS, type SheetContent } from "@/types/sheet"

type Tab = SheetContent["tabs"][number]

export const ROW_HEIGHT = 28
const HEADER_HEIGHT = 24
const ROW_HEADER_WIDTH = 44
export const COLUMN_WIDTH = 96
const OVERSCAN = 8

/** What each error means, in plain words, for its tooltip. */
const ERROR_HELP: Record<string, string> = {
  "#DIV/0!": "This divides by zero or by an empty cell.",
  "#VALUE!": "A value here is the wrong kind, such as text where a number belongs.",
  "#REF!": "This reads a cell that no longer exists, such as one in a deleted row.",
  "#NAME?": "This uses a function or name the sheet doesn't know. Check the spelling.",
  "#N/A": "A lookup didn't find what it was looking for.",
  "#NUM!": "A number here is too large, too small or impossible to work out.",
  "#CIRC!": "This formula reads itself, through its own cell or a chain of cells.",
  "#ERROR!": "This formula can't be read. Check its brackets, commas and quotes.",
}

/** A block of cells outlined in a colour, as the selected formula reads it. */
export type Outline = Range & { color: string }

/** What the grid asks of its editor. */
export type GridActions = Readonly<{
  cancel: () => void
  /** Saves what is being typed, then moves the selection by (rows, columns). */
  commit: (move?: { rows: number; cols: number }) => void
  copy: (event: ClipboardEvent, cut: boolean) => void
  /** Clears the selected cells' contents. */
  clear: () => void
  fillDown: () => void
  paste: (event: ClipboardEvent) => void
  resizeColumn: (col: number, width: number) => void
  select: (anchor: Point, focus: Point) => void
  /** Starts typing into the cell, replacing it (a key) or from its contents (F2, double-click, a second tap). */
  startEditing: (text: string | null) => void
  type: (text: string) => void
}>

type SheetGridProps = {
  actions: GridActions
  display: DisplayOptions
  /** The text in the cell while it is typed into; null when not editing in place. */
  editingText: string | null
  gridRef: RefObject<HTMLDivElement | null>
  label: string
  narrow: boolean
  outlines: readonly Outline[]
  readOnly: boolean
  selection: { anchor: Point; focus: Point }
  tab: Tab
  values: ReadonlyMap<string, CellValue> | null
}

/**
 * The cells of one tab: column letters and row numbers pinned, only the rows
 * in view drawn, a keyboard and a pointer to move and select, and the cells
 * the selected formula reads outlined in their colours.
 *
 * @param props - The tab, its worked-out values, the selection and what to do.
 * @returns The grid.
 */
export function SheetGrid({
  actions,
  display,
  editingText,
  gridRef,
  label,
  narrow,
  outlines,
  readOnly,
  selection,
  tab,
  values,
}: SheetGridProps): ReactElement {
  const id = useId()
  const [view, setView] = useState({ top: 0, left: 0, height: 800 })
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState<{ col: number; width: number } | null>(null)
  const frozen = Math.min(tab.frozenRows ?? 0, SHEET_ROWS)
  const widths = Array.from({ length: SHEET_COLUMNS }, (_, col) =>
    resizing?.col === col ? resizing.width : (tab.cols?.[columnLabel(col)] ?? COLUMN_WIDTH)
  )
  const lefts = widths.reduce<number[]>((at, width) => [...at, at.at(-1)! + width], [ROW_HEADER_WIDTH])
  const range = {
    top: Math.min(selection.anchor.row, selection.focus.row),
    bottom: Math.max(selection.anchor.row, selection.focus.row),
    left: Math.min(selection.anchor.col, selection.focus.col),
    right: Math.max(selection.anchor.col, selection.focus.col),
  }
  const { focus } = selection
  const first = Math.max(frozen, Math.floor(view.top / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(SHEET_ROWS - 1, Math.ceil((view.top + view.height) / ROW_HEIGHT) + OVERSCAN)
  const cellId = (row: number, col: number) => `${id}-${cellAddress(row, col)}`

  // The selected cell scrolls into view, clear of the pinned headers.
  useEffect(() => {
    const scroller = gridRef.current
    if (!scroller) return
    const top = HEADER_HEIGHT + focus.row * ROW_HEIGHT
    const pinned = HEADER_HEIGHT + frozen * ROW_HEIGHT
    if (focus.row >= frozen && top - pinned < scroller.scrollTop) scroller.scrollTop = top - pinned
    else if (top + ROW_HEIGHT > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + ROW_HEIGHT - scroller.clientHeight
    const left = lefts[focus.col]!
    const right = lefts[focus.col + 1]!
    if (left - ROW_HEADER_WIDTH < scroller.scrollLeft) scroller.scrollLeft = left - ROW_HEADER_WIDTH
    else if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = right - scroller.clientWidth
    // Only a move of the selection scrolls; widths changing under it don't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.row, focus.col, frozen, gridRef])

  useEffect(() => {
    const scroller = gridRef.current
    if (!scroller) return
    const measure = () => setView((current) => ({ ...current, height: scroller.clientHeight || current.height }))
    measure()
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null
    observer?.observe(scroller)
    return () => observer?.disconnect()
  }, [gridRef])

  function move(rows: number, cols: number, extend: boolean): void {
    const next = { row: clampTo(focus.row + rows, SHEET_ROWS), col: clampTo(focus.col + cols, SHEET_COLUMNS) }
    actions.select(extend ? selection.anchor : next, next)
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) return
    const mod = event.metaKey || event.ctrlKey
    const arrows: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const arrow = arrows[event.key]

    if (arrow) {
      event.preventDefault()
      move(arrow[0], arrow[1], event.shiftKey)
    } else if (event.key === "Enter") {
      event.preventDefault()
      move(event.shiftKey ? -1 : 1, 0, false)
    } else if (event.key === "Tab") {
      // At the grid's edge Tab leaves it, so the keyboard is never trapped.
      const col = focus.col + (event.shiftKey ? -1 : 1)
      if (col < 0 || col >= SHEET_COLUMNS) return
      event.preventDefault()
      move(0, event.shiftKey ? -1 : 1, false)
    } else if (event.key === "Escape") {
      actions.select(focus, focus)
    } else if (readOnly) {
      return
    } else if (event.key === "F2") {
      event.preventDefault()
      actions.startEditing(null)
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault()
      actions.clear()
    } else if (mod && event.key.toLowerCase() === "d") {
      event.preventDefault()
      actions.fillDown()
    } else if (event.key.length === 1 && !mod && !event.altKey) {
      event.preventDefault()
      actions.startEditing(event.key)
    }
  }

  function cellAt(target: EventTarget | null): Point | null {
    const cell = (target as HTMLElement | null)?.closest<HTMLElement>("[data-row]")
    return cell ? { row: Number(cell.dataset.row), col: Number(cell.dataset.col) } : null
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    const point = cellAt(event.target)
    if (!point || event.button !== 0) return
    const again = point.row === focus.row && point.col === focus.col && range.top === range.bottom && range.left === range.right
    // A phone's second tap on the chosen cell types into it; a pointer drags out a block.
    if (event.pointerType === "touch" || narrow) {
      if (again && !readOnly) actions.startEditing(null)
      else actions.select(point, point)
      return
    }
    actions.select(event.shiftKey ? selection.anchor : point, point)
    setDragging(true)
  }

  function cell(row: number, col: number): ReactElement {
    const address = cellAddress(row, col)
    const stored = tab.cells[address]
    const value = values?.get(`${tab.id}!${address}`) ?? (stored?.f === undefined ? (stored?.v ?? null) : null)
    const text = formatCellValue(value, stored?.fmt, display)
    const error = isError(value) ? value.error : null
    const align = stored?.fmt?.align ?? (typeof value === "number" ? "right" : typeof value === "boolean" || error ? "center" : "left")
    const selected = row >= range.top && row <= range.bottom && col >= range.left && col <= range.right

    return (
      <div
        aria-colindex={col + 2}
        aria-selected={selected}
        className={cn(
          "h-full shrink-0 truncate border-r border-b border-border/70 px-1.5 leading-[27px]",
          align === "right" && "text-right",
          align === "center" && "text-center",
          stored?.fmt?.bold && "font-semibold",
          error && "text-destructive",
          selected && "bg-primary/8"
        )}
        data-col={col}
        data-row={row}
        id={cellId(row, col)}
        key={col}
        role="gridcell"
        style={{ width: widths[col] }}
        title={error ? ERROR_HELP[error] : undefined}
      >
        {text}
      </div>
    )
  }

  function row(index: number, pinned: boolean): ReactElement {
    return (
      <div
        aria-rowindex={index + 2}
        className={cn("flex", pinned ? "relative" : "absolute left-0")}
        key={index}
        role="row"
        style={{ height: ROW_HEIGHT, ...(pinned ? {} : { top: HEADER_HEIGHT + index * ROW_HEIGHT }), width: lefts.at(-1) }}
      >
        <div
          className="sticky left-0 z-10 h-full shrink-0 border-r border-b border-border bg-muted text-center text-xs leading-[27px] text-muted-foreground tabular-nums"
          role="rowheader"
          style={{ width: ROW_HEADER_WIDTH }}
        >
          {index + 1}
        </div>
        {widths.map((_, col) => cell(index, col))}
      </div>
    )
  }

  const box = (area: Range) => ({
    left: lefts[area.left],
    top: HEADER_HEIGHT + area.top * ROW_HEIGHT,
    width: lefts[area.right + 1]! - lefts[area.left]!,
    height: (area.bottom - area.top + 1) * ROW_HEIGHT,
  })

  return (
    <div
      aria-activedescendant={cellId(focus.row, focus.col)}
      aria-colcount={SHEET_COLUMNS + 1}
      aria-label={label}
      aria-multiselectable
      aria-readonly={readOnly || undefined}
      aria-rowcount={SHEET_ROWS + 1}
      className="relative min-h-0 flex-1 overflow-auto bg-card text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
      data-slot="sheet-grid"
      onCopy={(event) => actions.copy(event, false)}
      onCut={(event) => (readOnly ? undefined : actions.copy(event, true))}
      onDoubleClick={(event) => (!readOnly && cellAt(event.target) ? actions.startEditing(null) : undefined)}
      onKeyDown={handleKey}
      onPaste={(event) => (readOnly ? undefined : actions.paste(event))}
      onPointerDown={handlePointerDown}
      onPointerMove={(event) => {
        const point = dragging && event.buttons === 1 ? cellAt(event.target) : null
        if (point && (point.row !== focus.row || point.col !== focus.col)) actions.select(selection.anchor, point)
      }}
      onPointerUp={() => setDragging(false)}
      onScroll={(event) => setView({ ...view, top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}
      ref={gridRef}
      role="grid"
      tabIndex={0}
    >
      <div className="relative" style={{ height: HEADER_HEIGHT + SHEET_ROWS * ROW_HEIGHT, width: lefts.at(-1) }}>
        <div className="sticky top-0 z-20" role="rowgroup">
          <div aria-rowindex={1} className="flex" role="row" style={{ height: HEADER_HEIGHT }}>
            <div className="sticky left-0 z-10 shrink-0 border-r border-b border-border bg-muted" style={{ width: ROW_HEADER_WIDTH }} />
            {widths.map((width, col) => (
              <div
                className={cn(
                  "relative shrink-0 border-r border-b border-border bg-muted text-center text-xs leading-[23px] text-muted-foreground",
                  col >= range.left && col <= range.right && "bg-accent text-accent-foreground"
                )}
                key={col}
                role="columnheader"
                style={{ width }}
              >
                {columnLabel(col)}
                {readOnly ? null : (
                  <ColumnEdge
                    col={col}
                    onDone={(next) => {
                      setResizing(null)
                      actions.resizeColumn(col, next)
                    }}
                    onMove={(next) => setResizing({ col, width: next })}
                    width={width}
                  />
                )}
              </div>
            ))}
          </div>
          {Array.from({ length: frozen }, (_, index) => row(index, true))}
          {frozen > 0 ? <div aria-hidden="true" className="h-0.5 bg-border" /> : null}
        </div>
        {Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => row(first + index, false))}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-[5] border-2 border-primary"
          data-slot="sheet-selection"
          style={box(range)}
        />
        {outlines.map((outline, index) => (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-[5] border-2 border-dashed"
            data-slot="sheet-reference"
            key={index}
            style={{ ...box(outline), borderColor: outline.color }}
          />
        ))}
        {editingText !== null ? (
          <CellInput actions={actions} style={box({ top: focus.row, bottom: focus.row, left: focus.col, right: focus.col })} text={editingText} />
        ) : null}
      </div>
    </div>
  )
}

const clampTo = (value: number, size: number) => Math.min(size - 1, Math.max(0, value))

// Typing in place, over the cell: Enter and Tab save and move on, Escape puts it back.
function CellInput({ actions, style, text }: { actions: GridActions; style: object; text: string }): ReactElement {
  return (
    <input
      aria-label="Cell contents"
      autoFocus
      className="absolute z-[6] min-w-0 border-2 border-primary bg-card px-1 text-[13px] outline-none"
      data-slot="sheet-cell-input"
      maxLength={5000}
      // Clicking into the formula bar carries the typing on there.
      onBlur={(event) => ((event.relatedTarget as HTMLElement | null)?.closest("[data-slot=sheet-formula-bar]") ? undefined : actions.commit())}
      onChange={(event) => actions.type(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === "Enter") {
          event.preventDefault()
          actions.commit({ rows: event.shiftKey ? -1 : 1, cols: 0 })
        } else if (event.key === "Tab") {
          event.preventDefault()
          actions.commit({ rows: 0, cols: event.shiftKey ? -1 : 1 })
        } else if (event.key === "Escape") {
          event.preventDefault()
          actions.cancel()
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      style={style}
      value={text}
    />
  )
}

// The edge of a column's letter: drag it, or use the arrow keys, to set the width.
function ColumnEdge({
  col,
  onDone,
  onMove,
  width,
}: {
  col: number
  onDone: (width: number) => void
  onMove: (width: number) => void
  width: number
}): ReactElement {
  const fit = (next: number) => Math.min(2000, Math.max(24, Math.round(next)))

  return (
    <div
      aria-label={`Width of column ${columnLabel(col)}`}
      aria-orientation="vertical"
      aria-valuemax={2000}
      aria-valuemin={24}
      aria-valuenow={width}
      className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize outline-none hover:bg-primary/40 focus-visible:bg-primary/60"
      onKeyDown={(event) => {
        const step = event.key === "ArrowRight" ? 8 : event.key === "ArrowLeft" ? -8 : 0
        if (!step) return
        event.preventDefault()
        event.stopPropagation()
        onDone(fit(width + step))
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        const start = event.clientX
        const element = event.currentTarget
        let next = width
        const moved = (move: globalThis.PointerEvent) => onMove((next = fit(width + move.clientX - start)))
        const ended = () => {
          element.removeEventListener("pointermove", moved)
          element.removeEventListener("pointerup", ended)
          element.removeEventListener("pointercancel", ended)
          onDone(next)
        }
        element.addEventListener("pointermove", moved)
        element.addEventListener("pointerup", ended)
        element.addEventListener("pointercancel", ended)
      }}
      role="separator"
      tabIndex={0}
    />
  )
}
