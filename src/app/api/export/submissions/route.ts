import { NextResponse, type NextRequest } from "next/server"

import {
  getSubmissionViewAssignee,
  getSubmissionViewStatuses,
  submissionListState,
} from "@/components/submissions/submission-list-view"
import { getAuthenticatedUser } from "@/lib/auth"
import { buildCsvExportFilename, createCsvDownloadResponse } from "@/lib/csv"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  exportInternalSubmissionsCsv,
  SubmissionServiceError,
} from "@/services/submission-service"

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      return new NextResponse("Unauthorized to export submissions.", {
        status: 403,
      })
    }

    // The export follows the Submissions view it was opened from.
    // exportInternalSubmissionsCsv enforces submissions:view and the role's
    // visibility, and refuses an export that is too large instead of
    // truncating it.
    const view = submissionListState.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    )
    const csvContent = await exportInternalSubmissionsCsv({
      actorUserId: user.id,
      assignedTo: getSubmissionViewAssignee(view),
      organizationId: context.organization.id,
      query: view.query || undefined,
      sort: view.sort,
      statuses: getSubmissionViewStatuses(view),
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
