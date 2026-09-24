import { FileText, Folder } from "lucide-react"
import Link from "next/link"
import type { ReactElement, ReactNode } from "react"

import type { WorkflowStatusLook } from "@/components/files/file-list-view"
import {
  PAGE_SIZES,
  PAPER_FRAME,
  TemplatePageThumbnail,
} from "@/components/templates/template-page-thumbnail"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { TemplateContent } from "@/types/template"

/** One folder or document, as every Files layout draws it. */
export type FileEntry = {
  /** A generated document's first page, when it was read. */
  content: TemplateContent | null
  /** How many items a folder holds; null for a document. */
  count: number | null
  /** An upload's file type, such as PDF. */
  extension: string | null
  /** Where the entry opens: into a folder, or the document itself. */
  href: string
  id: string
  kind: "document" | "folder" | "upload"
  /** The entry's actions, where the member may manage it. */
  menu: ReactNode
  modified: string
  name: string
  /** For something in Trash, when it goes for good. */
  note: string | null
  /** Where choosing the entry in Columns or Gallery leads. */
  selectHref: string
  status: WorkflowStatusLook | null
  /** Folder, Document, or File. */
  type: string
}

/** How large a file is drawn, from a filmstrip frame to the Gallery stage. */
export type FileArtSize = "film" | "icon" | "preview" | "stage"

const FOLDER_ART: Record<FileArtSize, string> = {
  film: "size-10 opacity-75",
  icon: "size-[60px] sm:size-[74px]",
  preview: "size-[110px]",
  stage: "size-[168px]",
}

/**
 * Draws a folder, a generated document's real first page, or an upload as a
 * plain sheet labelled with its file type.
 *
 * @param props - The entry and the size to draw it at.
 * @returns A decorative picture of the entry.
 */
export function FileArt({
  entry,
  size,
}: {
  entry: FileEntry
  size: FileArtSize
}): ReactElement {
  if (entry.kind === "folder") {
    return (
      <Folder
        aria-hidden="true"
        className={cn("shrink-0 text-primary", FOLDER_ART[size])}
        strokeWidth={1.05}
      />
    )
  }

  if (entry.kind === "document") {
    return (
      <TemplatePageThumbnail content={entry.content} size={size} title={entry.name} />
    )
  }

  const large = size === "preview" || size === "stage"

  return (
    <span
      aria-hidden="true"
      className={cn(
        PAPER_FRAME,
        "grid aspect-[595/842] place-items-center",
        PAGE_SIZES[size].frame
      )}
      data-document-surface="paper"
      data-slot="file-upload-page"
    >
      <FileText
        className={cn("text-muted-foreground/50", large ? "size-10" : "size-4")}
        strokeWidth={1.25}
      />
      {entry.extension ? (
        <span
          className={cn(
            "absolute right-0 bottom-0 rounded-tl-[3px] bg-primary px-1 font-mono font-semibold tracking-[0.05em] text-primary-foreground",
            large ? "text-[11px] leading-5" : "text-[8px] leading-[1.4]"
          )}
        >
          {entry.extension}
        </span>
      ) : null}
    </span>
  )
}

/**
 * Marks where a generated document stands with a coloured dot, like a Finder
 * tag. The label is read aloud unless the dot sits inside a link or a line
 * that already says it.
 *
 * @param props - The status, whether to speak its label, and extra classes.
 * @returns The dot, or nothing for a document without a status.
 */
export function StatusDot({
  className,
  labelled = true,
  status,
}: {
  className?: string
  labelled?: boolean
  status: WorkflowStatusLook | null
}): ReactElement | null {
  if (!status) {
    return null
  }

  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "inline-block size-2 shrink-0 rounded-full",
          status.tone === "warning" ? "bg-warning" : "bg-success",
          className
        )}
        data-slot="file-status"
        data-tone={status.tone}
        title={status.label}
      />
      {labelled ? <span className="sr-only">{status.label}</span> : null}
    </>
  )
}

/**
 * Describes the chosen file: its status, where it sits, when it changed, what
 * it is, and how to open or act on it.
 *
 * @param props - The entry, its folder path, and whether to centre the text.
 * @returns The entry's details and actions.
 */
export function FileDetails({
  centered = false,
  entry,
  folder,
}: {
  centered?: boolean
  entry: FileEntry
  folder: string
}): ReactElement {
  return (
    <div
      className={cn(
        "grid w-full content-start gap-3 text-[12.5px]",
        centered ? "justify-items-center text-center" : "justify-items-start"
      )}
      data-slot="file-details"
    >
      <h2 className="text-[15px] leading-snug font-semibold text-balance">
        {entry.name}
      </h2>
      {entry.status ? (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <StatusDot labelled={false} status={entry.status} />
          {entry.status.label}
        </span>
      ) : null}
      {/* Centred under a page, the list keeps its own width so it sits in the
          middle rather than hugging the left edge. */}
      <dl
        className={cn(
          "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-left",
          centered ? "max-w-full" : "w-full"
        )}
      >
        <dt className="text-muted-foreground">Folder</dt>
        <dd className="min-w-0 truncate">{folder}</dd>
        <dt className="text-muted-foreground">Modified</dt>
        <dd className="tabular-nums">{entry.modified}</dd>
        <dt className="text-muted-foreground">Type</dt>
        <dd>{entry.type}</dd>
        {entry.count === null ? null : (
          <>
            <dt className="text-muted-foreground">Items</dt>
            <dd className="tabular-nums">{entry.count}</dd>
          </>
        )}
        {entry.note ? (
          <>
            <dt className="text-muted-foreground">Trash</dt>
            <dd data-slot="file-retention">{entry.note}</dd>
          </>
        ) : null}
      </dl>
      <div className="flex items-center gap-1.5">
        <Link
          className={cn(buttonVariants({ size: "sm", variant: "outline" }), "rounded-[9px]")}
          href={entry.href}
        >
          Open
        </Link>
        {entry.menu}
      </div>
    </div>
  )
}
