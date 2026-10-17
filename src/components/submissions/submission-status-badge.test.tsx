import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { SUBMISSION_STATUSES } from "@/types/submission"

import { SubmissionStatusBadge } from "./submission-status-badge"

describe("SubmissionStatusBadge", () => {
  it("gives every status a look of its own", () => {
    const looks = SUBMISSION_STATUSES.map((status) => /class="([^"]+)"/.exec(renderToStaticMarkup(<SubmissionStatusBadge status={status} />))?.[1])

    expect(new Set(looks).size).toBe(SUBMISSION_STATUSES.length)
  })
})
