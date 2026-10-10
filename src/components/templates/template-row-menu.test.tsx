// @vitest-environment jsdom

import { act } from "react"
import { describe, expect, it } from "vitest"

import { TemplateRowMenu } from "@/components/templates/template-row-menu"
import { mount } from "@/test/render"

const TEMPLATE_ID = "30000000-0000-4000-8000-000000000001"

async function duplicateAction(): Promise<void> {}

async function openMenu(
  status: "archived" | "draft" | "published",
  rights: { canDuplicate?: boolean; canEdit?: boolean; trashed?: boolean } = {}
): Promise<void> {
  const root = mount()
  act(() =>
    root.render(
      <TemplateRowMenu
        canDuplicate={rights.canDuplicate ?? true}
        canEdit={rights.canEdit ?? true}
        duplicateAction={duplicateAction}
        status={status}
        templateId={TEMPLATE_ID}
        title="Lease renewal"
        trashed={rights.trashed ?? false}
      />
    )
  )

  const trigger = document.querySelector(
    'button[aria-label="Actions for Lease renewal"]'
  )

  if (!(trigger instanceof HTMLButtonElement)) {
    throw new Error("Expected the row's action button.")
  }

  await act(async () => {
    trigger.click()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

function readItems(): Array<[string | undefined, string | null]> {
  return [...document.querySelectorAll('[role="menuitem"]')].map(
    (item: Element): [string | undefined, string | null] => [
      item.textContent?.trim(),
      item.getAttribute("href"),
    ]
  )
}

describe("TemplateRowMenu", () => {
  it("offers a draft's editor, a copy, archiving, Trash and a category, but no public links", async () => {
    await openMenu("draft")

    expect(readItems()).toEqual([
      ["Edit", `/templates/${TEMPLATE_ID}/edit`],
      ["Share…", null],
      ["Duplicate", null],
      ["Archive", null],
      ["Move to Trash", null],
      ["Category…", null],
    ])
  })

  it("offers an archived template a way back, or on to Trash", async () => {
    await openMenu("archived")

    expect(readItems()).toEqual([["Restore", null], ["Move to Trash", null]])
  })

  it("offers a template in Trash a way back, or to delete it for good after typing its title", async () => {
    await openMenu("archived", { trashed: true })

    expect(readItems()).toEqual([["Restore", null], ["Delete permanently…", null]])

    const purge = [...document.querySelectorAll('[role="menuitem"]')].find(
      (item: Element): boolean => item.textContent?.trim() === "Delete permanently…"
    )

    await act(async () => {
      ;(purge as HTMLElement).click()
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

    const dialog = document.querySelector('[role="dialog"]')

    expect(dialog?.textContent).toContain("Delete Lease renewal permanently?")
    expect(dialog?.querySelector('input[name="templateId"]')?.getAttribute("value")).toBe(TEMPLATE_ID)
    expect(dialog?.querySelector('input[name="confirmationTitle"]')?.hasAttribute("required")).toBe(true)
  })

  it("adds sending to answer and the public links once the template is published", async () => {
    await openMenu("published")

    expect(readItems()).toEqual([
      ["Edit", `/templates/${TEMPLATE_ID}/edit`],
      ["Send to answer…", null],
      ["Public links", `/templates/${TEMPLATE_ID}/links`],
      ["Share…", null],
      ["Duplicate", null],
      ["Archive", null],
      ["Move to Trash", null],
      ["Category…", null],
    ])
  })

  it("offers someone who can only make copies just that, and someone who can only edit no copy", async () => {
    await openMenu("published", { canEdit: false })

    expect(readItems()).toEqual([["Duplicate", null]])
  })

  it("lets someone who was given the template to edit share it without being able to copy it", async () => {
    await openMenu("draft", { canDuplicate: false })

    expect(readItems().map(([label]) => label)).toEqual(["Edit", "Share…", "Archive", "Move to Trash", "Category…"])
  })

  it("duplicates by submitting the template's id from inside the menu", async () => {
    await openMenu("draft")

    const duplicate = [...document.querySelectorAll('[role="menuitem"]')].find(
      (item: Element): boolean => item.textContent?.trim() === "Duplicate"
    )

    expect(duplicate?.tagName).toBe("BUTTON")
    expect(duplicate?.getAttribute("type")).toBe("submit")
    expect(
      duplicate
        ?.closest("form")
        ?.querySelector('input[name="templateId"]')
        ?.getAttribute("value")
    ).toBe(TEMPLATE_ID)
  })
})
