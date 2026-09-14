// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { TemplateRowMenu } from "@/components/templates/template-row-menu"

const TEMPLATE_ID = "30000000-0000-4000-8000-000000000001"

const mountedRoots: Root[] = []

beforeAll(() => {
  ;(
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean
    }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
})

async function duplicateAction(): Promise<void> {}

async function openMenu(published: boolean): Promise<void> {
  const container = document.createElement("div")
  document.body.append(container)

  const root = createRoot(container)
  mountedRoots.push(root)
  act(() =>
    root.render(
      <TemplateRowMenu
        duplicateAction={duplicateAction}
        published={published}
        templateId={TEMPLATE_ID}
        title="Lease renewal"
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
  it("offers a draft's editor and a copy, but no public links", async () => {
    await openMenu(false)

    expect(readItems()).toEqual([
      ["Edit", `/templates/${TEMPLATE_ID}/edit`],
      ["Duplicate", null],
    ])
  })

  it("adds the public links once the template is published", async () => {
    await openMenu(true)

    expect(readItems()).toEqual([
      ["Edit", `/templates/${TEMPLATE_ID}/edit`],
      ["Public links", `/templates/${TEMPLATE_ID}/links`],
      ["Duplicate", null],
    ])
  })

  it("duplicates by submitting the template's id from inside the menu", async () => {
    await openMenu(false)

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
