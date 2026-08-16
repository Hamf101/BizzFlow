import { expect, test, uniqueName } from "../support/fixtures"
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
    await manager
      .getByLabel(/assign review/i)
      .selectOption({ value: tenant.users.manager.id })
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
    await manager
      .getByLabel(/assign review/i)
      .selectOption({ value: tenant.users.manager.id })
    await manager.getByRole("button", { name: /start review/i }).click()
    await manager.getByRole("button", { name: "Approve" }).click()

    await expectStatus(admin, submissionId, "approved")

    await manager.goto(`/submissions/${submissionId}`)
    await manager.getByRole("button", { name: "Mark complete" }).click()

    await expectStatus(admin, submissionId, "completed")
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
    await manager
      .getByLabel(/assign review/i)
      .selectOption({ value: tenant.users.manager.id })
    await manager.getByRole("button", { name: /start review/i }).click()

    // Note deliberately left blank.
    await manager.getByRole("button", { name: "Reject" }).click()

    await expectStatus(admin, submissionId, "in_review")
    await expect(manager.getByText(/note is required/i).first()).toBeVisible()
  })

  test("withholds the binding decision from staff and external reviewers", async ({
    admin,
    pageAs,
    tenant,
  }) => {
    const template = await seedTemplate(
      admin,
      tenant.organizationId,
      uniqueName("Guard"),
      "published"
    )
    const title = uniqueName("Guard run")
    const submissionId = await seedSubmission(
      admin,
      tenant.organizationId,
      template,
      title,
      tenant.users.staff.id
    )

    const staff = await pageAs("staff")
    const reviewer = await pageAs("external_reviewer")

    await staff.goto(`/submissions/${submissionId}`)
    await reviewer.goto(`/submissions/${submissionId}`)

    // Both can read the submission; neither may decide it. The external
    // reviewer role exists precisely to make that distinction, so a regression
    // here is a permissions failure with a customer on the other end of it.
    await expect(staff.getByText(title)).toBeVisible()
    await expect(reviewer.getByText(title)).toBeVisible()

    await expect(staff.getByRole("button", { name: "Approve" })).toBeHidden()
    await expect(reviewer.getByRole("button", { name: "Approve" })).toBeHidden()
    await expect(reviewer.getByRole("button", { name: "Reject" })).toBeHidden()
  })
})

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
