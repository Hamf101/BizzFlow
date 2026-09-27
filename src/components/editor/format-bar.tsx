"use client"

import type { ChainedCommands } from "@tiptap/core"
import { useEditorState } from "@tiptap/react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  FilePlus2,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Omega,
  Plus,
  RemoveFormatting,
  Strikethrough,
  Table,
  TextCursorInput,
  Underline,
} from "lucide-react"
import { type FormEvent, type ReactElement, type ReactNode, useEffect, useState } from "react"

import { findInsertChoices, INSERT_CHOICES, type InsertChoice } from "@/components/editor/block-catalog"
import { isLine, isList } from "@/components/editor/editor-block"
import { convertTextBlock, liftListItem, type TextBlockKind } from "@/components/editor/editor-content"
import { FontPicker } from "@/components/editor/font-picker"
import type { EditorController } from "@/components/editor/use-editor-controller"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { type TemplateBlock, textRunSchema } from "@/types/template"

type LineKind = Extract<TextBlockKind, { type: "heading" | "paragraph" }>

// The sizes a heading's words take when nothing else is set, as on the printed page.
const HEADING_POINTS = { 1: 20, 2: 16, 3: 13 } as const
const STYLES: ReadonlyArray<readonly [string, LineKind]> = [
  ["Normal text", { type: "paragraph" }],
  ["Heading 1", { level: 1, type: "heading" }],
  ["Heading 2", { level: 2, type: "heading" }],
  ["Heading 3", { level: 3, type: "heading" }],
]
const TEXT_COLORS: ReadonlyArray<readonly [string, string]> = [
  ["#000000", "Black"], ["#434343", "Dark gray 4"], ["#666666", "Dark gray 3"], ["#999999", "Dark gray 2"], ["#b7b7b7", "Dark gray 1"],
  ["#cccccc", "Gray"], ["#d9d9d9", "Light gray 1"], ["#efefef", "Light gray 2"], ["#f3f3f3", "Light gray 3"], ["#ffffff", "White"],
  ["#980000", "Red berry"], ["#ff0000", "Red"], ["#ff9900", "Orange"], ["#ffff00", "Yellow"], ["#00ff00", "Green"],
  ["#00ffff", "Cyan"], ["#4a86e8", "Cornflower blue"], ["#0000ff", "Blue"], ["#9900ff", "Purple"], ["#ff00ff", "Magenta"],
  ["#85200c", "Dark red berry"], ["#990000", "Dark red"], ["#b45f06", "Dark orange"], ["#bf9000", "Dark yellow"], ["#38761d", "Dark green"],
  ["#134f5c", "Dark cyan"], ["#1155cc", "Dark cornflower blue"], ["#0b5394", "Dark blue"], ["#351c75", "Dark purple"], ["#741b47", "Dark magenta"],
]
const HIGHLIGHTS: ReadonlyArray<readonly [string, string]> = [
  ["#f4cccc", "Light red"], ["#fce5cd", "Light orange"], ["#fff2cc", "Light yellow"], ["#d9ead3", "Light green"], ["#d0e0e3", "Light cyan"],
  ["#c9daf8", "Light cornflower blue"], ["#cfe2f3", "Light blue"], ["#d9d2e9", "Light purple"], ["#ead1dc", "Light magenta"], ["#efefef", "Light gray"],
  ["#ea9999", "Red"], ["#f9cb9c", "Orange"], ["#ffe599", "Yellow"], ["#b6d7a8", "Green"], ["#a2c4c9", "Cyan"],
  ["#a4c2f4", "Cornflower blue"], ["#9fc5e8", "Blue"], ["#b4a7d6", "Purple"], ["#d5a6bd", "Magenta"], ["#ffff00", "Bright yellow"],
]
// Symbols with the words a search finds them by.
const SYMBOLS: ReadonlyArray<readonly [string, string]> = [
  ["→", "right arrow"], ["←", "left arrow"], ["↑", "up arrow"], ["↓", "down arrow"], ["↔", "left right arrow"], ["⇒", "double right arrow"],
  ["✓", "check mark tick"], ["✔", "heavy check mark tick"], ["✗", "ballot x cross"], ["☐", "empty box checkbox"], ["☑", "checked box checkbox"], ["☒", "crossed box checkbox"],
  ["•", "bullet"], ["◦", "white bullet"], ["▪", "small black square"], ["■", "black square"], ["□", "white square"], ["●", "black circle"],
  ["○", "white circle"], ["◆", "black diamond"], ["★", "black star"], ["☆", "white star"], ["©", "copyright"], ["®", "registered trademark"],
  ["™", "trade mark"], ["§", "section"], ["¶", "pilcrow paragraph"], ["†", "dagger"], ["‡", "double dagger"], ["°", "degree"],
  ["±", "plus minus"], ["×", "multiply times"], ["÷", "divide"], ["≈", "almost equal"], ["≠", "not equal"], ["≤", "less than or equal"],
  ["≥", "greater than or equal"], ["∞", "infinity"], ["√", "square root"], ["‰", "per mille"], ["€", "euro"], ["£", "pound"],
  ["¥", "yen"], ["¢", "cent"], ["₹", "rupee"], ["½", "one half"], ["⅓", "one third"], ["¼", "one quarter"],
  ["¾", "three quarters"], ["…", "ellipsis"], ["—", "em dash"], ["–", "en dash"], ["«", "left guillemet quote"], ["»", "right guillemet quote"],
  ["“", "left double quote"], ["”", "right double quote"], ["·", "middle dot"], ["☎", "telephone phone"], ["✉", "envelope email"], ["⚠", "warning"],
]

/**
 * The editor's formatting toolbar, the way Google Docs lays one out: Insert
 * with its side menus, the kind of line, the size, the marks, colour,
 * highlight, link, alignment, lists and clearing. Marks act on the words
 * chosen in the line the caret was last in; the rest act on that line's block.
 * On a phone the same tools sit in one row that scrolls.
 *
 * @param props - The controller, whether file uploads can be added, and the screen.
 * @returns The toolbar.
 */
export function FormatBar({
  allowFiles,
  controller,
  narrow,
}: {
  allowFiles: boolean
  controller: EditorController
  narrow: boolean
}): ReactElement {
  const line = controller.line && !controller.line.isDestroyed ? controller.line : null
  const marks = useEditorState({
    editor: line,
    selector: ({ editor }) =>
      editor && !editor.isDestroyed
        ? {
            bold: editor.isActive("bold"),
            color: editor.getAttributes("textStyle").color as string | undefined,
            font: editor.getAttributes("textStyle").font as string | undefined,
            highlight: editor.getAttributes("highlight").color as string | undefined,
            italic: editor.isActive("italic"),
            link: editor.getAttributes("link").href as string | undefined,
            size: editor.getAttributes("textStyle").size as number | undefined,
            strike: editor.isActive("strike"),
            underline: editor.isActive("underline"),
          }
        : null,
  })
  const [linkOpen, setLinkOpen] = useState(false)
  const content = controller.content
  const block = content.blocks.find((candidate) => candidate.id === controller.activeBlockId)
  const textBlock = isLine(block) || isList(block) ? block : undefined
  // A list's line is keyed by its item, `block:item`.
  const item = Number(line?.view.dom.dataset.caretKey?.split(":")[1] ?? 0)
  const base = block?.type === "heading" ? HEADING_POINTS[block.level] : 10
  const size = marks?.size ?? base
  const head = (): number => line?.state.selection.head ?? 0
  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+"

  useEffect(() => {
    function openLink(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && line?.isFocused) {
        event.preventDefault()
        setLinkOpen(true)
      }
    }

    document.addEventListener("keydown", openLink)
    return () => document.removeEventListener("keydown", openLink)
  }, [line])

  function format(command: (chain: ChainedCommands) => ChainedCommands): void {
    if (line) {
      command(line.chain().focus()).run()
    }
  }

  function setSize(next: number): void {
    const points = Math.min(96, Math.max(6, Math.round(next)))

    format((chain) =>
      points === base ? chain.setMark("textStyle", { size: null }).removeEmptyTextStyle() : chain.setMark("textStyle", { size: points })
    )
  }

  function setStyle(kind: LineKind): void {
    if (!textBlock) {
      return
    }

    const offset = head()

    if (isList(textBlock)) {
      const lifted = liftListItem(content, textBlock.id, item, kind, [crypto.randomUUID(), crypto.randomUUID()])

      controller.change(() => lifted.content)
      controller.requestFocus({ ...lifted.focus, offset })
      return
    }

    controller.change((current) => convertTextBlock(current, textBlock.id, kind).content)
    controller.requestFocus({ blockId: textBlock.id, offset })
  }

  function toggleList(type: "bullet_list" | "numbered_list"): void {
    const offset = head()

    if (isList(textBlock) && textBlock.type === type) {
      setStyle({ type: "paragraph" })
    } else if (isList(textBlock)) {
      controller.updateBlock({ ...textBlock, type })
      controller.requestFocus({ blockId: textBlock.id, item, offset })
    } else if (textBlock) {
      controller.change((current) => convertTextBlock(current, textBlock.id, { type }).content)
      controller.requestFocus({ blockId: textBlock.id, item: 0, offset })
    }
  }

  // Added from the menu, a block takes the place of an empty line, as from /.
  function add(id: string, table?: { columns: number; rows: number }): void {
    const choice = INSERT_CHOICES.find((candidate) => candidate.id === id) as InsertChoice
    const empty = block?.type === "paragraph" && block.text.trim() === "" ? block.id : undefined

    controller.insert(choice, { replaceBlockId: empty, table })
  }

  const tool = cn("shrink-0", narrow ? "size-11" : "size-8")
  const style = STYLES.find(([, kind]) => kind.type === block?.type && (kind.type !== "heading" || block?.type !== "heading" || kind.level === block.level))

  return (
    <div
      aria-label="Formatting"
      className={cn(
        "flex items-center gap-0.5 whitespace-nowrap",
        !narrow &&
          "pointer-events-auto h-11 max-w-full overflow-x-auto rounded-[14px] border border-border bg-popover px-1.5 text-popover-foreground shadow-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      )}
      data-slot="format-bar"
      role="toolbar"
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              className={cn("shrink-0 gap-1.5 bg-secondary px-2.5 text-secondary-foreground hover:bg-secondary/80", narrow ? "h-11" : "h-8")}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Plus aria-hidden="true" />
              Insert
              <ChevronDown aria-hidden="true" className="size-3.5 opacity-70" />
            </Button>
          }
        />
        <DropdownMenuContent className="w-60" side={narrow ? "top" : "bottom"}>
          <DropdownMenuItem onClick={() => add("image")}>
            <ImageIcon />
            Image
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Table />
              Table
            </DropdownMenuSubTrigger>
            <DropdownMenuContent side="inline-end">
              <TableGrid onPick={(columns, rows) => add("table", { columns, rows })} />
            </DropdownMenuContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={() => add("bullet-list")}>
            <List />
            Bulleted list
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => add("numbered-list")}>
            <ListOrdered />
            Numbered list
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <TextCursorInput />
              Fields
            </DropdownMenuSubTrigger>
            <DropdownMenuContent className="w-48" side="inline-end">
              {findInsertChoices({ allowFiles })
                .filter((choice) => choice.group === "fields")
                .map((choice) => (
                  <DropdownMenuItem key={choice.id} onClick={() => add(choice.id)}>
                    <choice.icon />
                    {choice.label}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenuSub>
          <DropdownMenuSub disabled={!line}>
            <DropdownMenuSubTrigger>
              <Omega />
              Symbols
            </DropdownMenuSubTrigger>
            <DropdownMenuContent side="inline-end">
              <SymbolPicker onPick={(symbol) => format((chain) => chain.insertContent(symbol))} />
            </DropdownMenuContent>
          </DropdownMenuSub>
          <DropdownMenuItem disabled={!line} onClick={() => setLinkOpen(true)}>
            <Link2 />
            Link
            <span className="ml-auto text-xs text-muted-foreground">{mod}K</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => add("divider")}>
            <Minus />
            Horizontal line
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => add("page")}>
            <FilePlus2 />
            Page break
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Divider />
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={!textBlock}
          render={
            <Button
              aria-label="Text style"
              className={cn("shrink-0 justify-between gap-1 px-2 font-normal", narrow ? "h-11 min-w-28" : "h-8 min-w-28")}
              size="sm"
              type="button"
              variant="ghost"
            >
              {isList(block) ? "Normal text" : (style?.[0] ?? "Normal text")}
              <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
            </Button>
          }
        />
        <DropdownMenuContent className="w-44" side={narrow ? "top" : "bottom"}>
          {STYLES.map(([label, kind]) => (
            <DropdownMenuItem key={label} onClick={() => setStyle(kind)}>
              <span style={kind.type === "heading" ? { fontSize: `${[1.35, 1.2, 1.05][kind.level - 1]}em`, fontWeight: 600 } : undefined}>
                {label}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <FontPicker
        disabled={!line}
        documentFonts={documentFonts(controller.content.blocks)}
        narrow={narrow}
        onChange={(font) => format((chain) => chain.setMark("textStyle", { font }).removeEmptyTextStyle())}
        value={marks?.font}
      />
      <div className="flex shrink-0 items-center">
        <Tool className={cn(narrow ? "size-11" : "h-8 w-7")} disabled={!line || size <= 6} label="Smaller text" onClick={() => setSize(size - 1)}>
          <Minus />
        </Tool>
        <SizeInput disabled={!line} onChange={setSize} value={size} />
        <Tool className={cn(narrow ? "size-11" : "h-8 w-7")} disabled={!line || size >= 96} label="Bigger text" onClick={() => setSize(size + 1)}>
          <Plus />
        </Tool>
      </div>
      <Divider />
      <Tool className={tool} disabled={!line} label="Bold" onClick={() => format((chain) => chain.toggleBold())} pressed={marks?.bold}>
        <Bold />
      </Tool>
      <Tool className={tool} disabled={!line} label="Italic" onClick={() => format((chain) => chain.toggleItalic())} pressed={marks?.italic}>
        <Italic />
      </Tool>
      <Tool className={tool} disabled={!line} label="Underline" onClick={() => format((chain) => chain.toggleUnderline())} pressed={marks?.underline}>
        <Underline />
      </Tool>
      <Tool className={tool} disabled={!line} label="Strikethrough" onClick={() => format((chain) => chain.toggleStrike())} pressed={marks?.strike}>
        <Strikethrough />
      </Tool>
      <Swatches
        brand={[content.branding.primaryColor, content.branding.accentColor]}
        className={tool}
        colors={TEXT_COLORS}
        current={marks?.color}
        disabled={!line}
        icon={<Baseline />}
        label="Text color"
        narrow={narrow}
        none="Automatic"
        onChoose={(color) => format((chain) => chain.setMark("textStyle", { color }).removeEmptyTextStyle())}
      />
      <Swatches
        className={tool}
        colors={HIGHLIGHTS}
        current={marks?.highlight}
        disabled={!line}
        icon={<Highlighter />}
        label="Highlight"
        narrow={narrow}
        none="None"
        onChoose={(color) => format((chain) => (color ? chain.setHighlight({ color }) : chain.unsetHighlight()))}
      />
      <Divider />
      <Popover onOpenChange={setLinkOpen} open={linkOpen}>
        <PopoverTrigger
          render={
            <Button
              aria-label="Link"
              aria-pressed={Boolean(marks?.link)}
              className={cn(tool, "aria-pressed:bg-secondary aria-pressed:text-secondary-foreground")}
              disabled={!line}
              size="icon-sm"
              title={`Link (${mod}K)`}
              type="button"
              variant="ghost"
            />
          }
        >
          <Link2 />
        </PopoverTrigger>
        <PopoverContent className="w-80" side={narrow ? "top" : "bottom"}>
          <LinkForm
            current={marks?.link}
            onApply={(href, words) => {
              setLinkOpen(false)
              format((chain) =>
                marks?.link || !line?.state.selection.empty
                  ? chain.extendMarkRange("link").setLink({ href })
                  : chain.insertContent({ marks: [{ attrs: { href }, type: "link" }], text: words, type: "text" })
              )
            }}
            onRemove={() => {
              setLinkOpen(false)
              format((chain) => chain.extendMarkRange("link").unsetLink())
            }}
          />
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={!isLine(block)}
          render={
            <Button aria-label="Align" className={cn(tool, "gap-0.5", !narrow && "w-11")} size="sm" type="button" variant="ghost">
              {isLine(block) && block.alignment === "center" ? <AlignCenter /> : isLine(block) && block.alignment === "right" ? <AlignRight /> : <AlignLeft />}
              <ChevronDown aria-hidden="true" className="size-3 text-muted-foreground" />
            </Button>
          }
        />
        <DropdownMenuContent className="w-36" side={narrow ? "top" : "bottom"}>
          {(["left", "center", "right"] as const).map((alignment) => (
            <DropdownMenuItem
              key={alignment}
              onClick={() => {
                if (isLine(block)) {
                  const offset = head()
                  controller.updateBlock({ ...block, alignment })
                  controller.requestFocus({ blockId: block.id, offset })
                }
              }}
            >
              {alignment === "center" ? <AlignCenter /> : alignment === "right" ? <AlignRight /> : <AlignLeft />}
              {alignment[0]?.toUpperCase() + alignment.slice(1)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Divider />
      <Tool className={tool} disabled={!textBlock} label="Bulleted list" onClick={() => toggleList("bullet_list")} pressed={block?.type === "bullet_list"}>
        <List />
      </Tool>
      <Tool className={tool} disabled={!textBlock} label="Numbered list" onClick={() => toggleList("numbered_list")} pressed={block?.type === "numbered_list"}>
        <ListOrdered />
      </Tool>
      <Tool className={tool} disabled={!line} label="Clear formatting" onClick={() => format((chain) => chain.unsetAllMarks())}>
        <RemoveFormatting />
      </Tool>
    </div>
  )
}

function Divider(): ReactElement {
  return <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
}

// The families the document's words already use, for the font menu to offer first.
function documentFonts(blocks: readonly TemplateBlock[]): string[] {
  const runs = blocks.flatMap((block) =>
    isLine(block) ? (block.runs ?? []) : isList(block) ? (block.itemRuns ?? []).flatMap((item) => item ?? []) : []
  )

  return runs.flatMap((run) => (run.font ? [run.font] : []))
}

// A plain toolbar button. Pressing it leaves the caret and the chosen words
// where they are, so the words stay chosen for the next change.
function Tool({
  children,
  className,
  disabled,
  label,
  onClick,
  pressed,
}: {
  children: ReactNode
  className?: string
  disabled?: boolean
  label: string
  onClick: () => void
  pressed?: boolean
}): ReactElement {
  return (
    <Button
      aria-label={label}
      aria-pressed={pressed}
      className={cn("aria-pressed:bg-secondary aria-pressed:text-secondary-foreground", className)}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      size="icon-sm"
      title={label}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  )
}

// The size in points: typed and set with Enter, or stepped with the buttons beside it.
function SizeInput({ disabled, onChange, value }: { disabled: boolean; onChange: (size: number) => void; value: number }): ReactElement {
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <input
      aria-label="Font size"
      className="h-7 w-10 shrink-0 rounded-[7px] border border-border bg-transparent text-center text-[13px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:opacity-50"
      disabled={disabled}
      inputMode="numeric"
      onBlur={() => setDraft(null)}
      onChange={(event) => setDraft(event.target.value.replace(/[^\d.]/g, "").slice(0, 4))}
      onKeyDown={(event) => {
        if (event.key === "Enter" && draft) {
          event.preventDefault()
          onChange(Number(draft))
          setDraft(null)
        }
      }}
      value={draft ?? String(value)}
    />
  )
}

// A grid to pick a table's size by pointing at it, as in Google Docs.
function TableGrid({ onPick }: { onPick: (columns: number, rows: number) => void }): ReactElement {
  const [size, setSize] = useState({ columns: 1, rows: 1 })

  return (
    <div className="grid gap-2 p-1">
      <div className="grid grid-cols-10 gap-[3px]">
        {Array.from({ length: 80 }, (_, index) => {
          const columns = (index % 10) + 1
          const rows = Math.floor(index / 10) + 1

          return (
            <DropdownMenuItem
              aria-label={`${columns} by ${rows} table`}
              className={cn(
                "size-[18px] rounded-[4px] border p-0 focus:bg-secondary",
                columns <= size.columns && rows <= size.rows ? "border-primary/60 bg-secondary" : "border-border bg-muted/40"
              )}
              key={index}
              onClick={() => onPick(columns, rows)}
              onFocus={() => setSize({ columns, rows })}
              onMouseEnter={() => setSize({ columns, rows })}
            />
          )
        })}
      </div>
      <span aria-hidden="true" className="text-center text-[13px] tabular-nums">
        {size.columns} × {size.rows}
      </span>
    </div>
  )
}

function SymbolPicker({ onPick }: { onPick: (symbol: string) => void }): ReactElement {
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  const found = SYMBOLS.filter(([symbol, name]) => !needle || name.includes(needle) || symbol === query.trim())

  return (
    <div className="grid w-72 gap-2 p-1">
      <input
        aria-label="Search symbols"
        className="h-8 rounded-[8px] border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        onChange={(event) => setQuery(event.target.value)}
        // Typing is for the search, not the menu's own type-to-jump.
        onKeyDown={(event) => event.key !== "Escape" && event.stopPropagation()}
        placeholder="Search, like arrow or check"
        value={query}
      />
      <div className="grid grid-cols-8 gap-0.5">
        {found.map(([symbol, name]) => (
          <DropdownMenuItem aria-label={name} className="grid size-8 place-items-center p-0 text-base" key={symbol} onClick={() => onPick(symbol)} title={name}>
            {symbol}
          </DropdownMenuItem>
        ))}
      </div>
      {found.length === 0 ? <p className="px-1 pb-1 text-sm text-muted-foreground">No symbols match.</p> : null}
    </div>
  )
}

function Swatches({
  brand,
  className,
  colors,
  current,
  disabled,
  icon,
  label,
  narrow,
  none,
  onChoose,
}: {
  brand?: readonly string[]
  className: string
  colors: ReadonlyArray<readonly [string, string]>
  current?: string
  disabled: boolean
  icon: ReactNode
  label: string
  narrow: boolean
  none: string
  onChoose: (color: string | null) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const choose = (color: string | null): void => {
    setOpen(false)
    onChoose(color)
  }
  const swatch = (color: string, name: string): ReactElement => (
    <button
      aria-label={name}
      aria-pressed={current?.toLowerCase() === color}
      className="size-5 rounded-full border border-black/10 outline-none aria-pressed:ring-2 aria-pressed:ring-primary aria-pressed:ring-offset-1 hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring"
      key={color + name}
      onClick={() => choose(color)}
      style={{ backgroundColor: color }}
      title={name}
      type="button"
    />
  )

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={<Button aria-label={label} className={className} disabled={disabled} size="icon-sm" title={label} type="button" variant="ghost" />}
      >
        <span className="grid justify-items-center gap-px">
          {icon}
          <span aria-hidden="true" className="h-[3px] w-4 rounded-full" style={{ backgroundColor: current ?? "currentColor", opacity: current ? 1 : 0.3 }} />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-auto" side={narrow ? "top" : "bottom"}>
        <button
          className="mb-2 h-8 w-full rounded-[8px] px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => choose(null)}
          type="button"
        >
          {none}
        </button>
        <div className="grid grid-cols-10 gap-1.5">{colors.map(([color, name]) => swatch(color, name))}</div>
        {brand ? (
          <>
            <p className="mt-3 mb-1.5 text-xs text-muted-foreground">Brand</p>
            <div className="flex gap-1.5">{brand.map((color, index) => swatch(color.toLowerCase(), index === 0 ? "Brand primary" : "Brand accent"))}</div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function LinkForm({
  current,
  onApply,
  onRemove,
}: {
  current?: string
  onApply: (href: string, words: string) => void
  onRemove: () => void
}): ReactElement {
  const [value, setValue] = useState(current ?? "")
  const href = toHref(value)

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    if (href) {
      onApply(href, value.trim())
    }
  }

  return (
    <form className="grid gap-2" onSubmit={submit}>
      <input
        aria-label="Link"
        autoFocus
        className="h-9 rounded-[8px] border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        onChange={(event) => setValue(event.target.value)}
        placeholder="Paste a link, or an email address"
        value={value}
      />
      <div className="flex justify-end gap-1.5">
        {current ? (
          <Button onClick={onRemove} size="sm" type="button" variant="ghost">
            Remove
          </Button>
        ) : null}
        <Button disabled={!href} size="sm" type="submit">
          Apply
        </Button>
      </div>
    </form>
  )
}

/**
 * Turns what was typed into a link a saved document keeps: an email address
 * writes an email, a web address without its https:// gains one.
 *
 * @param value - What was typed.
 * @returns The link, or null when it is neither.
 */
export function toHref(value: string): string | null {
  const typed = value.trim()
  const href = /^[^\s@:]+@[^\s@]+\.[^\s@]+$/.test(typed)
    ? `mailto:${typed}`
    : /^[a-z][a-z\d+.-]*:/i.test(typed)
      ? typed
      : `https://${typed}`

  return typed && textRunSchema.shape.link.safeParse(href).success ? href : null
}
