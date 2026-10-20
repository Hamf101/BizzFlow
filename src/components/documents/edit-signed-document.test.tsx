// @vitest-environment jsdom

import { act, createElement } from "react"
import { describe, expect, it, vi } from "vitest"

import { EditSentDocumentButton, signedDocumentActions } from "@/components/documents/edit-signed-document"
import { mount } from "@/test/render"

const SENDER = { canCopy: true, canFill: true, canSend: true }

async function openDialog(signedCount: number): Promise<HTMLElement> {
  const root = mount()

  await act(async () => {
    root.render(createElement(EditSentDocumentButton, { action: vi.fn(async () => {}), documentId: "document-1", signedCount }))
  })
  const edit = [...document.querySelectorAll("button")].find((button) => button.textContent === "Edit")!

  await act(async () => {
    edit.click()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })

  return document.querySelector('[data-slot="dialog-content"]') as HTMLElement
}

describe("editing a sent document", () => {
  it("offers Edit only to a sender who may fill it while it awaits signatures, and Edit a copy only once completed", () => {
    expect(signedDocumentActions({ ...SENDER, workflowStatus: "awaiting_signatures" })).toEqual({ copy: false, edit: true })
    expect(signedDocumentActions({ ...SENDER, workflowStatus: "completed" })).toEqual({ copy: true, edit: false })
    expect(signedDocumentActions({ ...SENDER, workflowStatus: "draft" })).toEqual({ copy: false, edit: false })
    expect(signedDocumentActions({ ...SENDER, canSend: false, workflowStatus: "awaiting_signatures" }).edit).toBe(false)
    expect(signedDocumentActions({ ...SENDER, canFill: false, workflowStatus: "awaiting_signatures" }).edit).toBe(false)
    expect(signedDocumentActions({ ...SENDER, canCopy: false, workflowStatus: "completed" }).copy).toBe(false)
  })

  it("says how many signatures the edit cancels before it does anything", async () => {
    const dialog = await openDialog(2)

    expect(dialog.textContent).toContain("Edit this document?")
    expect(dialog.textContent).toContain("2 signatures so far will be cancelled. Everyone you sent it to will need to sign again.")
    // Cancel sits inside the form, so it must never submit it.
    expect([...dialog.querySelectorAll("button")].map((button) => [button.textContent, button.type])).toEqual([
      ["Cancel", "button"],
      ["Edit document", "submit"],
    ])
    expect(dialog.querySelector<HTMLInputElement>('input[name="documentId"]')?.value).toBe("document-1")
  })

  it("says the links stop working when no one has signed yet", async () => {
    expect((await openDialog(0)).textContent).toContain("Signing links already sent will stop working.")
  })
})
