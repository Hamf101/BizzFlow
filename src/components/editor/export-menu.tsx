"use client"

import { ChevronDown, Download, FilePen, FileSpreadsheet, FileText, FileType, type LucideIcon } from "lucide-react"
import type { ReactElement } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/** What something can be saved as, in menu order, and the upload it began as. */
type ExportLinks = Readonly<{
  formats: ReadonlyArray<Readonly<{ href: string; icon: LucideIcon; label: string }>>
  original?: string
}>

/**
 * What a document or template at `base` can be exported as.
 *
 * @param base - Its API address, such as `/api/documents/<id>`.
 * @param options - Whether a PDF (default) and a fillable PDF are offered, and the original upload's address;
 *   for a sheet, CSV, with Excel only when `xlsx` is set, of the `tab` given.
 * @returns The links, in menu order.
 */
export function exportLinks(
  base: string,
  {
    fillable = false,
    original,
    pdf = true,
    sheet = false,
    tab,
    xlsx = false,
  }: { fillable?: boolean; original?: string; pdf?: boolean; sheet?: boolean; tab?: string; xlsx?: boolean } = {}
): ExportLinks {
  // A sheet saves as a spreadsheet: CSV, and Excel once `xlsx` is passed.
  if (sheet) {
    const which = tab ? `&tab=${encodeURIComponent(tab)}` : ""
    return {
      formats: [
        ...(xlsx ? [{ href: `${base}/export?format=xlsx${which}`, icon: FileSpreadsheet, label: "Excel (.xlsx)" }] : []),
        { href: `${base}/export?format=csv${which}`, icon: FileText, label: "CSV" },
      ],
    }
  }

  return {
    formats: [
      ...(pdf ? [{ href: `${base}/pdf`, icon: FileText, label: "PDF" }] : []),
      { href: `${base}/docx`, icon: FileType, label: "Word (.docx)" },
      ...(pdf && fillable ? [{ href: `${base}/pdf?fillable=1`, icon: FilePen, label: "Fillable PDF" }] : []),
    ],
    original,
  }
}

/**
 * The export items, for the Export menu or, on a phone, the More menu.
 *
 * @param props - The links, and whether to set them apart under "Export" among other items.
 * @returns The items.
 */
export function ExportMenuItems({ heading = false, links }: { heading?: boolean; links: ExportLinks }): ReactElement {
  return (
    <DropdownMenuGroup>
      {heading ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Export</DropdownMenuLabel>
        </>
      ) : null}
      {links.formats.map(({ href, icon: Icon, label }) => (
        <DropdownMenuItem key={label} render={<a href={href} rel="noreferrer" target="_blank" />}>
          <Icon />
          {label}
        </DropdownMenuItem>
      ))}
      {links.original ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<a href={links.original} rel="noreferrer" target="_blank" />}>
            <Download />
            Download original
          </DropdownMenuItem>
        </>
      ) : null}
    </DropdownMenuGroup>
  )
}

/**
 * Export ▾: one menu of every way to save it. On a phone the word folds away
 * and the icon stays.
 *
 * @param props - The links, and whether this is the screen's main action.
 * @returns The menu, or nothing when there is nothing to export.
 */
export function ExportMenu({ links, primary = false }: { links: ExportLinks; primary?: boolean }): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button className="h-10 px-3 max-md:px-2.5" type="button" variant={primary ? "default" : "outline"}>
            <Download />
            <span className="max-md:sr-only">Export</span>
            <ChevronDown />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <ExportMenuItems links={links} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
