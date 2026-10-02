import type { Page } from "@playwright/test"

import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedSubmission, seedTemplate } from "../support/seed"

/**
 * Journey 4 — the full review state machine.
 *
 * draft → submitted → in_review → needs_changes → submitted → in_review →
 * approved → completed, with rejection covered separately.
 *
 * The transitions are guarded in the service layer and already unit-tested. What
 * is not covered anywhere else is that the *right actor* sees the *right
 * control* at each state: the machine can be perfectly correct and still be
 * unusable if the Approve button renders for someone who cannot approve, or
 * fails to render for someone who can.
 */
test.describe("submission review", () => {
  test("walks a submission from submitted through to completed", async ({
    admin,
    pageAs,
    tenant,
  }) => {
    const template = await seedTemplate(
      admin,
      tenant.organizationId,
      uniqueName("Review"),
      "published"
    )
    const title = uniqueName("Review run")
    const submissionId = await seedSubmission(
      admin,
      tenant.organizationId,
      template,
      title,
      tenant.users.staff.id
    )

    const manager = await pageAs("manager")
    const staff = await pageAs("staff")

    await manager.goto(`/submissions/${submissionId}`)

    // Assigning a submitted item is what starts its review — there is no
    // separate "begin" control.
    await manager.getByRole("checkbox", { name: /^E2E manager/ }).check()
    await manager.getByRole("button", { name: /start review/i }).click()

    await expectStatus(admin, submissionId, "in_review")

    await manager.getByLabel("Review note").fill("Please attach the signed copy.")
    await manager.getByRole("button", { name: "Request changes" }).click()

    await expectStatus(admin, submissionId, "needs_changes")

    // Back to the author, who resubmits.
    await staff.goto(`/submissions/${submissionId}`)
    await staff.getByRole("button", { name: "Resubmit" }).click()

    await expectStatus(admin, submissionId, "submitted")

    await manager.goto(`/submissions/${submissionId}`)
    await manager.getByRole("checkbox", { name: /^E2E manager/ }).check()
    await manager.getByRole("button", { name: /start review/i }).click()
    await manager.getByRole("button", { name: "Approve" }).click()

    await expectStatus(admin, submissionId, "approved")

    await manager.goto(`/submissions/${submissionId}`)
    await manager.getByRole("button", { name: "Mark complete" }).click()

    await expectStatus(admin, submissionId, "completed")
  })

  test("waits for every reviewer, and a change request holds it until the person who assigned them sets it aside, which settles it", async ({
    admin,
    pageAs,
    tenant,
  }) => {
    const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Several"), "published")
    const title = uniqueName("Several run")
    const submissionId = await seedSubmission(admin, tenant.organizationId, template, title, tenant.users.staff.id)
    const manager = await pageAs("manager")
    const owner = await pageAs("owner_admin")

    // The owner is somewhere else in the app when they are named.
    await owner.goto("/submissions")
    await waitForHydration(owner.getByRole("heading", { level: 1 }).first())

    await manager.goto(`/submissions/${submissionId}`)
    await manager.getByRole("checkbox", { name: /^E2E manager/ }).check()
    await manager.getByRole("checkbox", { name: /^E2E owner_admin/ }).check()
    await manager.getByRole("button", { name: /start review/i }).click()
    await expectStatus(admin, submissionId, "in_review")

    // They are told without reloading.
    await expect(owner.getByText(`asked you to review “${title}”`)).toBeVisible({ timeout: 15_000 })

    // One of two approving is not enough.
    await manager.getByRole("button", { name: "Approve" }).click()
    await expectStatus(admin, submissionId, "in_review")
    await expect(manager.getByText("1 of 2 approvals")).toBeVisible()

    // The other reviewer asks for changes, which holds it up.
    await owner.goto(`/submissions/${submissionId}`)
    await expect(owner.getByRole("region", { name: "Reviewers" })).toContainText("E2E manager")
    await owner.getByLabel("Review note").fill("The total does not add up.")
    await owner.getByRole("button", { name: "Request changes" }).click()
    await expectStatus(admin, submissionId, "needs_changes")

    // Only the person who assigned the reviewers can set it aside.
    await owner.goto(`/submissions/${submissionId}`)
    await expect(owner.getByLabel(/Set aside .*change request/)).toHaveCount(0)
    await manager.goto(`/submissions/${submissionId}`)
    await manager.getByLabel(/Set aside E2E owner_admin/).fill("I checked the total, it is right.")
    await manager.getByRole("button", { name: "Set aside", exact: true }).click()

    // The manager had already approved and the owner's request no longer counts,
    // so nothing is left to wait for.
    await expectStatus(admin, submissionId, "approved")
    await expectAuditLogOpens(owner)
  })

  test("refuses to record changes or rejection without a note", async ({
    admin,
    pageAs,
    tenant,
  }) => {
    const template = await seedTemplate(
      admin,
      tenant.organizationId,
      uniqueName("Note"),
      "published"
    )
    const submissionId = await seedSubmission(
      admin,
      tenant.organizationId,
      template,
      uniqueName("Note run"),
      tenant.users.staff.id
    )

    const manager = await pageAs("manager")

    await manager.goto(`/submissions/${submissionId}`)
    await manager.getByRole("checkbox", { name: /^E2E manager/ }).check()
    await manager.getByRole("button", { name: /start review/i }).click()

    // Note deliberately left blank.
    await manager.getByRole("button", { name: "Reject" }).click()

    await expectStatus(admin, submissionId, "in_review")
    await expect(manager.getByText(/note is required/i).first()).toBeVisible()
  })

  test("lets an outside reviewer approve and comment as a reviewer, but not reject, and keeps staff from deciding", async ({
    admin,
    pageAs,
    tenant,
  }) => {
    const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Guard"), "published")
    const title = uniqueName("Guard run")
    const submissionId = await seedSubmission(admin, tenant.organizationId, template, title, tenant.users.staff.id)
    const manager = await pageAs("manager")
    const staff = await pageAs("staff")
    const outside = await pageAs("external_reviewer")

    // The manager names the outside reviewer beside themselves.
    await manager.goto(`/submissions/${submissionId}`)
    await manager.getByRole("checkbox", { name: /^E2E manager/ }).check()
    await manager.getByRole("checkbox", { name: /^E2E external_reviewer/ }).check()
    await manager.getByRole("button", { name: /start review/i }).click()
    await expectStatus(admin, submissionId, "in_review")

    // Staff can read it and cannot decide.
    await staff.goto(`/submissions/${submissionId}`)
    await expect(staff.getByRole("heading", { exact: true, level: 1, name: title })).toBeVisible()
    await expect(staff.getByRole("button", { name: "Approve" })).toBeHidden()

    // The outside reviewer sees it, comments as a reviewer, approves, and has no Reject.
    await outside.goto(`/submissions/${submissionId}`)
    await expect(outside.getByRole("heading", { exact: true, level: 1, name: title })).toBeVisible()
    await expect(outside.getByRole("button", { name: "Reject" })).toBeHidden()
    await outside.getByLabel("Review note").fill("Looks fine from outside.")
    await outside.getByRole("button", { exact: true, name: "Comment" }).click()
    await expect(outside.getByRole("region", { name: "Reviewers" })).toContainText("Looks fine from outside.")
    await outside.getByRole("button", { name: "Approve" }).click()
    await expectStatus(admin, submissionId, "in_review")
    await expect(outside.getByText("1 of 2 approvals")).toBeVisible()

    // Their decision counts: the manager's approval completes it.
    await manager.goto(`/submissions/${submissionId}`)
    await manager.getByRole("button", { name: "Approve" }).click()
    await expectStatus(admin, submissionId, "approved")
  })

  test("lets the person who submitted it share it with someone who can comment and hold it up, but not approve", async ({
    admin,
    pageAs,
    tenant,
  }) => {
    const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Shared"), "published")
    const title = uniqueName("Shared run")
    const submissionId = await seedSubmission(admin, tenant.organizationId, template, title, tenant.users.staff.id)
    const manager = await pageAs("manager")
    const staff = await pageAs("staff")
    const outside = await pageAs("external_reviewer")

    await manager.goto(`/submissions/${submissionId}`)
    await manager.getByRole("checkbox", { name: /^E2E manager/ }).check()
    await manager.getByRole("button", { name: /start review/i }).click()
    await expectStatus(admin, submissionId, "in_review")

    // Before it is shared, the outside reviewer cannot open it.
    await outside.goto(`/submissions/${submissionId}`)
    await expect(outside.getByText("Submission unavailable")).toBeVisible()

    await staff.goto(`/submissions/${submissionId}`)
    await staff.getByRole("checkbox", { name: /^E2E external_reviewer/ }).check()
    await staff.getByRole("button", { name: "Save sharing" }).click()
    await expect(staff.getByRole("region", { name: "Shared with" })).toContainText("E2E external_reviewer")

    await outside.goto(`/submissions/${submissionId}`)
    await expect(outside.getByRole("heading", { exact: true, level: 1, name: title })).toBeVisible()
    await expect(outside.getByRole("button", { name: "Approve" })).toBeHidden()
    await outside.getByLabel("Review note").fill("The dates overlap last month.")
    await outside.getByRole("button", { name: "Request changes" }).click()
    await expectStatus(admin, submissionId, "needs_changes")

    // Their change request is the manager's to set aside, like any reviewer's.
    await manager.goto(`/submissions/${submissionId}`)
    await expect(manager.getByRole("region", { name: "Shared with" })).toContainText("The dates overlap last month.")
    await manager.getByLabel(/Set aside E2E external_reviewer/).fill("Checked, they do not overlap.")
    await manager.getByRole("button", { name: "Set aside and approve" }).click()
    await expectStatus(admin, submissionId, "approved")
    await expectAuditLogOpens(await pageAs("owner_admin"))
  })

  test("keeps a reviewer's suggested answer apart until the person who submitted it accepts it", async ({
    admin,
    pageAs,
    tenant,
  }) => {
    const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Suggest"), "published")
    const submissionId = await seedSubmission(admin, tenant.organizationId, template, uniqueName("Suggest run"), tenant.users.staff.id)
    const manager = await pageAs("manager")
    const staff = await pageAs("staff")

    await manager.goto(`/submissions/${submissionId}`)
    await manager.getByRole("checkbox", { name: /^E2E manager/ }).check()
    await manager.getByRole("button", { name: /start review/i }).click()
    await expectStatus(admin, submissionId, "in_review")

    await manager.getByRole("link", { name: "Suggest changes" }).click()
    await manager.getByLabel("Client reference").fill("REF-9000")
    await manager.getByRole("button", { name: "Send suggestions" }).click()
    await expect(manager.getByText("Suggested changes", { exact: true })).toBeVisible()
    await expect.poll(() => readAnswer(admin, submissionId, template.textFieldKey)).toBe("REF-4417")

    await staff.goto(`/submissions/${submissionId}`)
    await expect(staff.getByRole("listitem").filter({ hasText: "REF-9000" })).toContainText("REF-4417")
    await staff.getByRole("button", { exact: true, name: "Accept" }).click()
    await expect.poll(() => readAnswer(admin, submissionId, template.textFieldKey)).toBe("REF-9000")
    await expect(staff.getByText("Accepted", { exact: true })).toBeVisible()
    await expectStatus(admin, submissionId, "in_review")
    await expectAuditLogOpens(await pageAs("owner_admin"))
  })
})

/**
 * The audit log reads every event in the workspace, so one event it cannot
 * name would blank the whole page. Each journey checks it after its own.
 *
 * @param owner - A page signed in as an owner.
 * @returns Resolves once the log shows its count.
 */
async function expectAuditLogOpens(owner: Page): Promise<void> {
  await owner.goto("/audit-log")
  await expect(owner.getByRole("heading", { level: 1 })).toHaveAccessibleName(/^Audit log \d+ events?$/)
}

async function readAnswer(admin: Parameters<typeof seedSubmission>[0], submissionId: string, fieldKey: string): Promise<unknown> {
  const { data } = await admin.from("submissions").select("values").eq("id", submissionId).single()

  return (data?.values as Record<string, unknown> | undefined)?.[fieldKey]
}

/**
 * Asserts the persisted status, retrying while the action settles.
 *
 * Server actions redirect and revalidate, so the row can lag the click by a
 * moment. Polling the database rather than the page keeps the assertion about
 * the state machine instead of about render timing.
 *
 * @param admin - Service-role client.
 * @param submissionId - Submission to read.
 * @param expected - Status the transition should have produced.
 * @returns Resolves once the status matches.
 */
async function expectStatus(
  admin: Parameters<typeof seedSubmission>[0],
  submissionId: string,
  expected: string
): Promise<void> {
  await expect
    .poll(
      async (): Promise<string | undefined> => {
        const { data } = await admin
          .from("submissions")
          .select("status")
          .eq("id", submissionId)
          .single()

        return data?.status as string | undefined
      },
      { message: `submission ${submissionId} should reach ${expected}` }
    )
    .toBe(expected)
}
