import { expect, test, uniqueName } from "../support/fixtures"
import { waitForHydration } from "../support/hydration"
import { retryConcurrentChange } from "../support/retry"
import { seedPublicFormLink, seedSigningDocument, seedTemplate } from "../support/seed"

const TITLES: ReadonlyArray<readonly [string, string]> = [
  ["/dashboard", "Dashboard"],
  ["/documents", "Files"],
  ["/templates", "Templates"],
  ["/submissions", "Submissions"],
  ["/tasks", "Tasks"],
  ["/people", "People"],
  ["/settings", "Settings"],
  ["/audit-log", "Audit log"],
]

test("every workspace page has a title of its own", async ({ pageAs }) => {
  const page = await pageAs("owner_admin")

  for (const [path, title] of TITLES) {
    await page.goto(path)
    await expect(page).toHaveTitle(`${title} · BizFlow`)
  }
})

test("the first Tab stop skips the sidebar and lands on the page's content", async ({ pageAs }) => {
  const page = await pageAs("owner_admin")

  await page.goto("/templates")
  await waitForHydration(page.locator("main"))
  await page.keyboard.press("Tab")

  const skip = page.getByRole("link", { name: "Skip to content" })
  await expect(skip).toBeFocused()
  await expect(skip).toBeVisible()

  await page.keyboard.press("Enter")
  await expect(page.locator("#main-content")).toBeFocused()
})

test("forced colours keep a visible mark on every focused control", async ({ pageAs }) => {
  const page = await pageAs("owner_admin")

  await page.emulateMedia({ forcedColors: "active" })
  await page.goto("/dashboard")
  await waitForHydration(page.locator("main"))

  for (let stop = 0; stop < 8; stop += 1) {
    await page.keyboard.press("Tab")

    const outline = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement as Element)
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) }
    })

    expect(outline.style, `tab stop ${stop + 1}`).not.toBe("none")
    expect(outline.width, `tab stop ${stop + 1}`).toBeGreaterThan(0)
  }
})

test("reduced motion removes the transitions", async ({ pageAs }) => {
  const page = await pageAs("owner_admin")

  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/templates")
  await waitForHydration(page.locator("main"))

  const longest = await page.evaluate(() =>
    Math.max(
      ...[...document.querySelectorAll("main a, main button, aside a, aside button")].map((element) =>
        Math.max(...getComputedStyle(element).transitionDuration.split(",").map((value) => Number.parseFloat(value)))
      )
    )
  )

  expect(longest).toBeLessThan(0.001)
})

test("Tab stays inside an open dialog, however many times it is pressed", async ({ admin, pageAs, tenant }) => {
  const title = uniqueName("Trap")
  await seedTemplate(admin, tenant.organizationId, title, "draft")

  const page = await pageAs("owner_admin")
  const card = page.locator('[data-slot="template-card"]').filter({ hasText: title })

  await page.goto(`/templates?q=${encodeURIComponent(title)}`)
  await waitForHydration(card)
  await card.hover()
  await card.getByRole("button", { name: /^Actions for/ }).click()
  await page.getByRole("menuitem", { name: "Category…" }).click()

  const dialog = page.locator('[role="dialog"]').filter({ hasText: "Category for" })
  await expect(dialog.getByLabel("Category")).toBeFocused()

  for (let press = 0; press < 10; press += 1) {
    await page.keyboard.press("Tab")
    expect(await dialog.evaluate((element) => element.contains(document.activeElement)), `Tab ${press + 1}`).toBe(true)
  }

  for (let press = 0; press < 10; press += 1) {
    await page.keyboard.press("Shift+Tab")
    expect(await dialog.evaluate((element) => element.contains(document.activeElement)), `Shift+Tab ${press + 1}`).toBe(true)
  }
})

test("an icon tile's actions come before its name in the Tab order, where they sit on the tile", async ({ admin, pageAs, tenant }) => {
  const name = uniqueName("Order")
  const owner = tenant.users.owner_admin
  const { error } = await retryConcurrentChange(() =>
    admin.from("folders").insert({ created_by: owner.id, name, org_id: tenant.organizationId, updated_by: owner.id })
  )
  if (error) throw error

  const page = await pageAs("owner_admin")
  const tile = page.locator('[data-slot="file-tile"]').filter({ has: page.getByRole("link", { exact: true, name }) })

  await page.goto("/documents")
  await waitForHydration(tile)

  const actionsFirst = await tile.evaluate((element) => {
    const actions = element.querySelector('button[aria-label^="Actions for"]') as Element
    const link = element.querySelector('[data-slot="file-name"]') as Element
    return Boolean(actions.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING)
  })

  expect(actionsFirst).toBe(true)
})

test("a required public form field shows its error on the page and ties it to the field", async ({ admin, browser, tenant }) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Form"), "published")
  const token = await seedPublicFormLink(admin, tenant.organizationId, template.id)
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`/forms/${token}`)

  const field = page.getByLabel("Client reference")
  await waitForHydration(field)
  await page.getByRole("button", { name: "Submit form" }).click()

  await expect(field).toHaveAttribute("aria-invalid", "true")
  await expect(field).toHaveAccessibleDescription("Client reference is required.")
  await field.fill("REF-1")
  await expect(field).not.toHaveAttribute("aria-invalid", "true")
  await context.close()
})

test("a signer without a pointing device can type their signature", async ({ admin, browser, tenant }) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Typed"), "published")
  const { documentId, signingToken } = await seedSigningDocument(
    admin,
    tenant.organizationId,
    template,
    uniqueName("Typed agreement"),
    tenant.users.manager.id,
    { email: "typist@e2e.bizflow.test", name: "Avery Morgan" }
  )
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`/sign/${signingToken}`)
  await waitForHydration(page.getByRole("button", { name: "Submit signature" }))
  await page.getByLabel("Or type your signature").fill("Avery Morgan")
  await page.getByRole("button", { name: "Submit signature" }).click()

  await expect(page.getByText(/your signature is recorded/i)).toBeVisible()
  await expect
    .poll(async (): Promise<string | undefined> => {
      const { data } = await admin.from("document_signing_recipients").select("status").eq("document_id", documentId).single()
      return data?.status as string | undefined
    })
    .toBe("signed")
  await context.close()
})
