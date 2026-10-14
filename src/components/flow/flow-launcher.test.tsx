// @vitest-environment jsdom

import { act } from "react"
import { afterEach, expect, it, vi } from "vitest"

import { openFlowWith } from "@/components/flow/flow-attach"
import { takeFlowHandoff } from "@/components/flow/flow-handoff"
import { FlowLauncher } from "@/components/flow/flow-launcher"
import { mount } from "@/test/render"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/app/(dashboard)/templates/actions", () => ({ createTemplateAction: vi.fn(async () => undefined) }))
vi.mock("@/app/(dashboard)/documents/actions", () => ({ createGeneratedDocumentAction: vi.fn(async () => undefined) }))

const SOURCE = { id: "50000000-0000-4000-8000-000000000001", name: "Intake.pdf" }

afterEach(() => {
  vi.unstubAllGlobals()
})

it("hands an attached form to the new template, and lets it go from the launcher", async () => {
  vi.stubGlobal("matchMedia", () => ({ addEventListener: () => undefined, matches: false, removeEventListener: () => undefined }))
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ kind: "create", reply: "Recreating your form.", sourceDocumentId: SOURCE.id, target: "template", title: "Intake" }))
  ))
  const root = mount()

  await act(async () => root.render(<FlowLauncher organizationId="10000000-0000-4000-8000-000000000001" />))
  await act(async () => openFlowWith(SOURCE))
  expect(document.body.textContent).toContain(SOURCE.name)

  await act(async () => (document.querySelector('button[aria-label="Send to Flow"]') as HTMLButtonElement).click())

  expect(takeFlowHandoff()).toEqual({ instruction: "Recreate this form", source: SOURCE })
  // The next request isn't about that form unless it is attached again.
  expect(document.body.textContent).not.toContain(SOURCE.name)
})
