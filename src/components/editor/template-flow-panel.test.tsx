// @vitest-environment jsdom

import { act, type ReactElement, useState } from "react"
import type { Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"

import { describeFill, TemplateFlowPanel } from "@/components/editor/template-flow-panel"
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
  localStorage.clear()
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
  // Each rebuild waits until the test ends it, as a well or badly answered request.
  const rebuilds: Array<(ok: boolean) => void> = []
  const fetchFlow = vi.fn(async (url: string) =>
    url.endsWith("/rebuild")
      ? new Promise((resolve) => rebuilds.push((ok) => resolve({ ok, json: async () => (ok ? { proposal: rebuilt } : { error: "Flow is busy." }) })))
      : {
          ok: true,
          json: async () => ({ proposal: proposed, messages: [message("user", "m-1"), message("assistant", "m-2")], needsConfirmation: false, persistenceWarning: null }),
        }
  )
  const onApplyProposal = vi.fn()
  let held: TemplateFlowProposal | null = null
  vi.stubGlobal("fetch", fetchFlow)

  async function rebuildEnds(ok: boolean): Promise<void> {
    await act(async () => rebuilds.shift()?.(ok))
    await settle()
  }

  // The editor owns the proposal on show, as both editors do.
  function Editor(): ReactElement {
    const [pending, setPending] = useState<TemplateFlowProposal | null>(null)
    held = pending

    return (
      <TemplateFlowPanel
        autoSend={{ instruction: "Ask about the vehicle." }}
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

  // Dropping the vehicle drops the van's size, which needs it. Until the
  // batch is rebuilt, what the editor holds applies nothing, so its own
  // Apply cannot take the dropped changes.
  act(() => buttonNamed("Drop this change", 0).click())
  expect(held!.operations).toEqual([])
  expect(buttonNamed("Apply 1 change").disabled).toBe(true)
  await rebuildEnds(true)

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

  // A rebuild that fails puts back what the editor held before the drop.
  const before = held
  act(() => buttonNamed("Drop this change", 0).click())
  await rebuildEnds(false)
  expect(held).toBe(before)
  expect(buttonNamed("Apply 3 changes").disabled).toBe(false)

  act(() => buttonNamed("Drop this change", 0).click())
  await rebuildEnds(true)
  act(() => buttonNamed("Apply 1 change").click())
  expect(onApplyProposal).toHaveBeenCalledWith(rebuilt, "m-2")
  await settle()
  expect(document.body.textContent).toContain("Proposed change set")
})

it("sends a message, even one carried in on open, to the model this person picked last", async () => {
  localStorage.setItem("bizflow.flow-model", "gemini-3.5-flash")
  const fetchFlow = vi.fn(async () => ({ ok: false, json: async () => ({ error: "Stop here." }) }))
  vi.stubGlobal("fetch", fetchFlow)

  const container = document.createElement("div")
  document.body.append(container)
  root = mount(container)
  act(() =>
    root?.render(
      <TemplateFlowPanel
        autoSend={{ instruction: "Ask about the vehicle." }}
        canUndo={false}
        draft={draft}
        initialMessages={[]}
        lastAppliedMessageId={null}
        onApplyProposal={() => undefined}
        onProposalReceived={() => undefined}
        onProposalStale={() => undefined}
        onRejectProposal={() => undefined}
        onUndo={() => undefined}
        pendingProposal={null}
        templateId={TEMPLATE_ID}
      />
    )
  )
  await settle()

  const [, init] = fetchFlow.mock.calls[0] as unknown as [string, { body: string }]
  expect(JSON.parse(init.body).model).toBe("gemini-3.5-flash")
  expect(buttonNamed("Flow model: Gemini 3.5 Flash")).toBeTruthy()
})

it("keeps a proposal rejected while it rebuilds rejected", async () => {
  const proposed = proposal("Proposed", [item(0, "add_block", "Asked the vehicle"), item(1, "remove_block", "Removed the introduction")])
  const message = (role: "user" | "assistant", id: string) => ({
    id, role, content: "Done.", authorName: null, operations: role === "assistant" ? proposed.operations : [], changedBlockIds: [], receiptStatus: null, createdAt: "2026-10-06T09:00:00.000Z",
  })
  let endRebuild: () => void = () => undefined
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    url.endsWith("/rebuild")
      ? new Promise((resolve) => { endRebuild = () => resolve({ ok: true, json: async () => ({ proposal: proposal("Rebuilt", [proposed.operations[1]!]) }) }) })
      : { ok: true, json: async () => ({ proposal: proposed, messages: [message("user", "m-1"), message("assistant", "m-2")], needsConfirmation: false, persistenceWarning: null }) }
  ))
  let held: TemplateFlowProposal | null = null

  function Editor(): ReactElement {
    const [pending, setPending] = useState<TemplateFlowProposal | null>(null)
    held = pending

    return (
      <TemplateFlowPanel
        autoSend={{ instruction: "Ask about the vehicle." }}
        canUndo={false}
        draft={draft}
        initialMessages={[]}
        lastAppliedMessageId={null}
        onApplyProposal={() => setPending(null)}
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
  act(() => buttonNamed("Drop this change", 0).click())
  act(() => buttonNamed("Reject all").click())
  expect(held).toBeNull()

  await act(async () => endRebuild())
  await settle()
  expect(held).toBeNull()
})

it("says how many answers from the form were filled in, and how many didn't fit", () => {
  expect(describeFill(5, 0)).toBe("Filled 5 answers.")
  expect(describeFill(1, 2)).toBe("Filled 1 answer. 2 didn't fit the form.")
  expect(describeFill(0, 3)).toBe("No answers fit the form.")
})

// A form recreated over several turns: each turn answers the fields it made.
function importEditor(turns: ReadonlyArray<Readonly<{ answers: Record<string, unknown>; operations: TemplateFlowLedgerItem[] }>>) {
  const bodies: Array<Record<string, unknown>> = []
  const fillAction = vi.fn(async (answers: Record<string, unknown>) => ({ answers, dropped: 0, kept: Object.keys(answers).length, ok: true as const }))
  let turn = 0
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
    if (url.endsWith("/rebuild")) {
      return { ok: true, json: async () => ({ proposal: proposal("Rebuilt", [item(0, "add_block", "Kept")]) }) }
    }

    bodies.push(JSON.parse(init.body))
    const at = turn++
    const { answers, operations } = turns[at] ?? { answers: {}, operations: [item(0, "set_title", "Retitled")] }
    const message = (role: "user" | "assistant", id: string) => ({
      id, role, content: "Done.", authorName: null, operations: role === "assistant" ? operations : [], changedBlockIds: [], receiptStatus: null, createdAt: "2026-10-06T09:00:00.000Z",
    })

    return {
      ok: true,
      json: async () => ({
        proposal: { ...proposal(`Turn ${at}`, operations), sourceAnswers: answers },
        messages: [message("user", `u-${at}`), message("assistant", `a-${at}`)],
        needsConfirmation: false,
        persistenceWarning: null,
      }),
    }
  }))

  function Editor(): ReactElement {
    const [pending, setPending] = useState<TemplateFlowProposal | null>(null)
    const [applied, setApplied] = useState<string | null>(null)

    return (
      <TemplateFlowPanel
        autoSend={{ instruction: "Recreate this form", source: { id: "40000000-0000-4000-8000-000000000001", name: "Intake.pdf" } }}
        canUndo={applied !== null}
        draft={draft}
        fill={{ action: fillAction, here: true }}
        initialMessages={[]}
        lastAppliedMessageId={applied}
        onApplyProposal={(_, messageId) => {
          setPending(null)
          setApplied(messageId)
        }}
        onProposalReceived={setPending}
        onProposalStale={setPending}
        onRejectProposal={() => setPending(null)}
        onUndo={() => setApplied(null)}
        organizationId="10000000-0000-4000-8000-000000000001"
        pendingProposal={pending}
        templateId={TEMPLATE_ID}
      />
    )
  }

  const container = document.createElement("div")
  document.body.append(container)
  root = mount(container)
  act(() => root?.render(<Editor />))

  return { bodies, fillAction }
}

const fillButtons = (): HTMLButtonElement[] => [...document.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "Fill in answers")

it("fills every applied turn's answers from the form at once, then lets the form go", async () => {
  const { bodies, fillAction } = importEditor([
    { answers: { owner_name: "Ada" }, operations: [item(0, "add_block", "Asked the owner")] },
    { answers: { pet_name: "Biscuit" }, operations: [item(0, "add_block", "Asked the pet")] },
    { answers: { vet: "Dr. Who" }, operations: [item(0, "add_block", "Asked the vet")] },
  ])

  await settle()
  for (const at of [1, 2, 3]) {
    act(() => buttonNamed("Apply 1 change").click())
    await settle()

    if (at < 3) {
      act(() => buttonNamed("Send message to Flow").click())
      await settle()
    }
  }

  // Offered once, on the latest change set, with all three turns' answers.
  expect(fillButtons()).toHaveLength(1)
  await act(async () => fillButtons()[0]!.click())
  await settle()
  expect(fillAction).toHaveBeenCalledTimes(1)
  expect(fillAction).toHaveBeenCalledWith({ owner_name: "Ada", pet_name: "Biscuit", vet: "Dr. Who" })
  expect(fillButtons()).toHaveLength(0)

  // Filled, the form is done with: the next request goes without it.
  expect(bodies.map((body) => body.sourceDocumentId)).toEqual(Array(3).fill("40000000-0000-4000-8000-000000000001"))
  expect(document.body.textContent).not.toContain("Intake.pdf")
})

it("lets answers go when a change is dropped, since the fields they were keyed for were made again", async () => {
  const { fillAction } = importEditor([
    { answers: { name: "Ada", name_2: "Biscuit" }, operations: [item(0, "add_block", "Asked the owner"), item(1, "add_block", "Asked the pet")] },
  ])

  await settle()
  act(() => buttonNamed("Drop this change", 0).click())
  await settle()
  act(() => buttonNamed("Apply 1 change").click())
  await settle()

  expect(fillButtons()).toHaveLength(0)
  expect(fillAction).not.toHaveBeenCalled()
})

it("names a teammate once at the start of each run of their messages, starting a new run after a break, and voices Flow's turns as Flow", () => {
  const said = (id: string, role: "user" | "assistant", authorName: string | null, content: string, createdAt = "2026-10-18T09:00:00.000Z") => ({
    id, role, content, authorName, operations: [], changedBlockIds: [], receiptStatus: null, createdAt,
  })

  act(() =>
    mount().render(
      <TemplateFlowPanel
        canUndo={false}
        draft={draft}
        initialMessages={[
          said("m-1", "user", "Ana Lopez", "Draft a parking permit."),
          said("m-2", "user", "Ana Lopez", "For staff only."),
          said("m-3", "assistant", null, "Here's a first draft."),
          said("m-4", "assistant", null, "Want a second vehicle?"),
          said("m-5", "user", "Ben Okafor", "Yes, add one."),
          // Back after lunch: a new run, so the later time shows.
          said("m-6", "user", "Ben Okafor", "And a visitor badge.", "2026-10-18T13:00:00.000Z"),
        ]}
        lastAppliedMessageId={null}
        onApplyProposal={() => undefined}
        onUndo={() => undefined}
        pendingProposal={null}
        templateId={TEMPLATE_ID}
      />
    )
  )

  const text = document.body.textContent ?? ""
  expect(text.split("Ana Lopez")).toHaveLength(2)
  expect(text.split("Ben Okafor")).toHaveLength(3)
  for (const words of ["Draft a parking permit.", "For staff only.", "Here's a first draft.", "Want a second vehicle?", "Yes, add one."]) {
    expect(text).toContain(words)
  }
  // Flow's mark stands in for its name on screen; a screen reader still hears who spoke.
  expect([...document.querySelectorAll("li")].filter((entry) => entry.textContent?.startsWith("Flow")).map((entry) => entry.textContent)).toEqual([
    "FlowHere's a first draft.",
    "FlowWant a second vehicle?",
  ])
})
