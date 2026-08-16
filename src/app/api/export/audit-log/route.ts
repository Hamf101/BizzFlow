import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { canPerformOrganizationAction } from "@/lib/permissions"
import {
  formatAuditLogsAsCsv,
  getOrganizationAuditLogs,
} from "@/services/audit-export-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (
      !context ||
      !canPerformOrganizationAction(
        context.membership.role,
        "audit_logs:view"
      )
    ) {
      return new NextResponse("Unauthorized to export audit logs.", {
        status: 403,
      })
    }

    const logs = await getOrganizationAuditLogs(context.organization.id, 500)
    const csvContent = formatAuditLogsAsCsv(logs)

    const dateStr = new Date().toISOString().split("T")[0]
    const filename = `bizflow-audit-log-${context.organization.id.slice(0, 8)}-${dateStr}.csv`

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch {
    return new NextResponse("Unable to export audit log.", { status: 500 })
  }
}
