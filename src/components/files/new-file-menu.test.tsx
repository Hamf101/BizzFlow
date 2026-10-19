// @vitest-environment jsdom

import { act } from "react"
import { expect, it, vi } from "vitest"

import { NewFileMenu } from "@/components/files/new-file-menu"
import { mount } from "@/test/render"

it("starts a sheet from New in the open folder, where the member may add documents", async () => {
  const createSheet = vi.fn<(folderId: string | null) => Promise<void>>(async () => undefined)
  act(() => mount().render(<NewFileMenu addDocumentHref="/documents/new" createSheet={createSheet} folderId="folder-1" newFolder={null} />))

  act(() => document.querySelector<HTMLElement>('[data-slot="dropdown-menu-trigger"]')!.click())
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((candidate) => candidate.textContent === "Sheet")
  await act(async () => item!.click())

  expect(createSheet).toHaveBeenCalledWith("folder-1")
})
