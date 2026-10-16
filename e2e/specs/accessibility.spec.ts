import { expect, test, uniqueName } from "../support/fixtures"
import {
  expectNoActionableAxeViolations,
  expectNoHorizontalPageClipping,
  expectPrimaryRouteSemantics,
  expectReachablePrimaryAction,
  expectVisibleKeyboardFocus,
} from "../support/accessibility"
import { waitForHydration } from "../support/hydration"
import {
  seedFolder,
  seedPublicFormLink,
  seedSigningDocument,
  seedSubmission,
  seedTemplate,
} from "../support/seed"

test.use({ screenshot: "off", trace: "off", video: "off" })

test.describe("representative accessibility evidence", () => {
  test("keeps authentication semantics and keyboard focus accessible", async ({
    page,
  }) => {
    await page.goto("/login")

    await expectPrimaryRouteSemantics(page)
    await expectVisibleKeyboardFocus(page)
    await expectNoActionableAxeViolations(page)
  })

  test("keeps representative role routes accessible", async ({ pageAs }) => {
    const routes = [
      { path: "/dashboard", role: "owner_admin" },
      { path: "/documents", role: "owner_admin" },
      { path: "/templates", role: "manager" },
      { path: "/tasks", role: "staff" },
    ] as const

    for (const route of routes) {
      const page = await pageAs(route.role)

      await page.goto(route.path)
      await expectPrimaryRouteSemantics(page)
      await expectNoActionableAxeViolations(page)
    }
  })

  // An archived template's page picture is drawn faded; the picture's text
  // must not count as the page's own text when contrast is judged.
  test("keeps Templates accessible with an archived template on it", async ({ admin, pageAs, tenant }) => {
    const title = uniqueName("Archived lease")
    await seedTemplate(admin, tenant.organizationId, title, "archived")
    const page = await pageAs("manager")

    await page.goto(`/templates?q=${encodeURIComponent(title)}`)
    await expect(page.locator('[data-slot="template-title"]', { hasText: title })).toBeVisible()
    await expectNoActionableAxeViolations(page)
  })

  test("announces fixed live action feedback", async ({ pageAs }) => {
    const page = await pageAs("owner_admin")

    await page.goto("/dashboard?feedback=changes_saved")

    // The page may still be streaming in behind its own "Loading page" status,
    // so find the announcement by what it says.
    const announcement = page.getByRole("status").filter({ hasText: "Changes saved" })
    await expect(announcement).toBeVisible()
  })

  test("keeps tokenized public routes accessible without recording their URLs", async ({
    admin,
    page,
    tenant,
  }) => {
    const template = await seedTemplate(
      admin,
      tenant.organizationId,
      uniqueName("Accessible public"),
      "published"
    )
    const publicToken = await seedPublicFormLink(
      admin,
      tenant.organizationId,
      template.id
    )
    const { signingToken } = await seedSigningDocument(
      admin,
      tenant.organizationId,
      template,
      uniqueName("Accessible signing"),
      tenant.users.manager.id,
      { email: "accessible-signer@e2e.bizflow.test", name: "Morgan Lee" }
    )

    await page.goto(`/forms/${publicToken}`)
    await expectPrimaryRouteSemantics(page)
    await expectNoActionableAxeViolations(page)

    await page.goto(`/sign/${signingToken}`)
    await expectPrimaryRouteSemantics(page)
    await expectNoActionableAxeViolations(page)
  })
})

test.describe("responsive interaction evidence", () => {
  test("keeps the approved shell stable across the six viewport classes", async ({
    pageAs,
  }) => {
    const page = await pageAs("owner_admin")
    const viewports = [320, 390, 430, 768, 1024, 1440] as const

    await page.goto("/templates")
    await expect(page.getByRole("button", { name: "Create template" })).toBeVisible()

    for (const width of viewports) {
      await page.setViewportSize({ height: 900, width })

      const desktopSidebar = page.locator("aside")
      const mobileHeader = page.locator("header").first()
      const mobileNavigation = page.getByRole("navigation", {
        name: "Mobile navigation",
      })
      const primaryAction = page.getByRole("button", { name: "Create template" })

      await expectNoHorizontalPageClipping(page)
      await expectReachablePrimaryAction(primaryAction, page)

      if (width < 768) {
        await expect(desktopSidebar).toBeHidden()
        await expect(mobileHeader).toBeVisible()
        await expect(mobileNavigation).toBeVisible()
        await expect(mobileHeader).toHaveCSS("position", "sticky")
        await expect(mobileNavigation).toHaveCSS("position", "fixed")
        await expect(mobileNavigation).toHaveCSS("bottom", "0px")
      } else {
        await expect(desktopSidebar).toBeVisible()
        await expect(mobileHeader).toBeHidden()
        await expect(mobileNavigation).toBeHidden()
      }
    }
  })

  test("keeps the current page still instead of flashing loading UI during navigation", async ({
    pageAs,
  }) => {
    const page = await pageAs("owner_admin")
    await page.setViewportSize({ height: 900, width: 1024 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/dashboard")
    // Watched from before the click: a skeleton that flashed and went would be
    // gone by the time anything looked for it.
    const skeleton = '[data-slot="page-skeleton-content"]'
    await expect(page.locator(skeleton)).toHaveCount(0)
    await page.evaluate((selector) => {
      const flags = window as unknown as { flashed: boolean }
      flags.flashed = false
      new MutationObserver(() => {
        flags.flashed ||= document.querySelector(selector) !== null
      }).observe(document.body, { childList: true, subtree: true })
    }, skeleton)
    await page.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url())

      if (
        route.request().method() === "GET" &&
        requestUrl.pathname === "/documents"
      ) {
        await new Promise((resolve) => setTimeout(resolve, 450))
      }

      await route.continue()
    })

    await page.locator('aside a[href="/documents"]').click()
    await expect(page).toHaveURL(/\/documents(?:\?|$)/)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Files")

    // Undefined would mean the document reloaded and the watch was lost.
    expect(await page.evaluate(() => (window as unknown as { flashed?: boolean }).flashed)).toBe(false)
  })
})

test.describe("workspace lists stay inside the viewport", () => {
  const widths = [320, 390, 430, 768, 1024, 1440] as const

  for (const path of [
    "/people",
    "/tasks",
    "/submissions",
    "/templates",
    "/documents",
  ] as const) {
    test(`keeps ${path} inside the six viewport classes`, async ({
      admin,
      pageAs,
      tenant,
    }) => {
      const title = uniqueName("Viewport")
      const owner = tenant.users.owner_admin

      // A list draws its columns only once it has a row, so each gets one.
      if (path === "/tasks") {
        const { error } = await admin.from("tasks").insert({
          created_by: owner.id,
          org_id: tenant.organizationId,
          title: `${title} task`,
          updated_by: owner.id,
        })
        if (error) throw error
      }
      if (path === "/submissions") {
        const template = await seedTemplate(
          admin,
          tenant.organizationId,
          `${title} template`,
          "published"
        )
        await seedSubmission(
          admin,
          tenant.organizationId,
          template,
          `${title} submission`,
          owner.id
        )
      }
      if (path === "/templates") {
        await seedTemplate(
          admin,
          tenant.organizationId,
          `${title} template`,
          "published"
        )
      }
      if (path === "/documents") {
        await seedFolder(admin, tenant.organizationId, owner.id, `${title} folder`)
      }

      const page = await pageAs("owner_admin")

      await page.goto(path)
      // Streamed rows exist before they replace the loading fallback, so wait
      // until the first one is on screen and measure the list, not the fallback.
      // Templates lays its library out as cards, and Files starts in Icons.
      await expect(
        path === "/templates"
          ? page.locator('[data-slot="template-card"]').first()
          : path === "/documents"
            ? page.locator('[data-slot="file-tile"]').first()
            : page.locator('[role="row"]').nth(1)
      ).toBeVisible()

      for (const width of widths) {
        await page.setViewportSize({ height: 900, width })
        await expectNoHorizontalPageClipping(page)
      }
    })
  }
})

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
  const longest = () =>
    page.evaluate(() =>
      Math.max(
        ...[...document.querySelectorAll("main a, main button, aside a, aside button")].map((element) =>
          Math.max(...getComputedStyle(element).transitionDuration.split(",").map((value) => Number.parseFloat(value)))
        )
      )
    )

  await page.goto("/templates")
  await waitForHydration(page.locator("main"))
  // Something moves by default, so what follows is reduced motion's doing.
  expect(await longest()).toBeGreaterThan(0.001)

  await page.emulateMedia({ reducedMotion: "reduce" })
  expect(await longest()).toBeLessThan(0.001)
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

test("Tab meets an icon tile's name, then its actions, in the order the eye reads them on the tile", async ({ admin, pageAs, tenant }) => {
  const name = uniqueName("Order")
  const owner = tenant.users.owner_admin
  await seedFolder(admin, tenant.organizationId, owner.id, name)

  const page = await pageAs("owner_admin")
  const tile = page.locator('[data-slot="file-tile"]').filter({ has: page.getByRole("link", { exact: true, name }) })

  await page.goto("/documents")
  await waitForHydration(tile)

  // The name opens the tile's top row and its actions close it, so Tab goes name, then actions.
  const placed = await tile.evaluate((element) => {
    const actions = element.querySelector('button[aria-label^="Actions for"]') as Element
    const link = element.querySelector('[data-slot="file-name"]') as Element
    return {
      actionsAfterName: Boolean(link.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING),
      actionsRightOfName: actions.getBoundingClientRect().left >= link.getBoundingClientRect().left,
    }
  })

  expect(placed).toEqual({ actionsAfterName: true, actionsRightOfName: true })
})

test("a required public form field shows its error on the page and ties it to the field", async ({ admin, browser, tenant }) => {
  const template = await seedTemplate(admin, tenant.organizationId, uniqueName("Form"), "published")
  const token = await seedPublicFormLink(admin, tenant.organizationId, template.id)
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`/forms/${token}`)

  const field = page.getByLabel("Client reference")
  await waitForHydration(field)
  await page.getByRole("button", { name: "Submit" }).click()

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
