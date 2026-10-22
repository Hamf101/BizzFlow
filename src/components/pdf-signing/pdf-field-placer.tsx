"use client"

import {
  ArrowLeft,
  Calendar,
  CaseSensitive,
  ChevronDown,
  FileSignature,
  type LucideIcon,
  Paperclip,
  PenLine,
  SquareCheck,
  TextCursorInput,
  Trash2,
} from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  useState,
} from "react"

import { savePdfFieldsAction, sendPdfForSigningAction } from "@/app/(editor)/documents/[documentId]/fields/actions"
import { SaveStatus } from "@/components/editor/editor-frame"
import { useAutosave } from "@/components/editor/use-autosave"
import { shownSize, signerTone } from "@/components/pdf-signing/pdf-tones"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SubmitButton } from "@/components/ui/submit-button"
import { Switch } from "@/components/ui/switch"
import { clamp, cn } from "@/lib/utils"
import type { PdfFieldEditorView } from "@/services/pdf-signing-service"
import type { PdfField, PdfFieldKind, PdfFieldLayout } from "@/types/pdf-fields"

/** Each kind of field: its name, its mark, and its size when placed, in points, about a signature line's height. */
const FIELD_KINDS: ReadonlyArray<Readonly<{ icon: LucideIcon; kind: PdfFieldKind; label: string; size: readonly [number, number] }>> = [
  { icon: FileSignature, kind: "signature", label: "Signature", size: [160, 30] },
  { icon: CaseSensitive, kind: "initials", label: "Initials", size: [56, 26] },
  { icon: Calendar, kind: "date", label: "Date", size: [96, 18] },
  { icon: TextCursorInput, kind: "text", label: "Text", size: [160, 18] },
  { icon: SquareCheck, kind: "checkbox", label: "Checkbox", size: [14, 14] },
  { icon: Paperclip, kind: "attachment", label: "Attachment", size: [150, 20] },
]
// pdf.js needs the browser's document, so the pages draw there only.
const PdfPages = dynamic(() => import("@/components/pdf-signing/pdf-pages").then((module) => module.PdfPages), { ssr: false })
const KIND = new Map(FIELD_KINDS.map((entry) => [entry.kind, entry]))
// The smallest a field may be made (the layout schema's floor), and how far a key moves one.
const MIN_WIDTH = 0.02
const MIN_HEIGHT = 0.012
const NUDGE = 0.005

/**
 * Lays fields for each signer on an uploaded PDF, page first: a floating bar
 * picks whose field and which kind, a tap on the page puts it there, and a
 * field moves by dragging or with the arrow keys. Changes save as they're made.
 *
 * @param props - The PDF's pages, signers, fields and status.
 * @returns The placing screen.
 */
export function PdfFieldPlacer({ view }: { view: PdfFieldEditorView }): ReactElement {
  const editable = view.workflowStatus === "draft"
  const [layout, setLayout] = useState<PdfFieldLayout>(view.layout)
  const [signerId, setSignerId] = useState(view.layout.signers[0]!.id)
  const [armed, setArmed] = useState<PdfFieldKind | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [naming, setNaming] = useState<"add" | "rename" | null>(null)
  const [sending, setSending] = useState(false)
  const autosave = useAutosave({
    enabled: editable,
    initialVersion: String(view.revision),
    save: (value: PdfFieldLayout, version: string) => savePdfFieldsAction({ documentId: view.documentId, expectedRevision: Number(version), layout: value }),
    value: layout,
  })
  const signerIndex = new Map(layout.signers.map((signer, index) => [signer.id, index]))
  const active = layout.signers.find((signer) => signer.id === signerId) ?? layout.signers[0]!
  const file = `/api/documents/${encodeURIComponent(view.documentId)}/pdf-source`

  const change = (id: string, patch: Partial<PdfField>): void =>
    setLayout((current) => ({ ...current, fields: current.fields.map((field) => (field.id === id ? { ...field, ...patch } : field)) }))
  const remove = (id: string): void => {
    setLayout((current) => ({ ...current, fields: current.fields.filter((field) => field.id !== id) }))
    setSelected(null)
  }

  /**
   * Adds a field at a point of a page, given as fractions of it, and kept on
   * the page: centred across, and with its foot at the point when it is
   * tapped, as people tap the line a signature goes on.
   */
  function add(kind: PdfFieldKind, pageNumber: number, at: { x: number; y: number }, foot = false): string {
    const page = shownSize(view.pages[pageNumber - 1]!)
    const [w, h] = KIND.get(kind)!.size
    const width = Math.min(1, w / page.width)
    const height = Math.min(1, h / page.height)
    const field: PdfField = {
      fontSize: null,
      height,
      id: crypto.randomUUID(),
      kind,
      label: null,
      page: pageNumber,
      required: true,
      signerId: active.id,
      width,
      x: clamp(at.x - width / 2, 0, 1 - width),
      y: clamp(foot ? at.y - height : at.y - height / 2, 0, 1 - height),
    }
    setLayout((current) => ({ ...current, fields: [...current.fields, field] }))
    setSelected(field.id)
    setArmed(null)
    return field.id
  }

  function place(pageNumber: number, event: ReactPointerEvent<HTMLDivElement>): void {
    if (!armed) return
    const rect = event.currentTarget.getBoundingClientRect()
    add(armed, pageNumber, { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }, true)
  }

  /** From the keyboard: in the middle of the page in view, focused so the arrow keys move it. */
  function addFromKeyboard(kind: PdfFieldKind): void {
    const middle = window.innerHeight / 2
    const pages = [...document.querySelectorAll<HTMLElement>("[data-page]")]
    const shown = pages.find((page) => page.getBoundingClientRect().bottom > middle) ?? pages[0]
    const id = add(kind, Number(shown?.dataset.page ?? 1), { x: 0.5, y: 0.5 })
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-field-id="${id}"]`)?.focus())
  }

  function drag(event: ReactPointerEvent<HTMLElement>, field: PdfField, mode: "move" | "resize"): void {
    if (!editable || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    setSelected(field.id)
    const target = event.currentTarget
    const rect = target.closest("[data-pdf-overlay]")!.getBoundingClientRect()
    const start = { x: event.clientX, y: event.clientY }
    target.setPointerCapture(event.pointerId)
    const onMove = (moved: PointerEvent): void => {
      const dx = (moved.clientX - start.x) / rect.width
      const dy = (moved.clientY - start.y) / rect.height
      change(
        field.id,
        mode === "move"
          ? { x: clamp(field.x + dx, 0, 1 - field.width), y: clamp(field.y + dy, 0, 1 - field.height) }
          : { height: clamp(field.height + dy, MIN_HEIGHT, 1 - field.y), width: clamp(field.width + dx, MIN_WIDTH, 1 - field.x) }
      )
    }
    const onUp = (): void => {
      target.removeEventListener("pointermove", onMove)
      target.removeEventListener("pointerup", onUp)
      target.removeEventListener("pointercancel", onUp)
    }
    target.addEventListener("pointermove", onMove)
    target.addEventListener("pointerup", onUp)
    target.addEventListener("pointercancel", onUp)
  }

  function nudge(event: KeyboardEvent<HTMLElement>, field: PdfField): void {
    const step = event.shiftKey ? NUDGE * 5 : NUDGE
    const moves: Record<string, [number, number]> = { ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step] }
    const move = moves[event.key]

    if (move && editable) {
      event.preventDefault()
      change(field.id, { x: clamp(field.x + move[0], 0, 1 - field.width), y: clamp(field.y + move[1], 0, 1 - field.height) })
    } else if ((event.key === "Delete" || event.key === "Backspace") && editable) {
      event.preventDefault()
      remove(field.id)
    } else if (event.key === "Escape") {
      setSelected(null)
      event.currentTarget.blur()
    }
  }

  return (
    <div className="min-h-dvh bg-muted/40">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border/70 bg-background/95 px-3 backdrop-blur sm:px-5">
        <Link aria-label="Back to the document" className="grid size-9 place-items-center rounded-md hover:bg-muted" href={`/documents/${encodeURIComponent(view.documentId)}`}>
          <ArrowLeft aria-hidden="true" className="size-4" />
        </Link>
        <h1 className="min-w-0 truncate text-sm font-medium">{view.title}</h1>
        <span className="shrink-0 text-xs text-muted-foreground max-sm:hidden">
          {view.pages.length} {view.pages.length === 1 ? "page" : "pages"}
        </span>
        <span className="ml-auto" />
        {editable ? <SaveStatus status={autosave.status} /> : null}
        {editable ? (
          <Button onClick={() => setSending(true)}>
            <PenLine aria-hidden="true" />
            Send for signature
          </Button>
        ) : null}
      </header>

      {!editable ? (
        <p className="mx-auto mt-4 max-w-[820px] rounded-md border border-border bg-card px-4 py-3 text-sm" role="status">
          Sent for signature to {view.recipients.map((recipient) => recipient.name).join(", ")}. Its fields can&apos;t change now.
        </p>
      ) : null}

      <main className="px-3 pt-5 pb-32 sm:px-6">
        <PdfPages
          file={file}
          overlay={(pageNumber) => (
            <div
              className={cn("absolute inset-0", armed && "cursor-crosshair")}
              data-pdf-overlay
              onPointerDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (armed) place(pageNumber, event)
                else setSelected(null)
              }}
            >
              {layout.fields
                .filter((field) => field.page === pageNumber)
                .map((field) => {
                  const kind = KIND.get(field.kind)!
                  const owner = layout.signers.find((signer) => signer.id === field.signerId)
                  const isSelected = field.id === selected

                  return (
                    <div
                      aria-label={`${kind.label} for ${owner?.name ?? "a signer"}${field.required ? "" : ", optional"}`}
                      aria-pressed={isSelected}
                      className={cn(
                        // See-through, so the line and words under a field still show.
                        "absolute flex touch-none items-center gap-1 overflow-hidden rounded-sm border-[1.5px] border-(--tone) bg-(--tone-soft)/65 px-1 text-[11px] leading-[1.2] text-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        editable && "cursor-move",
                        isSelected && "ring-2 ring-(--tone) ring-offset-1 ring-offset-card",
                        !field.required && "border-dashed"
                      )}
                      data-field-id={field.id}
                      data-field-kind={field.kind}
                      data-slot="pdf-field"
                      key={field.id}
                      onFocus={() => setSelected(field.id)}
                      onKeyDown={(event) => nudge(event, field)}
                      onPointerDown={(event) => drag(event, field, "move")}
                      role="button"
                      style={{
                        ...signerTone(signerIndex.get(field.signerId) ?? 0),
                        height: `${field.height * 100}%`,
                        left: `${field.x * 100}%`,
                        top: `${field.y * 100}%`,
                        width: `${field.width * 100}%`,
                      }}
                      tabIndex={0}
                    >
                      <kind.icon aria-hidden="true" className="size-3 shrink-0 text-(--tone)" />
                      {field.kind === "checkbox" ? null : <span className="truncate">{field.label ?? kind.label}</span>}
                      {isSelected && editable ? (
                        <span
                          aria-hidden="true"
                          className="absolute right-0 bottom-0 size-3 cursor-nwse-resize rounded-tl-sm bg-(--tone)"
                          onPointerDown={(event) => drag(event, field, "resize")}
                        />
                      ) : null}
                    </div>
                  )
                })}
              {editable ? (
                <FieldTools
                  field={layout.fields.find((field) => field.id === selected && field.page === pageNumber)}
                  onChange={change}
                  onRemove={remove}
                  signers={layout.signers}
                />
              ) : null}
            </div>
          )}
          pages={view.pages}
        />
      </main>

      {editable ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 flex flex-col items-center gap-2 px-3">
          <p aria-live="polite" className="rounded-full bg-foreground/85 px-3 py-1 text-xs text-background empty:hidden">
            {armed ? `Tap the page where ${active.name}'s ${KIND.get(armed)!.label.toLowerCase()} goes` : ""}
          </p>
          <div
            aria-label="Add a field"
            className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-popover p-1 text-popover-foreground shadow-[0_8px_24px_rgba(37,35,41,0.14)]"
            role="toolbar"
          >
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Fields are for ${active.name}. Change who`}
                className="flex h-9 max-w-36 items-center gap-1.5 rounded-full bg-(--tone-soft) pr-2 pl-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                style={signerTone(signerIndex.get(active.id) ?? 0)}
              >
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-(--tone)" />
                <span className="truncate">{active.name}</span>
                <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                <DropdownMenuRadioGroup onValueChange={(value) => setSignerId(String(value))} value={active.id}>
                  {layout.signers.map((signer, index) => (
                    <DropdownMenuRadioItem key={signer.id} value={signer.id}>
                      <span aria-hidden="true" className="size-2 rounded-full bg-(--tone)" style={signerTone(index)} />
                      {signer.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                {layout.signers.length < 10 ? <DropdownMenuItem onClick={() => setNaming("add")}>Add a signer</DropdownMenuItem> : null}
                <DropdownMenuItem onClick={() => setNaming("rename")}>Rename {active.name}</DropdownMenuItem>
                {layout.signers.length > 1 && !layout.fields.some((field) => field.signerId === active.id) ? (
                  <DropdownMenuItem
                    onClick={() => {
                      const rest = layout.signers.filter((signer) => signer.id !== active.id)
                      setLayout((current) => ({ ...current, signers: rest }))
                      setSignerId(rest[0]!.id)
                    }}
                  >
                    Remove {active.name}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            {FIELD_KINDS.map((entry) => (
              <button
                aria-label={entry.label}
                aria-pressed={armed === entry.kind}
                className="grid size-9 place-items-center rounded-full outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                key={entry.kind}
                // A click arms the tool for a tap on the page; a key press places the field at once.
                onClick={(event) => (event.detail === 0 ? addFromKeyboard(entry.kind) : setArmed((current) => (current === entry.kind ? null : entry.kind)))}
                title={entry.label}
                type="button"
              >
                <entry.icon aria-hidden="true" className="size-4.5" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <SignerNameDialog
        initial={naming === "rename" ? active.name : `Signer ${layout.signers.length + 1}`}
        mode={naming}
        onClose={() => setNaming(null)}
        onSave={(name) => {
          if (naming === "rename") {
            setLayout((current) => ({ ...current, signers: current.signers.map((signer) => (signer.id === active.id ? { ...signer, name } : signer)) }))
          } else {
            const added = { id: crypto.randomUUID(), name }
            setLayout((current) => ({ ...current, signers: [...current.signers, added] }))
            setSignerId(added.id)
          }
          setNaming(null)
        }}
        taken={layout.signers.filter((signer) => naming === "add" || signer.id !== active.id).map((signer) => signer.name.toLowerCase())}
      />
      <SendDialog flush={autosave.flush} layout={layout} onClose={() => setSending(false)} open={sending} view={view} />
    </div>
  )
}

/** Over the chosen field: whose it is, whether it must be filled, and a way to remove it. */
function FieldTools({
  field,
  onChange,
  onRemove,
  signers,
}: {
  field: PdfField | undefined
  onChange: (id: string, patch: Partial<PdfField>) => void
  onRemove: (id: string) => void
  signers: PdfFieldLayout["signers"]
}): ReactElement | null {
  if (!field) return null
  const below = field.y + field.height < 0.9

  return (
    <div
      className={cn(
        "absolute z-10 flex items-center gap-1 rounded-full border border-border bg-popover p-0.5 pl-2 text-xs text-popover-foreground shadow-sm",
        below ? "translate-y-1.5" : "-translate-y-[calc(100%+6px)]"
      )}
      onPointerDown={(event) => event.stopPropagation()}
      // Under the field, where the fields placed above it stay clear; over it at a page's foot.
      style={{ left: `${Math.min(field.x, 0.6) * 100}%`, top: `${(below ? field.y + field.height : field.y) * 100}%` }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-7 items-center gap-1 rounded-full px-1.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50">
          {signers.find((signer) => signer.id === field.signerId)?.name ?? "Signer"}
          <ChevronDown aria-hidden="true" className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup onValueChange={(value) => onChange(field.id, { signerId: String(value) })} value={field.signerId}>
            {signers.map((signer, index) => (
              <DropdownMenuRadioItem key={signer.id} value={signer.id}>
                <span aria-hidden="true" className="size-2 rounded-full bg-(--tone)" style={signerTone(index)} />
                {signer.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <label className="flex h-7 items-center gap-1.5 rounded-full px-1.5">
        Required
        <Switch checked={field.required} onCheckedChange={(required) => onChange(field.id, { required })} size="sm" />
      </label>
      <button
        aria-label="Remove this field"
        className="grid size-7 place-items-center rounded-full outline-none hover:bg-muted hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => onRemove(field.id)}
        type="button"
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  )
}

function SignerNameDialog({
  initial,
  mode,
  onClose,
  onSave,
  taken,
}: {
  initial: string
  mode: "add" | "rename" | null
  onClose: () => void
  onSave: (name: string) => void
  taken: readonly string[]
}): ReactElement {
  const [error, setError] = useState("")

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={mode !== null}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>{mode === "rename" ? "Rename this signer" : "Add a signer"}</DialogTitle>
        <DialogDescription>A role, such as Tenant or Landlord. You add their name and email when you send it.</DialogDescription>
        <form
          className="grid gap-3"
          key={`${mode}-${initial}`}
          onSubmit={(event) => {
            event.preventDefault()
            const name = String(new FormData(event.currentTarget).get("name") ?? "").trim()
            if (!name || name.length > 60) return setError("Give the signer a name of up to 60 characters.")
            if (taken.includes(name.toLowerCase())) return setError("Another signer already has that name.")
            setError("")
            onSave(name)
          }}
        >
          <Label htmlFor="signer-name">Name</Label>
          <Input aria-describedby={error ? "signer-name-error" : undefined} aria-invalid={Boolean(error)} autoFocus defaultValue={initial} id="signer-name" maxLength={60} name="name" />
          {error ? (
            <p className="text-sm text-destructive" id="signer-name-error">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit">{mode === "rename" ? "Rename" : "Add"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SendDialog({
  flush,
  layout,
  onClose,
  open,
  view,
}: {
  flush: () => Promise<boolean>
  layout: PdfFieldLayout
  onClose: () => void
  open: boolean
  view: PdfFieldEditorView
}): ReactElement {
  const [error, setError] = useState("")
  const empty = layout.signers.filter((signer) => !layout.fields.some((field) => field.signerId === signer.id))

  return (
    <Dialog onOpenChange={(next) => !next && onClose()} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Send for signature</DialogTitle>
        <DialogDescription>Each person gets their own private link and fills only their fields.</DialogDescription>
        {empty.length > 0 ? (
          <p className="text-sm text-destructive" role="alert">
            Give {empty.map((signer) => signer.name).join(" and ")} at least one field first.
          </p>
        ) : (
          <form
            action={async (formData: FormData) => {
              // The fields as they are now are what everyone signs.
              if (!(await flush())) return setError("Your latest changes didn't save. Try again in a moment.")
              setError("")
              formData.set(
                "recipients",
                JSON.stringify(layout.signers.map((signer) => ({ email: formData.get(`email-${signer.id}`), name: formData.get(`name-${signer.id}`), signerId: signer.id })))
              )
              await sendPdfForSigningAction(formData)
            }}
            className="grid gap-4"
          >
            <input name="documentId" type="hidden" value={view.documentId} />
            {layout.signers.map((signer, index) => (
              <fieldset className="grid gap-2" key={signer.id}>
                <legend className="mb-1 flex items-center gap-2 text-sm font-medium" style={signerTone(index)}>
                  <span aria-hidden="true" className="size-2 rounded-full bg-(--tone)" />
                  {signer.name}
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input aria-label={`${signer.name}'s name`} autoComplete="off" maxLength={120} name={`name-${signer.id}`} placeholder="Jordan Ellis" required />
                  <Input aria-label={`${signer.name}'s email`} autoComplete="off" maxLength={254} name={`email-${signer.id}`} placeholder="jordan@example.com" required type="email" />
                </div>
              </fieldset>
            ))}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <SubmitButton pendingText="Sending…">Send</SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
