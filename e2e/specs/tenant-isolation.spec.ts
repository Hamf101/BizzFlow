import { randomUUID } from "node:crypto"

import type { APIResponse } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

import { expect, test, uniqueName } from "../support/fixtures"
import { retryConcurrentChange } from "../support/retry"
import { seedSigningDocument, seedSubmission, seedTemplate } from "../support/seed"
import {
  createAdminClient,
  destroyTenant,
  ORGANIZATION_ROLES,
  seedTenant,
  type SeededTenant,
} from "../support/tenant"

/**
 * A second organization's template, document and submission, probed by every
 * role of the shared tenant through the real routes and pages. The services
 * read with the service-role client, so their org_id filters are the only
 * barrier: each probe must be refused, carry none of tenant B's words, and
 * leave tenant B exactly as it was.
 */

type Other = {
  documentId: string
  prefix: string
  submissionId: string
  templateId: string
  tenant: SeededTenant
  titles: string[]
}

let other: Other

// Rows a tenant's members can add or change; a refused probe must add none.
const B_TABLES = [
  "audit_logs",
  "document_access_grants",
  "document_guest_grants",
  "document_recent_accesses",
  "template_access_grants",
  "working_copy_rooms",
] as const

test.beforeAll(async () => {
  const admin = createAdminClient()
  const prefix = uniqueName("Isolation")
  const titles = [`${prefix} template`, `${prefix} document`, `${prefix} submission`]
  const tenant = await seedTenant(admin, `iso-${randomUUID().slice(0, 8)}`)
  const template = await seedTemplate(admin, tenant.organizationId, titles[0], "published")
  const { documentId } = await seedSigningDocument(admin, tenant.organizationId, template, titles[1], tenant.users.owner_admin.id, {
    email: `signer-${randomUUID().slice(0, 8)}@e2e.bizflow.test`,
    name: "Isolation signer",
  })
  const submissionId = await seedSubmission(admin, tenant.organizationId, template, titles[2], tenant.users.staff.id)

  other = { documentId, prefix, submissionId, templateId: template.id, tenant, titles }
})

test.afterAll(async () => {
  if (other) await destroyTenant(createAdminClient(), other.tenant)
})

async function snapshotOther(admin: SupabaseClient): Promise<unknown[]> {
  const organizationId = other.tenant.organizationId
  const row = async (table: string, id: string) => {
    const { data, error } = await admin.from(table).select("*").eq("org_id", organizationId).eq("id", id).single()
    if (error) throw error
    return data
  }
  const count = async (table: string) => {
    const { count: rows, error } = await admin.from(table).select("*", { count: "exact", head: true }).eq("org_id", organizationId)
    if (error) throw error
    return [table, rows]
  }

  return Promise.all([
    row("document_templates", other.templateId),
    row("documents", other.documentId),
    row("submissions", other.submissionId),
    ...B_TABLES.map(count),
  ])
}

async function expectRefused(response: APIResponse, label: string): Promise<void> {
  expect.soft([403, 404], label).toContain(response.status())
  await expectNothingOf(response, label)
}

async function expectNothingOf(response: { text(): Promise<string> }, label: string): Promise<void> {
  const body = await response.text()

  for (const title of other.titles) expect.soft(body, label).not.toContain(title)
}

for (const role of ORGANIZATION_ROLES) {
  test(`${role} of another organization reaches nothing of tenant B through the API or pages`, async ({ admin, pageAs, tenant }) => {
    const before = await snapshotOther(admin)
    const page = await pageAs(role)
    const api = page.request
    const { documentId, submissionId, templateId } = other
    const draft = { content: (await admin.from("document_templates").select("content").eq("id", templateId).single()).data?.content, description: "", title: "Draft" }
    const roomId = randomUUID()

    // Ids from tenant B, claimed under the actor's own organization and under B's.
    for (const organizationId of [tenant.organizationId, other.tenant.organizationId]) {
      const label = (route: string) => `${role} ${route} as ${organizationId === tenant.organizationId ? "own" : "B's"} organization`

      await expectRefused(await api.post(`/api/documents/${documentId}/download-url`, { data: { organizationId } }), label("download-url"))
      await expectRefused(await api.post(`/api/documents/${documentId}/download-url`, { data: { organizationId, view: true } }), label("view-url"))
      await expectRefused(await api.post(`/api/documents/${documentId}/opened`, { data: { organizationId } }), label("opened"))
      await expectRefused(await api.post(`/api/submissions/${submissionId}/preview`, { data: { organizationId } }), label("submission preview"))
    }

    // Routes that take the organization from the session.
    await expectRefused(await api.get(`/api/documents/${documentId}/pdf`), `${role} pdf`)
    await expectRefused(await api.post(`/api/documents/${documentId}/room`), `${role} document room`)
    await expectRefused(
      await api.post(`/api/documents/${documentId}/room/updates`, { data: { roomId, update: "" } }),
      `${role} document room update`
    )
    await expectRefused(await api.get(`/api/documents/${documentId}/room/updates?roomId=${roomId}&after=0`), `${role} document room read`)
    await expectRefused(
      await api.post(`/api/documents/${documentId}/flow`, { data: { draft, instruction: "Summarise this page." } }),
      `${role} document flow`
    )
    await expectRefused(await api.post(`/api/templates/${templateId}/room`), `${role} template room`)
    await expectRefused(
      await api.post(`/api/templates/${templateId}/room/updates`, { data: { roomId, update: "" } }),
      `${role} template room update`
    )
    await expectRefused(await api.get(`/api/templates/${templateId}/room/updates?roomId=${roomId}&after=0`), `${role} template room read`)
    await expectRefused(
      await api.post("/api/templates/flow", { data: { draft, instruction: "Summarise this page.", templateId } }),
      `${role} template flow`
    )

    // Lists and exports answer for the actor's own organization only.
    await expectNothingOf(await api.get(`/api/search?q=${encodeURIComponent(other.prefix)}`), `${role} search`)
    await expectNothingOf(await api.get("/api/export/submissions"), `${role} submissions export`)

    // Pages for tenant B's ids show none of it.
    for (const path of [
      `/documents/${documentId}`,
      `/documents/${documentId}/edit`,
      `/documents/${documentId}/preview`,
      `/templates/${templateId}/edit`,
      `/templates/${templateId}/links`,
      `/submissions/${submissionId}`,
    ]) {
      const response = await api.get(path)
      expect.soft(response.status(), `${role} ${path}`).toBeLessThan(500)
      await expectNothingOf(response, `${role} ${path}`)
    }

    expect(await snapshotOther(admin)).toEqual(before)
  })
}

test("sharing aimed at tenant B's document by rewriting the request changes nothing there", async ({ admin, pageAs, tenant }) => {
  const before = await snapshotOther(admin)
  const owner = tenant.users.owner_admin
  const title = uniqueName("Isolation share")
  const { data: own, error } = await retryConcurrentChange(() =>
    admin
      .from("documents")
      .insert({ created_by: owner.id, org_id: tenant.organizationId, source_kind: "upload", title, updated_by: owner.id })
      .select("id")
      .single()
  )
  if (error) throw error

  const page = await pageAs("owner_admin")
  let rewriting = false
  let rewritten = 0
  // A tampered client: every server action that names the actor's own
  // document names tenant B's instead.
  await page.route("**/*", async (route) => {
    const request = route.request()
    const body = request.postData()

    if (rewriting && request.method() === "POST" && request.headers()["next-action"] && body?.includes(own.id)) {
      rewritten += 1
      await route.continue({ postData: body.replaceAll(own.id, other.documentId) })
      return
    }

    await route.continue()
  })

  await page.goto(`/documents?q=${encodeURIComponent(title)}`)
  const openShare = async () => {
    await page.getByRole("button", { name: `Actions for ${title}` }).click()
    await page.getByRole("menuitem", { name: "Share…" }).click()
  }
  const dialog = page.getByRole("dialog")

  // Changing access: the dialog opens on the actor's own document, then the
  // grant is sent for tenant B's.
  await openShare()
  await expect(dialog.getByRole("heading", { name: `Share “${title}”` })).toBeVisible()
  rewriting = true
  const granted = page.waitForResponse((response) => Boolean(response.request().headers()["next-action"]))
  await dialog.getByLabel("Find a person or group").fill(tenant.users.manager.email)
  await dialog
    .getByRole("list", { name: "People you can add" })
    .getByRole("button", { name: new RegExp(tenant.users.manager.email) })
    .click()
  await expectNothingOf(await granted, "rewritten grant")
  await page.keyboard.press("Escape")

  // Reading: the dialog asks for tenant B's sharing.
  const loaded = page.waitForResponse((response) => Boolean(response.request().headers()["next-action"]))
  await openShare()
  await expectNothingOf(await loaded, "rewritten sharing read")
  await expect(page.getByText(other.titles[1])).toHaveCount(0)

  expect(rewritten).toBeGreaterThanOrEqual(2)
  expect(await snapshotOther(admin)).toEqual(before)
})
