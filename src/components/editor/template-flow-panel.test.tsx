// @vitest-environment jsdom

import { act, type ReactElement, useState } from "react"
import type { Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"

import { TemplateFlowPanel } from "@/components/editor/template-flow-panel"
import { createTemplateFlowDraftFingerprint } from "@/services/template-flow-proposal-state"
import { createBlankTemplateContent } from "@/types/template"
import type { TemplateFlowDraft, TemplateFlowLedgerItem, TemplateFlowOperationType, TemplateFlowProposal } from "@/types/template-flow"
import { mount } from "@/test/render"

const TEMPLATE_ID = "30000000-0000-4000-8000-000000000001"
const draft: TemplateFlowDraft = { title: "Vehicle form", description: "", content: createBlankTemplateContent() }

let root: Root | null = null

afterEach(() => {
  root = null
  vi.unstubAllGlobals()
})

function item(index: number, type: TemplateFlowOperationType, summary: string, dependsOn: number[] = []): TemplateFlowLedgerItem {
  return { id: `item-${index}`, type, summary, target: "Document", affectedBlockIds: [], dependsOn }
}

function proposal(title: string, operations: TemplateFlowLedgerItem[]): TemplateFlowProposal {
  return {
    id: `proposal-${title}`,
    status: "pending",
    baseDraftFingerprint: createTemplateFlowDraftFingerprint(draft),
    candidateDraft: { ...draft, title },
    operations,
    wireOperations: operations.map((operation) => ({ type: operation.type, summary: operation.summary, payload: {} })),
    changedBlockIds: [],
    qualityIssues: [],
  }
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

function buttonNamed(name: string, index = 0): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].filter(
    (button) => button.getAttribute("aria-label") === name || button.textContent?.trim() === name
  )[index]

  if (!found) {
    throw new Error(`Expected a button named ${name}.`)
  }

  return found
}

function card(): string {
  return document.querySelector('[aria-label="Pending Flow proposal"]')?.textContent ?? ""
}

it("drops a change with what needs it, applies only the kept ones, and keeps them again", async () => {
  const proposed = proposal("Proposed", [
    item(0, "add_block", "Asked the vehicle"),
    item(1, "add_block", "Asked the van's size", [0]),
    item(2, "remove_block", "Removed the introduction"),
  ])
  const rebuilt = proposal("Rebuilt", [item(0, "remove_block", "Removed the introduction")])
  const message = (role: "user" | "assistant", id: string) => ({
    id, role, content: "Done.", authorName: null, operations: role === "assistant" ? proposed.operations : [], changedBlockIds: [], receiptStatus: null, createdAt: "2026-10-06T09:00:00.000Z",
  })
  const fetchFlow = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith("/rebuild")
        ? { proposal: rebuilt }
        : { proposal: proposed, messages: [message("user", "m-1"), message("assistant", "m-2")], needsConfirmation: false, persistenceWarning: null },
  }))
  const onApplyProposal = vi.fn()
  vi.stubGlobal("fetch", fetchFlow)

  // The editor owns the proposal on show, as both editors do.
  function Editor(): ReactElement {
    const [pending, setPending] = useState<TemplateFlowProposal | null>(null)

    return (
      <TemplateFlowPanel
        autoSend="Ask about the vehicle."
        canUndo={false}
        draft={draft}
        initialMessages={[]}
        lastAppliedMessageId={null}
        onApplyProposal={(applied, messageId) => {
          onApplyProposal(applied, messageId)
          setPending(null)
        }}
        onProposalReceived={setPending}
        onProposalStale={setPending}
        onRejectProposal={() => setPending(null)}
        onUndo={() => undefined}
        pendingProposal={pending}
        templateId={TEMPLATE_ID}
      />
    )
  }

  const container = document.createElement("div")
  document.body.append(container)
  root = mount(container)
  act(() => root?.render(<Editor />))
  await settle()
  expect(buttonNamed("Apply 3 changes").disabled).toBe(false)
  // While the card is open it is the one list of changes.
  expect(document.body.textContent).not.toContain("Proposed change set")

  // Dropping the vehicle drops the van's size, which needs it.
  act(() => buttonNamed("Drop this change", 0).click())
  await settle()

  const rebuild = fetchFlow.mock.calls.find(([url]) => url.endsWith("/rebuild")) as unknown as [string, { body: string }]
  expect(rebuild[0]).toBe("/api/templates/flow/rebuild")
  expect(JSON.parse(rebuild[1].body).operations).toEqual([proposed.wireOperations[2]])
  expect(card()).toContain("1 of 3 changes will apply.")
  expect(card()).toContain('Dropped with "Asked the vehicle"')
  expect(buttonNamed("Apply 1 change").disabled).toBe(false)

  // Keeping it keeps both again, the batch as Flow proposed it.
  act(() => buttonNamed("Keep").click())
  await settle()
  expect(card()).not.toContain("Dropped with")
  expect(buttonNamed("Apply 3 changes").disabled).toBe(false)
  expect(fetchFlow).toHaveBeenCalledTimes(2)

  act(() => buttonNamed("Drop this change", 0).click())
  await settle()
  act(() => buttonNamed("Apply 1 change").click())
  expect(onApplyProposal).toHaveBeenCalledWith(rebuilt, "m-2")
  await settle()
  expect(document.body.textContent).toContain("Proposed change set")
})
