import { expect, it } from "vitest"

import { flowMentionsSchema } from "@/services/template-flow/contracts"
import { type FlowMentionDeps, resolveFlowMentions } from "@/services/template-flow/mentions"
import { ServiceError } from "@/services/service-error"
import { createBlankTemplateContent, parseTemplateContent } from "@/types/template"

const ACTOR = { actorUserId: "10000000-0000-4000-8000-000000000001", organizationId: "20000000-0000-4000-8000-000000000001" }
const id = (n: number): string => `75000000-0000-4000-8000-00000000000${n}`
const content = parseTemplateContent({
  ...createBlankTemplateContent(),
  sections: [],
  blocks: [
    { id: id(1), type: "heading", text: "Vehicle", level: 2, alignment: "left" },
    { id: id(2), type: "text_field", fieldKey: "registration", label: "Registration", required: true, helpText: null, placeholder: null, multiline: false },
  ],
})
const refused = (): never => {
  throw new ServiceError("Template was not found.", 404)
}

function deps(overrides: Partial<FlowMentionDeps> = {}): FlowMentionDeps {
  return {
    loadFile: async () => ({ description: "Signed in March", title: "Lease.pdf" }),
    loadPeople: async () => [{ email: "ana@example.com", id: id(5), name: "Ana Lopez", role: "Manager" }],
    loadSubmission: async () => ({ content, status: "in_review", title: "Permit, Okafor", values: { registration: "AB12 CDE" } }),
    loadTask: async () => ({ description: null, dueAt: "2026-10-20T09:00:00.000Z", status: "open", title: "Renew permits" }),
    loadTemplate: async () => ({ content, status: "published", title: "Staff parking permit" }),
    ...overrides,
  }
}

it("tells Flow what each mentioned item is, from what the member may open", async () => {
  const mentions = flowMentionsSchema.parse([
    { id: id(1), kind: "templates" },
    { id: id(2), kind: "submissions" },
    { id: id(3), kind: "tasks" },
    { id: id(4), kind: "files" },
    { id: id(5), kind: "people" },
  ])

  expect(await resolveFlowMentions({ ...ACTOR, mentions }, deps())).toEqual([
    { kind: "templates", name: "Staff parking permit", details: "Template, published. Holds: Vehicle; Registration (text_field)" },
    { kind: "submissions", name: "Permit, Okafor", details: "Submission, in_review. Answers: Registration: AB12 CDE" },
    { kind: "tasks", name: "Renew permits", details: "Task, open, due 2026-10-20" },
    { kind: "files", name: "Lease.pdf", details: "File. Signed in March" },
    { kind: "people", name: "Ana Lopez", details: "Person, Manager, ana@example.com" },
  ])
})

it("leaves out what the member can't open, saying nothing of it", async () => {
  const mentions = flowMentionsSchema.parse([
    { id: id(1), kind: "templates" },
    { id: id(9), kind: "people" },
  ])

  // A template they can't see, and a person who isn't in their workspace.
  expect(await resolveFlowMentions({ ...ACTOR, mentions }, deps({ loadTemplate: refused }))).toEqual([])
})

it("takes at most five mentions, each once, and only items it knows", () => {
  const once = { id: id(1), kind: "templates" }

  expect(flowMentionsSchema.parse([once, once])).toEqual([once])
  expect(flowMentionsSchema.safeParse(Array.from({ length: 6 }, (_, n) => ({ id: id(n), kind: "tasks" }))).success).toBe(false)
  // A flood is turned away before any of it is compared, in well under a second.
  const flood = Array.from({ length: 50_000 }, (_, n) => ({ id: `75000000-0000-4000-8000-${String(n).padStart(12, "0")}`, kind: "tasks" }))
  const started = performance.now()
  expect(flowMentionsSchema.safeParse(flood).success).toBe(false)
  expect(performance.now() - started).toBeLessThan(200)
  expect(flowMentionsSchema.safeParse([{ id: id(1), kind: "organizations" }]).success).toBe(false)
  expect(flowMentionsSchema.safeParse([{ id: "not-an-id", kind: "tasks" }]).success).toBe(false)
})
