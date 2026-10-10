import { ChevronRight, FileText, Folder } from "lucide-react"
import Link from "next/link"
import type { CSSProperties, ReactElement } from "react"

import { ColumnsScroller } from "@/components/files/columns-scroller"
import {
  FileArt,
  FileDetails,
  StatusDot,
  type FileEntry,
} from "@/components/files/file-entry"
import { SelectableFileItem } from "@/components/files/file-selection"
import { cn } from "@/lib/utils"

// Below `lg` a row keeps its name, its date under it, and its menu.
const LIST_GRID =
  "lg:grid-cols-[minmax(14rem,1fr)_minmax(8rem,.3fr)_minmax(6rem,.25fr)_2.5rem]"

/** Items rise in one after another; later ones share the last step's delay. */
const MAX_STAGGERED_ITEMS = 10
const STAGGER_MS = 25
const RISE =
  "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-backwards motion-safe:[--tw-animation-delay:var(--row-delay)]"

/** One column of the Columns layout: a folder's contents along the path. */
export type FileColumn = {
  entries: FileEntry[]
  label: string
  location: string | null
  /** The next folder along the path, or the chosen item in the last column. */
  selected: string | null
}

function riseDelay(index: number): CSSProperties {
  return {
    "--row-delay": `${Math.min(index, MAX_STAGGERED_ITEMS) * STAGGER_MS}ms`,
  } as CSSProperties
}

function describeCount(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`
}

/**
 * Rows in the People pattern: each name first, then when it changed and what
 * it is, with its status dot beside the name. A ⌘-, Ctrl-, or Shift-click
 * selects a row instead of opening it.
 *
 * @param props - The open folder's entries and the chosen one.
 * @returns The List layout.
 */
export function FileListLayout({
  entries,
  selected,
}: {
  entries: FileEntry[]
  selected: string | null
}): ReactElement {
  return (
    <div
      aria-label="Files"
      className="flex flex-col gap-1"
      data-slot="file-directory"
      role="table"
    >
      <div
        className={cn(
          "hidden gap-4 px-3 py-2 text-[11px] font-normal tracking-[0.08em] text-muted-foreground uppercase lg:grid",
          LIST_GRID
        )}
        role="row"
      >
        {/* Every row leads with its icon, so the heading starts where the
            names do. */}
        <span className="pl-[30px]" role="columnheader">
          Name
        </span>
        <span role="columnheader">Modified</span>
        <span role="columnheader">Type</span>
        <span className="sr-only" role="columnheader">
          Actions
        </span>
      </div>
      {entries.map((entry: FileEntry, index: number) => {
        const Icon = entry.kind === "folder" ? Folder : FileText

        return (
          <SelectableFileItem
            className={cn(
              "grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] px-1 py-1.5 transition-colors hover:bg-card/65 lg:gap-4 lg:px-3",
              RISE,
              LIST_GRID,
              entry.id === selected && "bg-secondary/70"
            )}
            itemId={entry.id}
            key={entry.id}
            role="row"
            slot="file-row"
            style={riseDelay(index)}
          >
            <div className="flex min-w-0 items-center gap-3" role="cell">
              <Icon
                aria-hidden="true"
                className={cn(
                  "size-[18px] shrink-0",
                  entry.kind === "folder" ? "text-primary" : "text-muted-foreground"
                )}
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <Link
                    className="min-w-0 truncate rounded-[6px] text-sm font-medium text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/35"
                    data-slot="file-name"
                    href={entry.href}
                  >
                    {entry.name}
                  </Link>
                  <StatusDot status={entry.status} />
                </span>
                <span className="text-xs text-muted-foreground tabular-nums lg:hidden">
                  <span className="sr-only">Modified </span>
                  {entry.modified}
                </span>
                {entry.note ? (
                  <span className="text-xs text-muted-foreground" data-slot="file-retention">
                    {entry.note}
                  </span>
                ) : null}
              </div>
            </div>
            <span
              className="hidden text-sm text-muted-foreground tabular-nums lg:block"
              role="cell"
            >
              {entry.modified}
            </span>
            <span
              className="hidden truncate text-sm text-muted-foreground lg:block"
              data-slot="file-kind"
              role="cell"
            >
              {entry.type}
            </span>
            <div className="justify-self-end" role="cell">
              {/* Holds the menu's place, so every row's columns line up. */}
              {entry.menu ?? <span aria-hidden="true" className="block size-8" />}
            </div>
          </SelectableFileItem>
        )
      })}
    </div>
  )
}

/**
 * Cards the way Templates draws them: the name over the item's picture and
 * its date under it. The name's link covers the whole card; the menu sits in
 * the card's corner on wide screens and at its foot on phones, never on the
 * picture. A ⌘-, Ctrl-, or Shift-click selects a card instead of opening it.
 *
 * @param props - The open folder's entries, the chosen one, and extra classes.
 * @returns The Icons layout.
 */
export function FileIconsLayout({
  className,
  entries,
  selected,
}: {
  className?: string
  entries: FileEntry[]
  selected: string | null
}): ReactElement {
  return (
    <ul
      aria-label="Files"
      className={cn(
        "grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-4 xl:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]",
        className
      )}
      data-slot="file-icons"
    >
      {entries.map((entry: FileEntry, index: number) => (
        <SelectableFileItem
          as="li"
          className={cn(
            "group/tile relative grid min-w-0 grid-rows-[auto_1fr_auto] overflow-hidden rounded-[12px] border border-border bg-card/70 transition-[translate,box-shadow,border-color,background-color] duration-200 active:scale-[0.98] sm:hover:border-primary/35 sm:hover:shadow-[0_10px_24px_rgba(37,35,41,0.1)] sm:motion-safe:hover:-translate-y-0.5",
            RISE,
            entry.id === selected && "border-primary/45 bg-secondary/70"
          )}
          itemId={entry.id}
          key={entry.id}
          slot="file-tile"
          style={riseDelay(index)}
        >
          <div className="flex min-w-0 items-start gap-1.5 px-2.5 pt-2.5 pb-2 sm:px-3.5 sm:pt-3">
            <StatusDot className="mt-[5px]" status={entry.status} />
            <Link
              className="line-clamp-2 min-h-[2.6em] min-w-0 flex-1 rounded-[6px] text-[11.5px] leading-[1.3] font-medium text-balance break-words text-foreground outline-none after:absolute after:inset-0 after:rounded-[12px] hover:text-primary focus-visible:after:ring-2 focus-visible:after:ring-ring/35 sm:line-clamp-1 sm:min-h-0 sm:text-[13.5px] sm:leading-snug"
              data-slot="file-name"
              href={entry.href}
            >
              {entry.name}
            </Link>
            {entry.menu ? (
              // Above the card's own link, so the menu opens instead of the item.
              <div className="relative z-10 -my-1 -mr-1.5 max-sm:absolute max-sm:right-1.5 max-sm:bottom-0 max-sm:m-0">
                {entry.menu}
              </div>
            ) : null}
          </div>
          <div
            className={cn(
              "mx-1.5 grid h-[104px] justify-items-center overflow-hidden rounded-t-[8px] bg-card/45 sm:h-[150px]",
              entry.kind === "folder" ? "place-items-center" : "pt-3 sm:pt-4"
            )}
          >
            <FileArt entry={entry} size="card" />
          </div>
          <span
            className={cn(
              "truncate border-t border-border/60 px-2.5 py-2 text-[10.5px] text-muted-foreground tabular-nums sm:px-3.5 sm:py-2.5 sm:text-xs",
              entry.menu && "max-sm:pr-10"
            )}
            data-slot={entry.note ? "file-retention" : "file-meta"}
          >
            {entry.note ??
              (entry.count === null ? entry.modified : describeCount(entry.count))}
          </span>
        </SelectableFileItem>
      ))}
    </ul>
  )
}

/**
 * Finder's columns: one per folder along the path, the next folder marked in
 * each, then a preview of the chosen file at the end.
 *
 * @param props - The columns, the chosen entry, and its folder path.
 * @returns The Columns layout.
 */
export function FileColumnsLayout({
  chosen,
  columns,
  folder,
}: {
  chosen: FileEntry | null
  columns: FileColumn[]
  folder: string
}): ReactElement {
  return (
    <ColumnsScroller
      className="flex min-h-[380px] overflow-x-auto rounded-[12px] border border-border bg-card/55"
      data-slot="file-columns"
    >
      {columns.map((column: FileColumn) => (
        <ul
          aria-label={column.label}
          className="flex w-[210px] shrink-0 flex-col gap-px border-r border-border p-1.5"
          key={column.location ?? "top"}
        >
          {column.entries.map((entry: FileEntry) => {
            const Icon = entry.kind === "folder" ? Folder : FileText
            const on = entry.id === column.selected

            return (
              <li key={entry.id}>
                <Link
                  aria-current={on ? "true" : undefined}
                  className={cn(
                    "flex min-w-0 items-center gap-2 rounded-[8px] px-2 py-1.5 text-[12.5px] outline-none transition-colors hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring/35",
                    on && "bg-secondary text-secondary-foreground hover:bg-secondary"
                  )}
                  data-slot="file-cell"
                  href={entry.selectHref}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "size-[15px] shrink-0",
                      entry.kind !== "folder"
                        ? "text-muted-foreground"
                        : on
                          ? "text-secondary-foreground"
                          : "text-primary"
                    )}
                  />
                  <span className="min-w-0 truncate">{entry.name}</span>
                  <StatusDot status={entry.status} />
                  {entry.kind === "folder" ? (
                    <ChevronRight
                      aria-hidden="true"
                      className="ml-auto size-3 shrink-0 text-muted-foreground"
                    />
                  ) : null}
                </Link>
              </li>
            )
          })}
          {column.entries.length === 0 ? (
            <li className="px-2 py-1.5 text-[12.5px] text-muted-foreground">Empty</li>
          ) : null}
        </ul>
      ))}
      <div
        className="grid min-w-[250px] flex-1 content-start justify-items-center gap-4 px-5 py-6"
        data-slot="file-preview"
      >
        {chosen ? (
          <>
            <FileArt entry={chosen} size="preview" />
            <FileDetails centered entry={chosen} folder={folder} />
          </>
        ) : null}
      </div>
    </ColumnsScroller>
  )
}

/**
 * One large page with the folder as a filmstrip under it and the chosen
 * file's details beside it.
 *
 * @param props - The chosen entry, the open folder's entries, and the path.
 * @returns The Gallery layout.
 */
export function FileGalleryLayout({
  chosen,
  entries,
  folder,
}: {
  chosen: FileEntry
  entries: FileEntry[]
  folder: string
}): ReactElement {
  return (
    <div
      className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]"
      data-slot="file-gallery"
    >
      <div className="grid min-w-0 content-start justify-items-center gap-5 pt-5 pb-1.5">
        <div className="grid min-h-[300px] place-items-center" data-slot="file-stage">
          <FileArt entry={chosen} size="stage" />
        </div>
        <ul
          aria-label="Files in this folder"
          className="flex max-w-full flex-wrap justify-center gap-2.5"
        >
          {entries.map((entry: FileEntry) => {
            const on = entry.id === chosen.id

            return (
              <li key={entry.id}>
                <Link
                  aria-current={on ? "true" : undefined}
                  className={cn(
                    "grid min-h-[65px] w-[46px] place-items-center rounded-[4px] opacity-75 outline-none transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/35",
                    // A ring, not an outline: `outline-none` would hide an outline.
                    on &&
                      "opacity-100 ring-2 ring-primary ring-offset-2 ring-offset-background"
                  )}
                  data-slot="file-film"
                  href={entry.selectHref}
                  title={entry.name}
                >
                  <FileArt entry={entry} size="film" />
                  <span className="sr-only">{entry.name}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="pt-5">
        <FileDetails entry={chosen} folder={folder} />
      </div>
    </div>
  )
}
