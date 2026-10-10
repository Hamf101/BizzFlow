// @vitest-environment jsdom

import { act } from "react"
import { describe, expect, it, vi } from "vitest"

import type { QueueItem } from "@/components/dashboard/dashboard-view"

vi.mock("next/link", () => ({ default: "a" }))

import { QueueList } from "./queue-list"
import { mount } from "@/test/render"

describe("the waiting-on-you list", () => {
  it("never keeps work out of reach: what the first page leaves out opens in place", async () => {
    await render(Array.from({ length: 9 }, (_, index) => item(`item-${index + 1}`)))

    expect(row("item-9").closest("li")?.hidden).toBe(true)

    await act(async () => showAll().click())

    expect(row("item-9").closest("li")?.hidden).toBe(false)
    expect(document.body.textContent).not.toContain("Show all")
  })

  it("offers nothing to expand when everything already shows", async () => {
    await render([item("only")])

    expect(document.body.textContent).not.toContain("Show all")
  })
})

async function render(items: QueueItem[]): Promise<void> {
  const root = mount()

  await act(async () => root.render(<QueueList items={items} />))
}

function row(title: string): HTMLElement {
  const link = [...document.querySelectorAll("a")].find((anchor) => anchor.textContent?.includes(title))
  if (!link) throw new Error(`no row for ${title}`)
  return link
}

function showAll(): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find((element) => element.textContent === "Show all 9")
  if (!button) throw new Error("no Show all button")
  return button
}

function item(id: string): QueueItem {
  return {
    action: "Review",
    context: null,
    href: `/submissions/${id}`,
    id,
    kind: "Review",
    title: id,
    tone: "you",
    when: "Submitted today",
  }
}
