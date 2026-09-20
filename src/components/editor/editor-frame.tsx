"use client"

import { ArrowLeft, Minus, Plus, Redo2, Undo2, X } from "lucide-react"
import Link from "next/link"
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { POINT_PX } from "@/components/editor/editor-canvas"
import type { AutosaveStatus } from "@/components/editor/use-autosave"
import { Button, buttonVariants } from "@/components/ui/button"
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const
const NARROW = "(width < 48rem)"

/** One of the editor's modes, such as Edit, Preview and Test. */
export type EditorMode<Value extends string> = Readonly<{ label: string; value: Value }>

type EditorFrameProps<Mode extends string> = {
  backHref: string
  backLabel: string
  banner?: ReactNode
  canRedo: boolean
  canUndo: boolean
  children: (view: { narrow: boolean; zoom: number }) => ReactNode
  dock: (narrow: boolean) => ReactNode
  extra?: ReactNode
  menu?: ReactNode
  mode?: Mode
  modes?: readonly EditorMode<Mode>[]
  onModeChange?: (mode: Mode) => void
  onRedo: () => void
  onRetrySave?: () => void
  onTitleChange: (title: string) => void
  onUndo: () => void
  /** The page's width in printed points, which Fit zooms to. */
  pageWidthPoints: number
  panel?: (narrow: boolean) => ReactNode
  primary?: ReactNode
  /** How saving stands; "blocked" waits on a fix, "unsaved-local" on Update. */
  saveStatus: AutosaveStatus | "blocked" | "unsaved-local" | null
  title: string
  titleEditable: boolean
}

/**
 * The editor's own screen: a quiet top bar, the canvas with its dock and
 * zoom, and room for a settings panel. It holds undo, redo and zoom keys.
 *
 * @param props - What the top bar shows and does, and the canvas to frame.
 * @returns The full-screen editor.
 */
export function EditorFrame<Mode extends string>({
  backHref,
  backLabel,
  banner,
  canRedo,
  canUndo,
  children,
  dock,
  extra,
  menu,
  mode,
  modes,
  onModeChange,
  onRedo,
  onRetrySave,
  onTitleChange,
  onUndo,
  pageWidthPoints,
  panel,
  primary,
  saveStatus,
  title,
  titleEditable,
}: EditorFrameProps<Mode>): ReactElement {
  const narrow = useSyncExternalStore(
    subscribeToWidth,
    () => window.matchMedia(NARROW).matches,
    () => false
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(0)
  const [chosenZoom, setChosenZoom] = useState<number | null>(null)
  const pageWidth = pageWidthPoints * POINT_PX
  // Fit keeps the page clear of the dock on either side.
  const fit = available > 0 ? clamp((available - 176) / pageWidth, 0.3, 1) : 1
  const zoom = narrow ? 1 : (chosenZoom ?? fit)

  useEffect(() => {
    const element = scrollRef.current

    if (!element) {
      return
    }

    const observer = new ResizeObserver(() => setAvailable(element.clientWidth))
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    function handleKey(event: globalThis.KeyboardEvent): void {
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (!mod) {
        return
      }

      if (key === "z" || key === "y") {
        const inField = (event.target as HTMLElement | null)?.closest("input, textarea, select")

        if (inField) {
          return
        }

        event.preventDefault()

        if (key === "y" || event.shiftKey) {
          onRedo()
        } else {
          onUndo()
        }
      } else if (key === "=" || key === "+" || key === "-") {
        event.preventDefault()
        setChosenZoom(stepZoom(zoom, key === "-" ? -1 : 1))
      } else if (key === "0") {
        event.preventDefault()
        setChosenZoom(null)
      }
    }

    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [onRedo, onUndo, zoom])

  return (
    <div className="flex h-dvh flex-col bg-canvas text-foreground" data-slot="editor">
      <header className="relative z-20 flex h-14 shrink-0 items-center gap-1 px-2 sm:px-3">
        <Link
          aria-label={backLabel}
          className={cn(buttonVariants({ size: "icon", variant: "ghost" }), "size-10 shrink-0")}
          href={backHref}
          title={backLabel}
        >
          <ArrowLeft />
        </Link>
        <input
          aria-label="Title"
          className="h-9 min-w-0 truncate rounded-[9px] bg-transparent px-2 text-[15px] font-medium outline-none transition-colors hover:bg-muted/70 focus:bg-card focus-visible:ring-2 focus-visible:ring-ring/35 disabled:hover:bg-transparent"
          disabled={!titleEditable}
          maxLength={180}
          onChange={(event) => onTitleChange(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
              event.currentTarget.blur()
            }
          }}
          style={{ width: `min(${Math.max(6, title.length + 2)}ch, 42vw)` }}
          value={title}
        />
        <SaveStatus onRetry={onRetrySave} status={saveStatus} />
        <span className="grow" />
        {modes && mode && onModeChange ? (
          <ModeSwitch mode={mode} modes={modes} narrow={narrow} onChange={onModeChange} />
        ) : null}
        {extra}
        <Button
          aria-label="Undo"
          className="size-9 md:size-10"
          disabled={!canUndo}
          onClick={onUndo}
          size="icon"
          title="Undo"
          type="button"
          variant="ghost"
        >
          <Undo2 />
        </Button>
        <Button
          aria-label="Redo"
          className="size-9 md:size-10"
          disabled={!canRedo}
          onClick={onRedo}
          size="icon"
          title="Redo"
          type="button"
          variant="ghost"
        >
          <Redo2 />
        </Button>
        {menu}
        {primary}
      </header>
      {narrow && modes && mode && onModeChange ? (
        <div className="flex justify-center pb-2">
          <ModeSwitch mode={mode} modes={modes} narrow={false} onChange={onModeChange} />
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {banner}
        <div className="absolute inset-0 overflow-auto" data-slot="editor-scroll" ref={scrollRef}>
          <div className={cn("flex min-h-full justify-center", narrow ? "pb-28" : "px-6 pt-6 pb-24")}>
            {children({ narrow, zoom })}
          </div>
        </div>
        {dock(narrow)}
        {narrow ? null : (
          <div
            className="absolute right-4 bottom-4 z-20 flex items-center gap-0.5 rounded-full border border-border bg-popover p-1 text-[13px] shadow-md"
            data-slot="editor-zoom"
          >
            <button
              aria-label="Zoom out"
              className="grid size-8 place-items-center rounded-full outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() => setChosenZoom(stepZoom(zoom, -1))}
              title="Zoom out"
              type="button"
            >
              <Minus aria-hidden="true" className="size-3.5" />
            </button>
            <button
              aria-label={chosenZoom === null ? `Zoom ${Math.round(zoom * 100)}%, fitted` : `Zoom ${Math.round(zoom * 100)}%, fit to window`}
              className="h-8 min-w-12 rounded-full px-1.5 tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() => setChosenZoom(null)}
              title="Fit"
              type="button"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              aria-label="Zoom in"
              className="grid size-8 place-items-center rounded-full outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() => setChosenZoom(stepZoom(zoom, 1))}
              title="Zoom in"
              type="button"
            >
              <Plus aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        )}
        {panel?.(narrow)}
      </div>
    </div>
  )
}

/**
 * A short floating notice over the canvas, with a few actions, such as a copy
 * to restore or Flow's suggestion to apply.
 *
 * @param props - What it says and the actions it offers.
 * @returns The notice.
 */
export function EditorNotice({
  actions,
  children,
}: {
  actions: ReadonlyArray<{ label: string; onClick: () => void }>
  children: ReactNode
}): ReactElement {
  return (
    <div
      className="absolute top-3 left-1/2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-popover py-1 pr-1 pl-4 text-sm text-popover-foreground shadow-lg"
      data-slot="editor-notice"
      role="status"
    >
      <span className="mr-1 truncate">{children}</span>
      {actions.map((action) => (
        <button
          className="h-8 shrink-0 rounded-full px-3 font-medium text-primary outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
          key={action.label}
          onClick={action.onClick}
          type="button"
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}

/**
 * A panel that opens for one thing, such as a field's settings: floating at the
 * canvas's right on a laptop, a sheet from the bottom on a phone.
 *
 * @param props - Whether it is open, its title, and its contents.
 * @returns The panel.
 */
export function EditorSidePanel({
  children,
  keepMounted = false,
  narrow,
  onClose,
  open,
  title,
}: {
  children: ReactNode
  /** Keeps what is inside alive while closed, such as a conversation. */
  keepMounted?: boolean
  narrow: boolean
  onClose: () => void
  open: boolean
  title: string
}): ReactElement | null {
  if (narrow && !keepMounted) {
    return (
      <Sheet onOpenChange={(next: boolean) => (next ? undefined : onClose())} open={open}>
        <SheetContent>
          <div className="flex items-center justify-between">
            <SheetTitle>{title}</SheetTitle>
            <SheetClose />
          </div>
          <div className="px-1 pb-2">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  if (!open && !keepMounted) {
    return null
  }

  return (
    <aside
      aria-label={title}
      className={cn(
        "absolute z-30 flex flex-col overflow-hidden rounded-[18px] border border-border bg-popover text-popover-foreground shadow-xl",
        narrow ? "inset-x-2 top-2 bottom-2" : "top-3 right-3 max-h-[calc(100%-1.5rem)] w-[22rem]"
      )}
      data-slot="editor-panel"
      hidden={!open}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h2 className="text-sm font-medium">{title}</h2>
        <Button aria-label="Close" className="size-9" onClick={onClose} size="icon" title="Close" type="button" variant="ghost">
          <X />
        </Button>
      </div>
      <div className="min-h-0 overflow-y-auto px-4 pb-4">{children}</div>
    </aside>
  )
}

function SaveStatus({
  onRetry,
  status,
}: {
  onRetry?: () => void
  status: AutosaveStatus | "blocked" | "unsaved-local" | null
}): ReactElement | null {
  if (!status) {
    return null
  }

  const text = {
    blocked: "Fix checks to save",
    "unsaved-local": "Unsaved",
    conflict: "Changed elsewhere",
    error: "Not saved",
    offline: "Offline",
    saved: "Saved",
    saving: "Saving…",
    unsaved: "Saving…",
  }[status]

  return (
    <span
      aria-live="polite"
      className="inline-flex shrink-0 items-center gap-1.5 px-1 text-[12.5px] whitespace-nowrap text-muted-foreground max-sm:sr-only"
      data-slot="save-status"
      data-status={status}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          status === "saved" ? "bg-primary/60" : status === "conflict" || status === "error" ? "bg-destructive" : "bg-muted-foreground/50"
        )}
      />
      {text}
      {status === "conflict" ? (
        <button className="underline underline-offset-2 hover:text-foreground" onClick={() => window.location.reload()} type="button">
          Reload
        </button>
      ) : status === "error" && onRetry ? (
        <button className="underline underline-offset-2 hover:text-foreground" onClick={onRetry} type="button">
          Retry
        </button>
      ) : null}
    </span>
  )
}

function ModeSwitch<Mode extends string>({
  mode,
  modes,
  narrow,
  onChange,
}: {
  mode: Mode
  modes: readonly EditorMode<Mode>[]
  narrow: boolean
  onChange: (mode: Mode) => void
}): ReactElement | null {
  if (narrow) {
    return null
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>): void {
    const index = modes.findIndex((candidate) => candidate.value === mode)
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0

    if (step === 0) {
      return
    }

    event.preventDefault()
    const group = event.currentTarget
    const next = modes[(index + step + modes.length) % modes.length]

    if (next) {
      onChange(next.value)
      requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-mode="${next.value}"]`)?.focus())
    }
  }

  return (
    <div
      aria-label="Mode"
      className="inline-flex rounded-[11px] border border-border bg-card/70 p-0.5 md:absolute md:left-1/2 md:-translate-x-1/2"
      onKeyDown={handleKey}
      role="radiogroup"
    >
      {modes.map((candidate) => (
        <button
          aria-checked={candidate.value === mode}
          className={cn(
            "h-8 rounded-[9px] px-3 text-[13px] text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
            candidate.value === mode && "bg-card text-foreground shadow-sm"
          )}
          data-mode={candidate.value}
          key={candidate.value}
          onClick={() => onChange(candidate.value)}
          role="radio"
          tabIndex={candidate.value === mode ? 0 : -1}
          type="button"
        >
          {candidate.label}
        </button>
      ))}
    </div>
  )
}

function stepZoom(current: number, direction: -1 | 1): number {
  const next =
    direction > 0
      ? ZOOM_STEPS.find((step) => step > current + 0.001)
      : [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001)

  return next ?? (direction > 0 ? 2 : 0.5)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function subscribeToWidth(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}
