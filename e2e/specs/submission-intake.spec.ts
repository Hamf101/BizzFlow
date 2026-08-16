import { expect, test, uniqueName } from "../support/fixtures"
import { seedTemplate } from "../support/seed"

/**
 * Journey 3 — publish a template, fill it in, attach a file, submit.
 *
 * The file round trip is the reason this spec is worth its runtime. Everything
 * else here touches Postgres only; the upload crosses a signed-URL mint, a
 * direct browser PUT to object storage, and a server-side completion call that
 * verifies size and type before the row is trusted. Three services have to agree
 * for it to pass, and none of the 1,059 unit tests exercises that seam.
 */
test.describe("submission intake", () => {
  test("publishes a template, then accepts a filled submission with a file", async ({
    admin,
    pageAs,
    tenant,
  }) => {
    const template = await seedTemplate(
      admin,
      tenant.organizationId,
      uniqueName("Intake")
    )

    const manager = await pageAs("manager")

    await manager.goto(`/templates/${template.id}/edit`)
    await manager.getByRole("button", { name: /save & publish/i }).click()

    // Only published templates are offered when starting a submission, so the
    // next step doubles as proof that publishing took effect.
    await expect(manager.getByText(/published/i).first()).toBeVisible()

    const staff = await pageAs("staff")
    const submissionTitle = uniqueName("Intake run")

    await staff.goto("/submissions/new")
    await staff.getByLabel("Title").fill(submissionTitle)
    await staff.getByLabel("Template").selectOption({ label: template.title })
    await staff.getByRole("button", { name: "Create draft" }).click()

    await staff.waitForURL(/\/submissions\/[0-9a-f-]+$/i)

    await staff.getByLabel("Client reference").fill("REF-4417")

    // setInputFiles drives the real <input type="file">, so the bytes travel
    // the same path a person's would.
    await staff.getByLabel("Choose file").setInputFiles({
      buffer: Buffer.from("supporting evidence"),
      mimeType: "text/csv",
      name: "evidence.csv",
    })
    await staff.getByRole("button", { name: "Upload file" }).click()

    await expect(staff.getByText("evidence.csv")).toBeVisible({
      timeout: 30_000,
    })

    await staff.getByRole("button", { name: "Submit", exact: true }).click()

    await expect(staff.getByText(/submitted/i).first()).toBeVisible()

    // The row, not just the banner: a green screen with no persisted status is
    // the exact failure this spec exists to catch.
    const { data } = await admin
      .from("submissions")
      .select("status")
      .eq("title", submissionTitle)
      .single()

    expect(data?.status).toBe("submitted")
  })

  test("keeps an unpublished template out of the submission picker", async ({
    admin,
    pageAs,
    tenant,
  }) => {
    const draft = await seedTemplate(
      admin,
      tenant.organizationId,
      uniqueName("Unpublished")
    )

    const staff = await pageAs("staff")

    await staff.goto("/submissions/new")

    await expect(
      staff.getByRole("option", { name: draft.title })
    ).toHaveCount(0)
  })
})
