import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentOrganizationContext } from "@/services/organization-service"

function escapeCsvField(field: unknown): string {
  if (field === null || field === undefined) return '""'
  const str = typeof field === "object" ? JSON.stringify(field) : String(field)
  return `"${str.replace(/"/g, '""')}"`
}

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (
      !context ||
      !canPerformOrganizationAction(
        context.membership.role,
        "submissions:view"
      )
    ) {
      return new NextResponse("Unauthorized to export submissions.", {
        status: 403,
      })
    }

    const client = createAdminClient()
    const { data: submissions, error } = await client
      .from("submissions")
      .select("id, title, status, template_id, created_at, submitted_at, updated_at")
      .eq("org_id", context.organization.id)
      .order("created_at", { ascending: false })
      .limit(1000)

    if (error || !submissions) {
      return new NextResponse("Unable to fetch submissions.", { status: 500 })
    }

    const headers = [
      "Submission ID",
      "Title",
      "Status",
      "Template ID",
      "Created At",
      "Submitted At",
      "Updated At",
    ]

    const rows = submissions.map((sub) => [
      escapeCsvField(sub.id),
      escapeCsvField(sub.title),
      escapeCsvField(sub.status),
      escapeCsvField(sub.template_id),
      escapeCsvField(sub.created_at),
      escapeCsvField(sub.submitted_at),
      escapeCsvField(sub.updated_at),
    ])

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
    const dateStr = new Date().toISOString().split("T")[0]
    const filename = `bizflow-submissions-${context.organization.id.slice(0, 8)}-${dateStr}.csv`

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch {
    return new NextResponse("Unable to export submissions CSV.", { status: 500 })
  }
}
