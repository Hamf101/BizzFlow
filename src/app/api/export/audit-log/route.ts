import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { buildCsvExportFilename, createCsvDownloadResponse } from "@/lib/csv"
import { formatAuditLogsAsCsv } from "@/services/audit-export-service"
import { AuditServiceError, listAuditLogs } from "@/services/audit-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      return new NextResponse("Unauthorized to export audit logs.", {
        status: 403,
      })
    }

    // listAuditLogs enforces audit_logs:view and reads the real columns; the
    // route only renders what it returns.
    const logs = await listAuditLogs({
      actorUserId: user.id,
      organizationId: context.organization.id,
      limit: 500,
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
