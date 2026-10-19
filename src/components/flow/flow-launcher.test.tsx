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
  // A screen reader hears whose words each turn is: the member's own are theirs.
  expect([...document.querySelectorAll("li")].find((entry) => entry.textContent?.includes("Recreate this form"))?.textContent).toBe("YouRecreate this form")
  // The next request isn't about that form unless it is attached again.
  expect(document.body.textContent).not.toContain(SOURCE.name)
})

it("turns a pasted BizFlow link into a mention that goes with the next message only", async () => {
  vi.stubGlobal("matchMedia", () => ({ addEventListener: () => undefined, matches: false, removeEventListener: () => undefined }))
  const fetchFlow = vi.fn(async () => new Response(JSON.stringify({ kind: "reply", reply: "It's due on the 20th." })))
  vi.stubGlobal("fetch", fetchFlow)
  const root = mount()
  const TASK = "77000000-0000-4000-8000-000000000002"

  await act(async () => root.render(<FlowLauncher organizationId="10000000-0000-4000-8000-000000000001" />))
  const composer = document.querySelector("textarea") as HTMLTextAreaElement
  const pasted = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: { getData: () => string } }
  pasted.clipboardData = { getData: () => `${location.origin}/tasks/${TASK}` }
  await act(async () => composer.dispatchEvent(pasted))

  expect(pasted.defaultPrevented).toBe(true)
  expect(document.querySelector('[data-slot="flow-mention"]')?.textContent).toContain("Task")

  const type = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  await act(async () => {
    type.call(composer, "when is this due?")
    composer.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await act(async () => (document.querySelector('button[aria-label="Send to Flow"]') as HTMLButtonElement).click())

  expect(JSON.parse(String((fetchFlow.mock.calls[0] as unknown[])[1] && ((fetchFlow.mock.calls[0] as unknown[])[1] as RequestInit).body)).mentions).toEqual([{ id: TASK, kind: "tasks" }])
  // Sent, the mention is gone: the next message is about whatever it says.
  expect(document.querySelector('[data-slot="flow-mention"]')).toBeNull()

  // A send that fails gives back the words and what they mentioned, to send again.
  fetchFlow.mockImplementationOnce(async () => Response.json({ error: "Flow is busy." }, { status: 429 }))
  await act(async () => composer.dispatchEvent(Object.assign(new Event("paste", { bubbles: true, cancelable: true }), { clipboardData: { getData: () => `${location.origin}/tasks/${TASK}` } })))
  await act(async () => {
    type.call(composer, "and now?")
    composer.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await act(async () => (document.querySelector('button[aria-label="Send to Flow"]') as HTMLButtonElement).click())

  expect(composer.value).toBe("and now?")
  expect(document.querySelector('[data-slot="flow-mention"]')?.textContent).toContain("Task")
})
