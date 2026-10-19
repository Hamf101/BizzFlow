// @vitest-environment jsdom

import { act } from "react"
import { expect, it, vi } from "vitest"

import { NewFileMenu } from "@/components/files/new-file-menu"
import { mount } from "@/test/render"

it("starts a sheet from New, where the member may add documents", async () => {
  const newSheet = vi.fn(async () => undefined)
  act(() => mount().render(<NewFileMenu addDocumentHref="/documents/new" newFolder={null} newSheet={newSheet} />))

  act(() => document.querySelector<HTMLElement>('[data-slot="dropdown-menu-trigger"]')!.click())
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((candidate) => candidate.textContent === "Sheet")
  await act(async () => item!.click())

  expect(newSheet).toHaveBeenCalledOnce()
})
