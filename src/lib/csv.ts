import { NextResponse } from "next/server"

/**
 * Leading characters a spreadsheet treats as the start of a formula.
 *
 * Tab and carriage return are included because Excel strips them before
 * deciding, so `\t=cmd` is still parsed as a formula.
 */
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"]

/**
 * Escapes one CSV field so commas, quotes, and newlines survive a round trip.
 *
 * @param field - Arbitrary value to render; objects are JSON-encoded.
 * @param neutralizeFormulas - Prefix a leading `=`, `+`, `-` or `@` with an
 *   apostrophe so Excel and Sheets treat the value as text. Off by default,
 *   because it alters the exported bytes and some exports are evidentiary.
 * @returns The value wrapped in double quotes with inner quotes doubled.
 */
export function escapeCsvField(
  field: unknown,
  neutralizeFormulas = false
): string {
  if (field === null || field === undefined) {
    return '""'
  }

  const raw = typeof field === "object" ? JSON.stringify(field) : String(field)
  const value =
    neutralizeFormulas && FORMULA_TRIGGERS.some((trigger: string): boolean =>
      raw.startsWith(trigger)
    )
      ? `'${raw}`
      : raw

  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Renders a header row and body rows as an RFC-4180 CSV document.
 *
 * @param headers - Column headings in output order.
 * @param rows - Row values, each ordered to match `headers`.
 * @param neutralizeFormulas - Apply spreadsheet formula neutralization to the
 *   body. Headers are ours and never need it.
 * @returns CSV text with every field escaped.
 */
export function formatCsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
  neutralizeFormulas = false
): string {
  const headerLine = headers.map((header: string): string =>
    escapeCsvField(header)
  ).join(",")
  const bodyLines = rows.map((row: readonly unknown[]): string =>
    row
      .map((cell: unknown): string => escapeCsvField(cell, neutralizeFormulas))
      .join(",")
  )

  return [headerLine, ...bodyLines].join("\n")
}

/**
 * Builds the download filename shared by every organization CSV export.
 *
 * @param resource - Export subject, used as the filename's middle segment.
 * @param organizationId - Tenant identifier; only its prefix is exposed.
 * @param now - Clock, injectable so tests can pin the date segment.
 * @returns A dated, tenant-prefixed `.csv` filename.
 */
export function buildCsvExportFilename(
  resource: string,
  organizationId: string,
  now: Date = new Date()
): string {
  const date = now.toISOString().split("T")[0]

  return `bizflow-${resource}-${organizationId.slice(0, 8)}-${date}.csv`
}

/**
 * Wraps CSV text in an attachment response that is never cached.
 *
 * @param csvContent - Rendered CSV document.
 * @param filename - Download filename presented to the browser.
 * @returns A `text/csv` attachment response.
 */
export function createCsvDownloadResponse(
  csvContent: string,
  filename: string
): NextResponse {
  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
