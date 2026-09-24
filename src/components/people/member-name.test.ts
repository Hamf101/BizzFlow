import { describe, expect, it } from "vitest"

import { formatMemberName } from "@/components/people/member-name"
import type { OrganizationMember } from "@/types/organization"

const VIEWER_ID = "20000000-0000-4000-8000-000000000001"
const MARA_ID = "20000000-0000-4000-8000-000000000002"
const JO_ID = "20000000-0000-4000-8000-000000000003"
const FORMER_ID = "20000000-0000-4000-8000-000000000009"

function createMember(
  userId: string,
  fullName: string | null,
  email: string
): OrganizationMember {
  return {
    createdAt: "2026-07-01T12:00:00.000Z",
    email,
    fullName,
    id: `membership-${userId}`,
    role: "staff",
    status: "active",
    userId,
  }
}

const members = [
  createMember(VIEWER_ID, "Sam Reyes", "sam@example.test"),
  createMember(MARA_ID, "  Mara Bell  ", "mara@example.test"),
  createMember(JO_ID, "   ", "jo@example.test"),
]

describe("formatMemberName", () => {
  it("names nobody, the viewer, a member, and someone who has left", () => {
    expect(formatMemberName(null, members, VIEWER_ID)).toBe("Unassigned")
    expect(formatMemberName(VIEWER_ID, members, VIEWER_ID)).toBe("You")
    expect(formatMemberName(MARA_ID, members, VIEWER_ID)).toBe("Mara Bell")
    expect(formatMemberName(FORMER_ID, members, VIEWER_ID)).toBe("a former member")
  })

  it("falls back to the email when a member has no name", () => {
    expect(formatMemberName(JO_ID, members)).toBe("jo@example.test")
  })

  it("names the viewer like anyone else when no viewer is given", () => {
    expect(formatMemberName(VIEWER_ID, members)).toBe("Sam Reyes")
  })
})
