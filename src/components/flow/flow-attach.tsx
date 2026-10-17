"use client"

import { LoaderCircle, Paperclip, X } from "lucide-react"
import { type ReactElement, useEffect, useEffectEvent, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { discardDocumentUpload, uploadDocumentFile } from "@/components/documents/document-upload-client"
import type { FlowSource } from "@/components/flow/flow-handoff"
import { FLOW_FILE_TYPES } from "@/types/template-flow"

// What Flow reads; the server checks every file again, by its bytes.
const TYPES: Readonly<Record<string, string>> = { jpeg: "image/jpeg", jpg: "image/jpeg", pdf: "application/pdf", png: "image/png" }
const ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
const MAX_BYTES = 15 * 1024 * 1024
const TITLE_MAX_LENGTH = 180
const OPEN_WITH = "bizflow:flow-open-with"

// Room at the message box's start for the paperclip.
export const FLOW_COMPOSER_ATTACH = "pl-10 max-md:pl-13"

/** What an empty message with a file attached asks for. */
export const RECREATE = "Recreate this form"

type Chip = Readonly<{ id?: string; name: string }>

/** A file attached to Flow: uploading, attached, or refused. */
export type FlowAttachment = Readonly<{
  attach: (file: File) => void
  chip: Chip | null
  clear: () => void
  error: string | null
  set: (source: FlowSource) => void
  /** The attached file, once it is in Files. */
  source: FlowSource | null
  uploading: boolean
}>

// A PDF, PNG or JPEG, by the type the browser gives or, without one, by its name.
function typeOf(file: File): string | null {
  const byName = TYPES[/\.([a-z]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? ""] ?? null

  return file.type ? (FLOW_FILE_TYPES.includes(file.type) ? file.type : null) : byName
}

// The folder open on the Files page, otherwise the top of Files.
function filesFolder(): string | null {
  const params = new URLSearchParams(window.location.search)

  return window.location.pathname === "/documents" && !params.get("view") ? params.get("folderId") : null
}

/**
 * A file the member attaches to Flow, uploaded into Files as any upload is,
 * and kept for the rest of the conversation until they remove it.
 *
 * @param organizationId - The workspace the file goes into.
 * @param onAdded - Told once the file is in Files.
 * @returns The attachment and the ways to change it.
 */
export function useFlowAttachment(organizationId: string, onAdded?: () => void): FlowAttachment {
  const [chip, setChip] = useState<Chip | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The upload under way, if one is: removing its chip, choosing another file
  // or closing Flow stops it and takes back its document. One already in Files stays there.
  const upload = useRef<AbortController | null>(null)
  const stop = (): void => {
    upload.current?.abort()
    upload.current = null
  }

  useEffect(() => stop, [])

  function attach(file: File): void {
    const contentType = typeOf(file)

    if (!contentType || file.size > MAX_BYTES) {
      setError(contentType ? "Attach a file of up to 15 MB." : "Attach a PDF, PNG or JPEG.")
      return
    }

    stop()
    const running = new AbortController()
    upload.current = running
    setError(null)
    setChip({ name: file.name })
    // The document an unfinished upload made, which nobody could open.
    let prepared: string | null = null

    void uploadDocumentFile({
      contentType,
      file,
      folderId: filesFolder(),
      onPrepared: (documentId) => {
        prepared = documentId
      },
      organizationId,
      signal: running.signal,
      title: file.name.replace(/\.[^.]+$/, "").trim().slice(0, TITLE_MAX_LENGTH) || "Attached form",
    }).then(
      ({ documentId }) => {
        if (running.signal.aborted) return

        upload.current = null
        setChip({ id: documentId, name: file.name })
        onAdded?.()
      },
      (reason: unknown) => {
        // Stopped or failed after the document was made: it goes too.
        if (prepared) discardDocumentUpload(prepared, organizationId)

        if (running.signal.aborted) return

        upload.current = null
        setChip(null)
        setError(reason instanceof Error ? reason.message : "That file couldn't be attached. Try again.")
      }
    )
  }

  return {
    attach,
    chip,
    clear() {
      stop()
      setChip(null)
      setError(null)
    },
    error,
    set(source) {
      stop()
      setChip(source)
      setError(null)
    },
    source: chip?.id ? { id: chip.id, name: chip.name } : null,
    uploading: chip !== null && !chip.id,
  }
}

/**
 * The paperclip inside Flow's message box, and the Flow window taking a file
 * dropped on it.
 *
 * @param props - The attachment, and whether it can change now.
 * @returns The button and its file picker.
 */
export function FlowAttachButton({ attachment, disabled }: { attachment: FlowAttachment; disabled?: boolean }): ReactElement {
  const input = useRef<HTMLInputElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  // The window a file is dragged over, while it is.
  const [over, setOver] = useState<HTMLElement | null>(null)
  const attach = useRef(attachment.attach)

  useEffect(() => {
    attach.current = attachment.attach
  })

  // The window this sits in takes a file dragged from the desktop; a phone has the paperclip.
  useEffect(() => {
    const win = button.current?.closest<HTMLElement>('[data-slot="flow-window"]')

    if (!win || disabled) return undefined

    const take = (event: DragEvent): boolean => {
      if (window.matchMedia("(width < 48rem)").matches || !event.dataTransfer?.types.includes("Files")) return false

      event.preventDefault()
      event.dataTransfer.dropEffect = "copy"
      return true
    }
    const dragOver = (event: DragEvent): void => setOver(take(event) ? win : null)
    const leave = (event: DragEvent): void => {
      if (!win.contains(event.relatedTarget as Node | null)) setOver(null)
    }
    const drop = (event: DragEvent): void => {
      const file = take(event) ? event.dataTransfer?.files[0] : undefined

      setOver(null)

      if (file) attach.current(file)
    }

    win.addEventListener("dragover", dragOver)
    win.addEventListener("dragleave", leave)
    win.addEventListener("drop", drop)

    return () => {
      setOver(null)
      win.removeEventListener("dragover", dragOver)
      win.removeEventListener("dragleave", leave)
      win.removeEventListener("drop", drop)
    }
  }, [disabled])

  return (
    <>
      <button
        aria-label="Attach a form"
        ref={button}
        className="absolute bottom-1 left-1.5 max-md:bottom-0.5 grid size-8 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-35 max-md:size-11"
        disabled={disabled}
        onClick={() => input.current?.click()}
        title="Attach a PDF, PNG or JPEG"
        type="button"
      >
        <Paperclip aria-hidden="true" className="size-4" />
      </button>
      <input
        accept={ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]

          // Choosing the same file again still attaches it.
          event.target.value = ""

          if (file) attachment.attach(file)
        }}
        ref={input}
        tabIndex={-1}
        type="file"
      />
      {over
        ? createPortal(
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-3 top-13 bottom-3 grid place-items-center rounded-lg border border-dashed border-primary/50 bg-popover/90 text-sm font-medium text-primary"
              data-slot="flow-drop"
            >
              <span className="flex items-center gap-2">
                <Paperclip className="size-4" />
                Drop to attach
              </span>
            </div>,
            over
          )
        : null}
    </>
  )
}

/**
 * The attached file above the message line, with a way to remove it, and
 * what happens to it; or why a file was refused.
 *
 * @param props - The attachment.
 * @returns The chip and its line, or nothing.
 */
export function FlowAttachChip({ attachment }: { attachment: FlowAttachment }): ReactElement | null {
  const { chip, error } = attachment

  if (!chip && !error) return null

  return (
    <div className="grid justify-items-start gap-1 pb-2">
      {chip ? (
        <span className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-border bg-card pl-2 text-xs max-md:h-9" data-slot="flow-attachment">
          {chip.id ? (
            <Paperclip aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <LoaderCircle aria-label="Uploading" className="size-3.5 shrink-0 animate-spin text-primary" role="img" />
          )}
          <span className="truncate">{chip.name}</span>
          <button
            aria-label={`Remove ${chip.name}`}
            className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 max-md:size-9"
            onClick={attachment.clear}
            type="button"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </span>
      ) : null}
      {error ? (
        <p className="px-0.5 text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : (
        <p className="px-0.5 text-[11px] text-muted-foreground">Flow reads this file.</p>
      )}
    </div>
  )
}

/**
 * Opens the workspace's Flow with a file already attached.
 *
 * @param source - The uploaded file.
 */
export function openFlowWith(source: FlowSource): void {
  window.dispatchEvent(new CustomEvent<FlowSource>(OPEN_WITH, { detail: source }))
}

/**
 * Hears a page ask Flow to open with a file attached.
 *
 * @param onOpen - Opens Flow and attaches the file.
 */
export function useFlowOpenWith(onOpen: (source: FlowSource) => void): void {
  const open = useEffectEvent(onOpen)

  useEffect(() => {
    const listener = (event: Event): void => open((event as CustomEvent<FlowSource>).detail)

    window.addEventListener(OPEN_WITH, listener)
    return () => window.removeEventListener(OPEN_WITH, listener)
  }, [])
}
