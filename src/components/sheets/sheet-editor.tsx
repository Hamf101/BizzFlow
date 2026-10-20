"use client"

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ChevronDown,
  DecimalsArrowLeft,
  DecimalsArrowRight,
  MoreHorizontal,
  Plus,
  Trash2,
  UserPlus,
} from "lucide-react"
import { type ClipboardEvent, type ReactElement, type ReactNode, useMemo, useRef, useState, useSyncExternalStore } from "react"

import type { SheetSaveInput } from "@/app/(editor)/documents/[documentId]/edit/sheet-actions"
import { EditorFrame, EditorNotice } from "@/components/editor/editor-frame"
import { ExportMenu, ExportMenuItems, exportLinks } from "@/components/editor/export-menu"
import { ShareDialog } from "@/components/editor/lazy-panels"
import { type SaveResult, useAutosave } from "@/components/editor/use-autosave"
import { useEditorHistory } from "@/components/editor/use-editor-history"
import { FlowLauncher } from "@/components/flow/flow-launcher"
import { type GridActions, type Outline, SheetGrid } from "@/components/sheets/sheet-grid"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTimeZone } from "@/components/ui/local-date"
import { bizflowToast } from "@/components/ui/toaster"
import { columnLabel, parseCellRef } from "@/lib/sheet/a1"
import {
  addTab,
  cellAddress,
  cellInput,
  deleteTab,
  fillDown,
  formatCells,
  moveCells,
  moveLines,
  parseTsv,
  pasteCells,
  type Point,
  type Range,
  rangeOf,
  renameTab,
  toTsv,
  typedCell,
  withCells,
} from "@/lib/sheet/edit"
import { evaluateSheet } from "@/lib/sheet/evaluate"
import { DEFAULT_CURRENCY, formatCellValue } from "@/lib/sheet/format"
import { formulaReferences } from "@/lib/sheet/parse"
import { cn, subscribeNever } from "@/lib/utils"
import type { Sheet } from "@/services/sheet-service"
import { MAX_SHEET_FORMULA_LENGTH, parseSheetContent, type SheetCell, type SheetContent, type SheetFormat } from "@/types/sheet"

type SheetPage = { content: SheetContent; title: string }
type Editing = { address: string; tabId: string; text: string; where: "bar" | "cell" | "dock" }
// What was copied here; a cut also says where from, so pasting moves it rather than copying.
type Clip = { cells: (SheetCell | null)[][]; cut?: { range: Range; tabId: string }; from: Point; tsv: string }

const MAX_TABS = 10
// Each reference in the selected formula, in its own colour, in the bar and on the grid.
const REFERENCE_COLORS = ["var(--primary)", "var(--success)", "var(--warning)", "var(--destructive)"]
const FORMATS: ReadonlyArray<[SheetFormat["type"], string]> = [
  ["general", "General"],
  ["number", "Number"],
  ["money", "Money"],
  ["percent", "Percent"],
  ["date", "Date"],
  ["text", "Text"],
]

type SheetEditorProps = {
  backHref: string
  /** Whether this person may change it: a writer, while it is active. */
  canEdit: boolean
  canShare: boolean
  /** Someone outside the workspace given this one sheet: no Flow, and Back goes to what is shared with them. */
  guest: boolean
  /** The workspace Flow works in; null for a guest. */
  organizationId: string | null
  saveAction: (input: SheetSaveInput) => Promise<SaveResult>
  sheet: Sheet
}

/**
 * A sheet in its editor: a format toolbar, the formula bar, the grid and its
 * tabs. Formulas are worked out when a cell is saved, never per keystroke, and
 * the sheet saves itself shortly after each change.
 *
 * @param props - The sheet, what this person may do, and how to save.
 * @returns The full-screen sheet editor.
 */
export function SheetEditor({ backHref, canEdit, canShare, guest, organizationId, saveAction, sheet }: SheetEditorProps): ReactElement {
  const timeZone = useTimeZone()
  const locale = useSyncExternalStore(subscribeNever, () => navigator.language || "en-US", () => "en-US")
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false)
  const history = useEditorHistory<SheetPage>({ content: sheet.content, title: sheet.title })
  const { content, title } = history.state
  const [tabId, setTabId] = useState(sheet.content.tabs[0]!.id)
  const tab = content.tabs.find((candidate) => candidate.id === tabId) ?? content.tabs[0]!
  const [selection, setSelection] = useState({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } })
  const [editing, setEditingState] = useState<Editing | null>(null)
  const editingRef = useRef<Editing | null>(null)
  const [sharing, setSharing] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const clip = useRef<Clip | null>(null)
  const saved = useRef<SheetPage>(history.state)
  const display = useMemo(() => ({ currency: DEFAULT_CURRENCY, locale }), [locale])
  const range = rangeOf(selection.anchor, selection.focus)
  const active = cellAddress(selection.focus.row, selection.focus.col)
  const activeCell = tab.cells[active]

  // Worked out once per saved change, in the browser only: the server's render shows typed-in values.
  const evaluation = useMemo(() => {
    if (!hydrated) return null
    try {
      return evaluateSheet(content, { now: new Date(), timeZone })
    } catch {
      return "heavy" as const
    }
  }, [content, hydrated, timeZone])
  const values = evaluation && evaluation !== "heavy" ? evaluation.values : null

  const autosave = useAutosave<SheetPage>({
    delay: 800,
    enabled: canEdit,
    initialVersion: sheet.updatedAt,
    save: async (value, version) => {
      const result = await saveAction({
        documentId: sheet.id,
        expectedUpdatedAt: version,
        ...(value.title === saved.current.title ? {} : { title: value.title }),
        ...(value.content === saved.current.content ? {} : { content: value.content }),
      })

      if (result.ok) saved.current = value
      return result
    },
    value: history.state,
  })

  function setEditing(next: Editing | null): void {
    editingRef.current = next
    setEditingState(next)
  }

  function change(update: (current: SheetContent) => SheetContent | null, refusal?: string): void {
    const next = update(content)
    if (!next) {
      if (refusal) bizflowToast.error(refusal)
      return
    }
    history.set((current) => ({ ...current, content: next }))
  }

  function select(anchor: Point, focus: Point): void {
    // Choosing another cell keeps what was typed into the last one, as on a phone's dock.
    const current = editingRef.current
    if (current && (current.tabId !== tab.id || current.address !== cellAddress(focus.row, focus.col))) commit()
    setSelection({ anchor, focus })
  }

  function focusGrid(): void {
    gridRef.current?.focus({ preventScroll: true })
  }

  function commit(move?: { rows: number; cols: number }): void {
    const current = editingRef.current
    if (current) {
      setEditing(null)
      const target = content.tabs.find((candidate) => candidate.id === current.tabId)
      const stored = target?.cells[current.address]
      if (target && current.text !== cellInput(stored)) {
        const next = typedCell(current.text, stored?.fmt)
        if (next?.f !== undefined && next.f.length > MAX_SHEET_FORMULA_LENGTH) {
          bizflowToast.error(`A formula holds at most ${MAX_SHEET_FORMULA_LENGTH} characters.`)
        } else {
          change((sheetContent) => withCells(sheetContent, target.id, new Map([[current.address, next]])))
        }
      }
      if (current.where !== "dock" || move) focusGrid()
    }
    if (move) {
      const next = {
        row: Math.max(0, Math.min(1999, selection.focus.row + move.rows)),
        col: Math.max(0, Math.min(51, selection.focus.col + move.cols)),
      }
      select(next, next)
    }
  }

  function startEditing(text: string | null, where: Editing["where"]): void {
    if (!canEdit) return
    // Typing in the cell, then clicking the formula bar, carries on there.
    if (editingRef.current?.address === active && editingRef.current.tabId === tab.id) {
      setEditing({ ...editingRef.current, where })
      return
    }
    commit()
    setEditing({ address: active, tabId: tab.id, text: text ?? cellInput(activeCell), where })
  }

  function clearRange(): void {
    const updates = new Map<string, SheetCell | null>()
    for (const [address, cell] of Object.entries(tab.cells)) {
      const ref = parseCellRef(address)!
      if (inside(range, ref)) updates.set(address, cell.fmt ? { fmt: cell.fmt } : null)
    }
    if (updates.size > 0) change((current) => withCells(current, tab.id, updates))
  }

  function copy(event: ClipboardEvent, cut: boolean): void {
    if (editingRef.current) return
    event.preventDefault()
    const cells: (SheetCell | null)[][] = []
    const text: string[][] = []
    for (let row = range.top; row <= range.bottom; row += 1) {
      cells.push([])
      text.push([])
      for (let col = range.left; col <= range.right; col += 1) {
        const address = cellAddress(row, col)
        const cell = tab.cells[address] ?? null
        cells.at(-1)!.push(cell)
        text.at(-1)!.push(formatCellValue(values?.get(`${tab.id}!${address}`) ?? cell?.v ?? null, cell?.fmt, display))
      }
    }
    const tsv = toTsv(text)
    event.clipboardData.setData("text/plain", tsv)
    clip.current = { cells, from: { row: range.top, col: range.left }, tsv }
    if (cut && canEdit) {
      clip.current.cut = { range, tabId: tab.id }
      clearRange()
    }
  }

  function paste(event: ClipboardEvent): void {
    if (editingRef.current || !canEdit) return
    const text = event.clipboardData.getData("text/plain")
    if (!text) return
    event.preventDefault()
    const at = { row: range.top, col: range.left }
    // Copied here, the formulas move with the paste; from elsewhere, it is what was typed.
    const ours = clip.current?.tsv === text ? clip.current : null
    const block = ours
      ? ours.cells
      : parseTsv(text).map((line, rows) => line.map((field, cols) => typedCell(field, tab.cells[cellAddress(at.row + rows, at.col + cols)]?.fmt)))
    if (ours?.cut) {
      const cut = ours.cut
      // ponytail: cut to another tab lands as written but leaves what read it behind; follow it there too if asked
      const next = cut.tabId === tab.id ? moveCells(content, tab.id, cut.range, at, block) : pasteCells(content, tab.id, at, block)
      change(() => next)
      // A cut goes down once; pasting it again copies it, as it landed, from where it now is.
      const landed = next.tabs.find((candidate) => candidate.id === tab.id)!.cells
      clip.current = { cells: block.map((line, rows) => line.map((_, cols) => landed[cellAddress(at.row + rows, at.col + cols)] ?? null)), from: at, tsv: ours.tsv }
    } else {
      change((current) => pasteCells(current, tab.id, at, block, ours?.from))
    }
    const height = block.length
    const width = Math.max(...block.map((line) => line.length))
    select(at, { row: Math.min(1999, at.row + height - 1), col: Math.min(51, at.col + width - 1) })
  }

  const actions: GridActions = {
    cancel: () => {
      setEditing(null)
      focusGrid()
    },
    clear: clearRange,
    commit,
    copy,
    fillDown: () => change((current) => fillDown(current, tab.id, range)),
    paste,
    resizeColumn: (col, width) =>
      change((current) => ({
        ...current,
        tabs: current.tabs.map((candidate) =>
          candidate.id === tab.id ? { ...candidate, cols: { ...candidate.cols, [columnLabel(col)]: width } } : candidate
        ),
      })),
    select,
    startEditing: (text) => startEditing(text, "cell"),
    type: (text) => setEditing(editingRef.current && { ...editingRef.current, text }),
  }

  // The formula being read: the one typed so far, or the selected cell's.
  const formulaText = editing && editing.address === active ? editing.text : cellInput(activeCell)
  const references = useMemo(
    () =>
      formulaText.startsWith("=")
        ? formulaReferences(formulaText.slice(1)).map((reference, index) => ({
            ...reference,
            color: REFERENCE_COLORS[index % REFERENCE_COLORS.length]!,
            end: reference.end + 1,
            start: reference.start + 1,
          }))
        : [],
    [formulaText]
  )
  const outlines: Outline[] = references
    .filter((reference) => reference.sheet === null || reference.sheet.toLowerCase() === tab.name.toLowerCase())
    .map(({ color, first, last }) => ({ ...rangeOf(first, last ?? first), color }))

  function format(update: (format: SheetFormat | undefined) => SheetFormat | undefined): void {
    change((current) => formatCells(current, tab.id, range, (old) => tidy(update(old))))
  }

  function lines(axis: "row" | "col", where: "before" | "after" | "delete"): void {
    const count = axis === "row" ? range.bottom - range.top + 1 : range.right - range.left + 1
    const start = axis === "row" ? range.top : range.left
    const at = where === "after" ? start + count : start
    change(
      (current) => moveLines(current, tab.id, axis, at, where === "delete" ? -count : count),
      `There's no room: the last ${axis === "row" ? "row" : "column"} has something in it.`
    )
  }

  function rename(id: string, name: string): void {
    setRenaming(null)
    const before = content.tabs.find((candidate) => candidate.id === id)
    const trimmed = name.trim()
    if (!before || trimmed === before.name) return
    const next = renameTab(content, id, trimmed)
    try {
      parseSheetContent(next)
    } catch {
      bizflowToast.error("A tab name is 1 to 31 characters, unlike any other tab's, without [ ] : * ? / or \\.")
      return
    }
    change(() => next)
  }

  const exports = exportLinks(`/api/sheets/${encodeURIComponent(sheet.id)}`, { sheet: true, tab: tab.id })
  const stats = summarize(tab, range, values)
  const conflict = autosave.status === "conflict"

  return (
    <>
      <EditorFrame
        backHref={backHref}
        backLabel={guest ? "Shared with you" : "Back to Files"}
        banner={
          conflict ? (
            <EditorNotice actions={[{ label: "Reload", onClick: () => window.location.reload() }]}>This sheet changed elsewhere</EditorNotice>
          ) : evaluation === "heavy" ? (
            <EditorNotice actions={[]}>This sheet is too heavy to work out. Simplify its formulas.</EditorNotice>
          ) : null
        }
        canRedo={history.canRedo}
        canUndo={history.canUndo}
        fill
        menu={(narrow) => (
          <>
            {canEdit || narrow ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button aria-label="More" className="size-10" size="icon" title="More" type="button" variant="ghost">
                      <MoreHorizontal />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-52">
                  {canEdit ? (
                    <DropdownMenuCheckboxItem
                      checked={(tab.frozenRows ?? 0) > 0}
                      onCheckedChange={(checked: boolean) =>
                        change((current) => ({
                          ...current,
                          tabs: current.tabs.map((candidate) => {
                            if (candidate.id !== tab.id) return candidate
                            const rest = { ...candidate }
                            delete rest.frozenRows
                            return checked ? { ...rest, frozenRows: 1 } : rest
                          }),
                        }))
                      }
                    >
                      Freeze top row
                    </DropdownMenuCheckboxItem>
                  ) : null}
                  {narrow ? <ExportMenuItems heading={canEdit} links={exports} /> : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {narrow ? null : <ExportMenu links={exports} />}
          </>
        )}
        onRedo={history.redo}
        onRetrySave={() => void autosave.flush()}
        onTitleChange={(next) => history.set((current) => ({ ...current, title: next }), "title")}
        onUndo={history.undo}
        panel={() => (organizationId && !guest ? <FlowLauncher organizationId={organizationId} /> : null)}
        primary={
          canShare ? (
            <Button className="h-10 px-4" onClick={() => setSharing(true)} type="button">
              <UserPlus />
              Share
            </Button>
          ) : null
        }
        saveStatus={canEdit ? autosave.status : null}
        title={title}
        titleEditable={canEdit}
        titleSuffix=".xlsx"
      >
        {({ narrow }) => {
          // A phone types into a bar above its keyboard rather than the cell.
          const gridActions = narrow ? { ...actions, startEditing: (text: string | null) => startEditing(text, "dock") } : actions

          return (
            <>
              {canEdit ? (
                <FormatToolbar
                  cell={activeCell}
                  narrow={narrow}
                  onAlign={(align) => format((old) => ({ ...base(old), align: old?.align === align ? undefined : align }))}
                  onBold={() => format((old) => ({ ...base(old), bold: !activeCell?.fmt?.bold || undefined }))}
                  onDecimals={(step) => format((old) => stepDecimals(old, step))}
                  onFormat={(type) => format((old) => ({ type, bold: old?.bold, align: old?.align }))}
                  onLines={lines}
                />
              ) : null}
              <FormulaBar
                address={range.top === range.bottom && range.left === range.right ? active : `${active}:${cellAddress(selection.anchor.row, selection.anchor.col)}`}
                editing={editing?.where === "bar" ? editing.text : null}
                narrow={narrow}
                onCancel={actions.cancel}
                onCommit={commit}
                onStart={() => startEditing(null, narrow ? "dock" : "bar")}
                onType={actions.type}
                readOnly={!canEdit}
                references={references}
                text={formulaText}
              />
              <SheetGrid
                actions={gridActions}
                display={display}
                editingText={editing?.where === "cell" && editing.tabId === tab.id ? editing.text : null}
                gridRef={gridRef}
                label={tab.name}
                narrow={narrow}
                outlines={outlines}
                readOnly={!canEdit}
                selection={selection}
                tab={tab}
                values={values}
              />
              <div
                className={cn("flex h-11 shrink-0 items-center gap-1 border-t border-border bg-muted/60 px-2", narrow && "pr-20")}
                data-slot="sheet-footer"
              >
                <div aria-label="Tabs" className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" role="tablist">
                  {content.tabs.map((candidate) =>
                    renaming === candidate.id ? (
                      <input
                        aria-label="Tab name"
                        autoFocus
                        className="h-8 w-28 rounded-[8px] border border-primary bg-card px-2 text-[13px] outline-none"
                        defaultValue={candidate.name}
                        key={candidate.id}
                        maxLength={31}
                        onBlur={(event) => rename(candidate.id, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur()
                          else if (event.key === "Escape") setRenaming(null)
                        }}
                      />
                    ) : (
                      <TabButton
                        active={candidate.id === tab.id}
                        canDelete={canEdit && content.tabs.length > 1}
                        canEdit={canEdit}
                        key={candidate.id}
                        name={candidate.name}
                        onDelete={() => change((current) => deleteTab(current, candidate.id))}
                        onRename={() => setRenaming(candidate.id)}
                        onSelect={() => {
                          commit()
                          setTabId(candidate.id)
                          select({ row: 0, col: 0 }, { row: 0, col: 0 })
                        }}
                      />
                    )
                  )}
                  {canEdit ? (
                    <Button
                      aria-label="Add tab"
                      className="size-8 shrink-0"
                      disabled={content.tabs.length >= MAX_TABS}
                      onClick={() => {
                        const id = crypto.randomUUID()
                        change((current) => addTab(current, id))
                        setTabId(id)
                        select({ row: 0, col: 0 }, { row: 0, col: 0 })
                      }}
                      size="icon"
                      title={content.tabs.length >= MAX_TABS ? `A sheet holds at most ${MAX_TABS} tabs` : "Add tab"}
                      type="button"
                      variant="ghost"
                    >
                      <Plus />
                    </Button>
                  ) : null}
                </div>
                <span className="grow" />
                {stats ? (
                  <p aria-live="polite" className="flex shrink-0 gap-3 text-xs text-muted-foreground tabular-nums" data-slot="sheet-stats">
                    <span>Sum {formatCellValue(stats.sum, activeCell?.fmt, display)}</span>
                    <span className="max-sm:hidden">Average {formatCellValue(stats.sum / stats.numbers, activeCell?.fmt, display)}</span>
                    <span className="max-sm:hidden">Count {stats.count}</span>
                  </p>
                ) : null}
              </div>
              {editing?.where === "dock" ? (
                <DockedEditor onCancel={actions.cancel} onDone={() => commit()} onType={actions.type} text={editing.text} />
              ) : null}
            </>
          )
        }}
      </EditorFrame>
      {canShare && sharing ? (
        <ShareDialog name={title} onOpenChange={setSharing} open resources={[{ id: sheet.id, kind: "document" }]} />
      ) : null}
    </>
  )
}

const inside = (range: Range, point: Point) => point.row >= range.top && point.row <= range.bottom && point.col >= range.left && point.col <= range.right

const base = (format: SheetFormat | undefined): SheetFormat => format ?? { type: "general" }

// No empty keys, and no format at all for plain General.
function tidy(format: SheetFormat | undefined): SheetFormat | undefined {
  if (!format) return undefined
  const kept = Object.fromEntries(Object.entries(format).filter(([, value]) => value !== undefined)) as SheetFormat
  return Object.keys(kept).length === 1 && kept.type === "general" ? undefined : kept
}

function stepDecimals(format: SheetFormat | undefined, step: number): SheetFormat | undefined {
  const type = format?.type === "money" || format?.type === "percent" ? format.type : format?.type === "number" || !format || format.type === "general" ? "number" : null
  if (!type) return format
  const decimals = Math.min(10, Math.max(0, (format?.decimals ?? (type === "percent" ? 0 : 2)) + step))
  return { ...format, type, decimals }
}

// Sum, average and count of the selection, once it holds more than one cell and a number.
function summarize(tab: SheetContent["tabs"][number], range: Range, values: ReadonlyMap<string, unknown> | null) {
  if (range.top === range.bottom && range.left === range.right) return null
  let sum = 0
  let numbers = 0
  let count = 0
  for (const address of Object.keys(tab.cells)) {
    const ref = parseCellRef(address)!
    if (!inside(range, ref)) continue
    const value = values?.get(`${tab.id}!${address}`) ?? tab.cells[address]?.v ?? null
    if (value === null || value === "") continue
    count += 1
    if (typeof value === "number") {
      sum += value
      numbers += 1
    }
  }
  return numbers > 0 ? { count, numbers, sum } : null
}

function ToolButton({ children, label, onClick, pressed }: { children: ReactNode; label: string; onClick: () => void; pressed?: boolean }): ReactElement {
  return (
    <Button
      aria-label={label}
      aria-pressed={pressed}
      className={cn("size-8 shrink-0", pressed && "bg-accent text-accent-foreground")}
      onClick={onClick}
      size="icon"
      title={label}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  )
}

function FormatToolbar({
  cell,
  narrow,
  onAlign,
  onBold,
  onDecimals,
  onFormat,
  onLines,
}: {
  cell: SheetCell | undefined
  narrow: boolean
  onAlign: (align: "left" | "center" | "right") => void
  onBold: () => void
  onDecimals: (step: number) => void
  onFormat: (type: SheetFormat["type"]) => void
  onLines: (axis: "row" | "col", where: "before" | "after" | "delete") => void
}): ReactElement {
  const align = cell?.fmt?.align
  const divider = <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />

  return (
    <div
      aria-label="Format"
      className={cn(
        "flex h-11 shrink-0 items-center gap-0.5 border-b border-border bg-card px-2",
        narrow && "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      )}
      data-slot="sheet-toolbar"
      role="toolbar"
    >
      <ToolButton label="Bold" onClick={onBold} pressed={cell?.fmt?.bold === true}>
        <Bold />
      </ToolButton>
      {divider}
      <select
        aria-label="Number format"
        className="h-8 shrink-0 rounded-[8px] bg-transparent px-1.5 text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
        onChange={(event) => onFormat(event.target.value as SheetFormat["type"])}
        value={cell?.fmt?.type ?? "general"}
      >
        {FORMATS.map(([type, label]) => (
          <option key={type} value={type}>
            {label}
          </option>
        ))}
      </select>
      <ToolButton label="Fewer decimals" onClick={() => onDecimals(-1)}>
        <DecimalsArrowLeft />
      </ToolButton>
      <ToolButton label="More decimals" onClick={() => onDecimals(1)}>
        <DecimalsArrowRight />
      </ToolButton>
      {divider}
      <ToolButton label="Align left" onClick={() => onAlign("left")} pressed={align === "left"}>
        <AlignLeft />
      </ToolButton>
      <ToolButton label="Align centre" onClick={() => onAlign("center")} pressed={align === "center"}>
        <AlignCenter />
      </ToolButton>
      <ToolButton label="Align right" onClick={() => onAlign("right")} pressed={align === "right"}>
        <AlignRight />
      </ToolButton>
      {divider}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button className="h-8 shrink-0 gap-1 px-2 text-[13px]" type="button" variant="ghost">
              <Plus />
              Insert
              <ChevronDown />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onClick={() => onLines("row", "before")}>Row above</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onLines("row", "after")}>Row below</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onLines("col", "before")}>Column left</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onLines("col", "after")}>Column right</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button className="h-8 shrink-0 gap-1 px-2 text-[13px]" type="button" variant="ghost">
              <Trash2 />
              Delete
              <ChevronDown />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onClick={() => onLines("row", "delete")}>Delete row</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onLines("col", "delete")}>Delete column</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function FormulaBar({
  address,
  editing,
  narrow,
  onCancel,
  onCommit,
  onStart,
  onType,
  readOnly,
  references,
  text,
}: {
  address: string
  editing: string | null
  narrow: boolean
  onCancel: () => void
  onCommit: (move?: { rows: number; cols: number }) => void
  onStart: () => void
  onType: (text: string) => void
  readOnly: boolean
  references: ReadonlyArray<{ color: string; end: number; start: number }>
  text: string
}): ReactElement {
  // Coloured references show over the text while the bar is not being typed in.
  const coloured = editing === null && references.length > 0
  let at = 0
  const pieces: ReactNode[] = []
  for (const reference of references) {
    pieces.push(text.slice(at, reference.start))
    pieces.push(
      <span key={reference.start} style={{ color: reference.color }}>
        {text.slice(reference.start, reference.end)}
      </span>
    )
    at = reference.end
  }
  pieces.push(text.slice(at))

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-2 text-[13px]" data-slot="sheet-formula-bar">
      <output aria-label="Selected cell" className="w-20 shrink-0 truncate font-mono text-xs text-muted-foreground">
        {address}
      </output>
      <span aria-hidden="true" className="shrink-0 font-serif text-muted-foreground italic">
        fx
      </span>
      <div className="relative min-w-0 flex-1 self-stretch">
        {coloured ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-1.5 font-mono whitespace-pre">
            {pieces}
          </div>
        ) : null}
        <input
          aria-label="Formula bar"
          className={cn("size-full bg-transparent px-1.5 font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring/40", coloured && "text-transparent")}
          maxLength={5000}
          onBlur={() => (editing !== null ? onCommit() : undefined)}
          onChange={(event) => onType(event.target.value)}
          onFocus={() => (readOnly || narrow ? undefined : onStart())}
          onClick={() => (narrow && !readOnly ? onStart() : undefined)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              onCommit({ rows: 1, cols: 0 })
            } else if (event.key === "Escape") {
              event.preventDefault()
              onCancel()
            }
          }}
          readOnly={readOnly || narrow}
          value={editing ?? text}
        />
      </div>
    </div>
  )
}

function TabButton({
  active,
  canDelete,
  canEdit,
  name,
  onDelete,
  onRename,
  onSelect,
}: {
  active: boolean
  canDelete: boolean
  canEdit: boolean
  name: string
  onDelete: () => void
  onRename: () => void
  onSelect: () => void
}): ReactElement {
  return (
    <div className={cn("flex h-8 shrink-0 items-center rounded-[8px]", active ? "bg-card shadow-sm" : "hover:bg-muted")}>
      <button
        aria-selected={active}
        className={cn("h-8 px-3 text-[13px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/40", active && "font-medium")}
        onClick={onSelect}
        onDoubleClick={canEdit ? onRename : undefined}
        role="tab"
        type="button"
      >
        {name}
      </button>
      {active && canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button aria-label={`Tab ${name} options`} className="size-7" size="icon" type="button" variant="ghost">
                <ChevronDown />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
            <DropdownMenuItem disabled={!canDelete} onClick={onDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

// How far a phone's keyboard covers the bottom of the page.
function subscribeViewport(onChange: () => void): () => void {
  window.visualViewport?.addEventListener("resize", onChange)
  window.visualViewport?.addEventListener("scroll", onChange)
  return () => {
    window.visualViewport?.removeEventListener("resize", onChange)
    window.visualViewport?.removeEventListener("scroll", onChange)
  }
}

const keyboardInset = () => {
  const viewport = window.visualViewport
  return viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0
}

// A phone types into a cell from a bar docked above its keyboard, with ✓ to keep it.
function DockedEditor({ onCancel, onDone, onType, text }: { onCancel: () => void; onDone: () => void; onType: (text: string) => void; text: string }): ReactElement {
  const inset = useSyncExternalStore(subscribeViewport, keyboardInset, () => 0)

  return (
    <div
      className="fixed inset-x-0 z-40 flex items-center gap-2 border-t border-border bg-popover p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
      data-slot="sheet-dock-editor"
      style={{ bottom: inset }}
    >
      <input
        aria-label="Cell contents"
        autoFocus
        className="h-11 min-w-0 flex-1 rounded-[10px] border border-input bg-card px-3 font-mono text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        enterKeyHint="done"
        maxLength={5000}
        onChange={(event) => onType(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onDone()
          else if (event.key === "Escape") onCancel()
        }}
        value={text}
      />
      <Button aria-label="Done" className="size-11" onClick={onDone} size="icon" type="button">
        <Check />
      </Button>
    </div>
  )
}
