// @vitest-environment jsdom

import { act } from "react"
import { expect, it } from "vitest"

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { mount } from "@/test/render"

import { ExportMenu, ExportMenuItems, exportLinks } from "./export-menu"

const DOCUMENT = "/api/documents/document-1"

// What the open menu offers, as a person reads it, with where each item goes.
function openItems(): Array<[string, string | null]> {
  const trigger = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-trigger"]')

  act(() => trigger?.click())

  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => [
    item.textContent ?? "",
    item.getAttribute("href"),
  ])
}

function render(node: React.ReactNode): void {
  act(() => mount().render(node))
}

it("offers a draft as PDF, Word and fillable PDF, in that order", () => {
  render(<ExportMenu links={exportLinks(DOCUMENT, { fillable: true })} />)

  expect(document.body.textContent).toContain("Export")
  expect(openItems()).toEqual([
    ["PDF", `${DOCUMENT}/pdf`],
    ["Word (.docx)", `${DOCUMENT}/docx`],
    ["Fillable PDF", `${DOCUMENT}/pdf?fillable=1`],
  ])
})

it("offers a completed document as PDF and Word only, from the primary button", () => {
  render(<ExportMenu links={exportLinks(DOCUMENT)} primary />)

  expect(document.querySelector('[data-slot="dropdown-menu-trigger"]')?.className).toContain("bg-primary")
  expect(openItems()).toEqual([
    ["PDF", `${DOCUMENT}/pdf`],
    ["Word (.docx)", `${DOCUMENT}/docx`],
  ])
})

it("ends with the original upload, set apart, only when there is one", () => {
  render(<ExportMenu links={exportLinks(DOCUMENT, { original: "/api/documents/document-1/original" })} />)

  expect(openItems()).toEqual([
    ["PDF", `${DOCUMENT}/pdf`],
    ["Word (.docx)", `${DOCUMENT}/docx`],
    ["Download original", "/api/documents/document-1/original"],
  ])
  expect(document.querySelectorAll('[data-slot="dropdown-menu-separator"]')).toHaveLength(1)
})

it("offers a template, which has no PDF of its own, as Word only", () => {
  render(<ExportMenu links={exportLinks("/api/templates/template-1", { pdf: false })} />)

  expect(openItems()).toEqual([["Word (.docx)", "/api/templates/template-1/docx"]])
})

it("puts the same items, under an Export heading, in another menu on a phone", () => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>More</DropdownMenuTrigger>
      <DropdownMenuContent>
        <ExportMenuItems heading links={exportLinks(DOCUMENT, { fillable: true })} />
      </DropdownMenuContent>
    </DropdownMenu>
  )

  expect(openItems()).toEqual([
    ["PDF", `${DOCUMENT}/pdf`],
    ["Word (.docx)", `${DOCUMENT}/docx`],
    ["Fillable PDF", `${DOCUMENT}/pdf?fillable=1`],
  ])
  expect(document.querySelector('[data-slot="dropdown-menu-label"]')?.textContent).toBe("Export")
})
