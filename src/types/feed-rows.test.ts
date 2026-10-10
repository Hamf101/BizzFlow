import { describe, expect, it } from "vitest"

import { parseNotificationDeliveryRows } from "./notification"
import { parseSubmissionActivityEventRows } from "./submission-review"

const ORG = "10000000-0000-4000-8000-000000000001"
const USER = "20000000-0000-4000-8000-000000000001"
const AT = "2026-10-01T12:00:00.000Z"

describe("feeds read rows newer than this build", () => {
  it("leaves out a submission activity event this build does not know, and still refuses a broken row", () => {
    const event = (id: string, eventType: string) => ({
      id, org_id: ORG, submission_id: "30000000-0000-4000-8000-000000000001", actor_user_id: USER,
      event_type: eventType, from_status: "submitted", to_status: "in_review",
      assignee_user_id: null, comment_id: null, submission_revision: 1, created_at: AT,
    })

    const events = parseSubmissionActivityEventRows([
      event("40000000-0000-4000-8000-000000000001", "assigned"),
      event("40000000-0000-4000-8000-000000000002", "escalated"),
    ])

    expect(events.map((row) => row.eventType)).toEqual(["assigned"])
    expect(() => parseSubmissionActivityEventRows([{ ...event("x", "assigned") }])).toThrow()
  })

  it("leaves out a delivery whose channel, purpose or status this build does not know", () => {
    const delivery = (id: string, overrides: Record<string, unknown> = {}) => ({
      id, org_id: ORG, recipient_user_id: USER, channel: "email", purpose: "task_reminder",
      reference: "ref", status: "sent", attempt_count: 1, last_error: null, created_at: AT, updated_at: AT,
      ...overrides,
    })

    const deliveries = parseNotificationDeliveryRows([
      delivery("50000000-0000-4000-8000-000000000001"),
      delivery("50000000-0000-4000-8000-000000000002", { channel: "whatsapp" }),
      delivery("50000000-0000-4000-8000-000000000003", { purpose: "guest_invite" }),
      delivery("50000000-0000-4000-8000-000000000004", { status: "bounced" }),
    ])

    expect(deliveries.map((row) => row.id)).toEqual(["50000000-0000-4000-8000-000000000001"])
  })
})
