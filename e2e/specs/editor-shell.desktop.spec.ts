import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { seedTemplate } from "../support/seed"

test("the mode switch moves with the arrow keys and keeps one tab stop", async ({ admin, pageAs, tenant }) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Modes"))
  const page = await pageAs("owner_admin")

  await page.goto(`/templates/${template.id}/edit`)
  const edit = page.getByRole("radio", { name: "Edit" })
  await waitForHydration(edit)
  await edit.focus()
  await page.keyboard.press("ArrowRight")

  const preview = page.getByRole("radio", { name: "Preview" })
  await expect(preview).toBeChecked()
  await expect(preview).toBeFocused()
  // Roving focus: only the chosen mode takes a Tab stop.
  await expect(page.locator('[role="radiogroup"] [tabindex="0"]')).toHaveCount(1)
  await page.keyboard.press("ArrowLeft")
  await expect(edit).toBeChecked()
})

test("the dock stays where it was dragged and laid flat, on the next visit too", async ({
  admin,
  pageAs,
  tenant,
}) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Dock"))
  // Not the owner, whom other editor specs share: a moved dock is theirs to keep.
  const page = await pageAs("manager")

  await page.goto(`/templates/${template.id}/edit`)
  const dock = page.getByRole("navigation", { name: "Editor tools" })
  await waitForHydration(dock)
  const home = await dock.boundingBox()
  if (!home) throw new Error("Expected the dock on screen.")

  // The whole dock drags; there is no handle to find.
  await page.mouse.move(home.x + home.width / 2, home.y + 3)
  await page.mouse.down()
  await page.mouse.move(home.x + home.width / 2 + 300, home.y + 3, { steps: 10 })
  await page.mouse.up()
  await dock.click({ button: "right", position: { x: 3, y: 3 } })
  await page.getByRole("menuitem", { name: "Lay flat" }).click()

  await expect.poll(async () => {
    const { data, error } = await admin.from("profiles").select("editor_layout").eq("id", tenant.users.manager.id).single()
    if (error) throw error
    return data.editor_layout.dock?.orientation
  }, { timeout: 15_000 }).toBe("flat")

  await page.reload()
  await waitForHydration(dock)
  const kept = await dock.boundingBox()
  expect(kept && kept.width > kept.height).toBe(true)
  expect(kept && kept.x > home.x + 150).toBe(true)

  await dock.click({ button: "right", position: { x: 3, y: 3 } })
  await page.getByRole("menuitem", { name: "Put back" }).click()
  await expect.poll(async () => {
    const { data } = await admin.from("profiles").select("editor_layout").eq("id", tenant.users.manager.id).single()
    return data?.editor_layout
  }, { timeout: 15_000 }).toEqual({})
})
