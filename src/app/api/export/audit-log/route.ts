import { NextResponse, type NextRequest } from "next/server"

import {
  auditLogListState,
  getAuditTargetTypes,
} from "@/components/audit/audit-log-view"
import { getAuthenticatedUser } from "@/lib/auth"
import { buildCsvExportFilename, createCsvDownloadResponse } from "@/lib/csv"
import { formatAuditLogsAsCsv } from "@/services/audit-export-service"
import { AuditServiceError, exportAuditLogs } from "@/services/audit-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      return new NextResponse("Unauthorized to export audit logs.", {
        status: 403,
      })
    }

    // The export follows the audit view it was opened from. exportAuditLogs
    // enforces audit_logs:view and returns every matching event, or refuses
    // an export that is too large instead of truncating it.
    const view = auditLogListState.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    )
    const logs = await exportAuditLogs({
      actorUserId: user.id,
      organizationId: context.organization.id,
      sort: view.sort,
      targetTypes: getAuditTargetTypes(view),
    })

    return createCsvDownloadResponse(
      formatAuditLogsAsCsv(logs),
      buildCsvExportFilename("audit-log", context.organization.id)
    )
  } catch (error: unknown) {
    if (error instanceof AuditServiceError) {
      return new NextResponse(error.message, { status: error.statusCode })
    }

    return new NextResponse("Unable to export audit log.", { status: 500 })
  }
}
