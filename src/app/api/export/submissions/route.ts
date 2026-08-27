import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { buildCsvExportFilename, createCsvDownloadResponse } from "@/lib/csv"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  exportInternalSubmissionsCsv,
  SubmissionServiceError,
} from "@/services/submission-service"

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      return new NextResponse("Unauthorized to export submissions.", {
        status: 403,
      })
    }

    const csvContent = await exportInternalSubmissionsCsv({
      actorUserId: user.id,
      organizationId: context.organization.id,
    })

    return createCsvDownloadResponse(
      csvContent,
      buildCsvExportFilename("submissions", context.organization.id)
    )
  } catch (error: unknown) {
    if (error instanceof SubmissionServiceError) {
      return new NextResponse(error.message, { status: error.statusCode })
    }

    return new NextResponse("Unable to export submissions CSV.", { status: 500 })
  }
}
