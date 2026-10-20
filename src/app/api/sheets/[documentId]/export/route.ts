import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { exportFilename } from "@/app/api/documents/_export"
import { getAuthenticatedUser } from "@/lib/auth"
import { readTimeZone, TIME_ZONE_COOKIE } from "@/lib/date-format"
import { createCsvDownloadResponse, createCsvExportErrorResponse, escapeCsvField } from "@/lib/csv"
import { resolveDocumentOrganizationId } from "@/lib/document-organization"
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit"
import { createRateLimitResponse } from "@/lib/rate-limit-response"
import { parseCellRef } from "@/lib/sheet/a1"
import { cellAddress } from "@/lib/sheet/edit"
import { evaluateSheet } from "@/lib/sheet/evaluate"
import { DEFAULT_CURRENCY, formatCellValue } from "@/lib/sheet/format"
import { getSheet, SheetServiceError } from "@/services/sheet-service"
import type { SheetContent } from "@/types/sheet"

type SheetExportRouteContext = { params: Promise<{ documentId: string }> }

/**
 * Downloads one tab of a sheet as CSV, worked out on the server, for whoever
 * may open the sheet. Cells read as they show in the grid; text that a
 * spreadsheet would run as a formula is written with a leading apostrophe.
 *
 * @param request - GET with `format=csv` and, optionally, the `tab` id; the first tab otherwise.
 * @param context - The sheet's id.
 * @returns The CSV attachment, or a plain-text refusal.
 */
export async function GET(request: Request, context: SheetExportRouteContext): Promise<Response> {
  try {
    const { documentId } = await context.params
    const query = new URL(request.url).searchParams

    if (query.get("format") !== "csv") {
      return new NextResponse("A sheet downloads as CSV.", { status: 400 })
    }

    const user = await getAuthenticatedUser()
    const organizationId = await resolveDocumentOrganizationId(user.id, documentId)

    if (!organizationId) {
      throw new SheetServiceError("Sheet was not found.", 404)
    }

    // Each download works the whole sheet out again.
    await checkRateLimit("member_export", user.id)

    const sheet = await getSheet({ actorUserId: user.id, organizationId, documentId })
    const tab = sheet.content.tabs.find((candidate) => candidate.id === query.get("tab")) ?? sheet.content.tabs[0]!

    // Worked out in the viewer's time zone, as the grid is, so TODAY() and NOW() match it.
    const timeZone = readTimeZone((await cookies()).get(TIME_ZONE_COOKIE)?.value)

    return createCsvDownloadResponse(sheetCsv(sheet.content, tab.id, timeZone), exportFilename(sheet.title, "csv"))
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      return createRateLimitResponse(error, "sheet_export_rejected", "sheets_export")
    }

    return createCsvExportErrorResponse(
      error instanceof RangeError ? new SheetServiceError("This sheet is too heavy to work out. Simplify its formulas.", 422) : error,
      "Unable to download the sheet.",
      "sheets_export"
    )
  }
}

// The tab from A1 to its last filled row and column.
function sheetCsv(content: SheetContent, tabId: string, timeZone: string): string {
  const tab = content.tabs.find((candidate) => candidate.id === tabId)!
  const { values } = evaluateSheet(content, { now: new Date(), timeZone })
  let rows = 0
  let cols = 0

  for (const address of Object.keys(tab.cells)) {
    const ref = parseCellRef(address)!
    rows = Math.max(rows, ref.row + 1)
    cols = Math.max(cols, ref.col + 1)
  }

  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      const address = cellAddress(row, col)
      const value = values.get(`${tab.id}!${address}`) ?? null
      const text = formatCellValue(value, tab.cells[address]?.fmt, { currency: DEFAULT_CURRENCY, locale: "en-US" })

      return escapeCsvField(text, typeof value === "string")
    }).join(",")
  ).join("\n")
}
