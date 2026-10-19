import { describe, expect, it, vi } from "vitest"

import type { AiProvider } from "@/services/ai/contracts"
import { TemplateFlowServiceError } from "@/services/template-flow-service"
import { executeWorkspaceFlow, type WorkspaceFlowDeps } from "@/services/workspace-flow-service"
import type { OrganizationPermissionSubject } from "@/lib/permissions"
import type { Task } from "@/types/task"

const ME = "20000000-0000-4000-8000-000000000001"
const ORG = "10000000-0000-4000-8000-000000000001"
const NOW = new Date("2026-09-23T12:00:00.000Z")

describe("workspace Flow", () => {
  it("answers from the member's own tasks, whatever the model claims", async () => {
    const listTasks = vi.fn(async () => [
      task("yesterday", "2026-09-22T09:00:00.000Z"),
      task("tomorrow", "2026-09-24T09:00:00.000Z"),
      task("last week", "2026-09-16T09:00:00.000Z"),
    ])

    const answer = await executeWorkspaceFlow(
      input("what's overdue for me?"),
      deps("staff", { action: "find", mine: true, reply: "You have 42 overdue tasks!", subject: "tasks", filter: "overdue" }, { listTasks })
    )

    expect(answer).toEqual({
      items: [
        expect.objectContaining({ href: "/tasks/last%20week", title: "last week" }),
        expect.objectContaining({ href: "/tasks/yesterday", title: "yesterday" }),
      ],
      kind: "found",
      moreHref: "/tasks",
      reply: "2 overdue tasks",
    })
    expect(listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ME, assignedTo: ME, organizationId: ORG })
    )
  })

  it("answers the everyday asks at once, without waiting on the model", async () => {
    const generateStructured = vi.fn()
    const listTasks = vi.fn(async () => [task("40000000-0000-4000-8000-000000000001", "2026-09-20T09:00:00.000Z")])
    const listSubmissions = vi.fn(async () => [])
    const quick = deps("staff", {}, { getAiRuntime: () => ({ model: { model: "test-model", provider: "test" }, provider: { generateStructured, id: "test" } }), listSubmissions, listTasks })

    await expect(executeWorkspaceFlow(input("What's overdue?"), quick)).resolves.toMatchObject({ kind: "found", reply: "1 overdue task" })
    await expect(executeWorkspaceFlow(input("what needs my review"), quick)).resolves.toMatchObject({ kind: "found", moreHref: "/submissions?status=submitted" })
    await expect(executeWorkspaceFlow(input("my tasks"), quick)).resolves.toMatchObject({ kind: "found" })
    expect(listTasks).toHaveBeenLastCalledWith(expect.objectContaining({ assignedTo: ME }))
    // A phone's curly apostrophe is the same ask.
    await expect(executeWorkspaceFlow(input("What’s overdue?"), quick)).resolves.toMatchObject({ kind: "found" })
    expect(generateStructured).not.toHaveBeenCalled()

    // A role that can't see the list hears so, as it would from the model's plan.
    const refused = deps("external_reviewer", {}, {
      getAiRuntime: () => ({ model: { model: "test-model", provider: "test" }, provider: { generateStructured, id: "test" } }),
      listTasks: async () => {
        throw new TemplateFlowServiceError("Forbidden.", 403)
      },
    })
    await expect(executeWorkspaceFlow(input("What's overdue?"), refused)).resolves.toEqual({ kind: "reply", reply: "Your role can't see tasks." })

    // Anything else, or the same words about something mentioned, still goes to the model.
    await executeWorkspaceFlow(input("what's overdue for the Smith account?"), quick).catch(() => undefined)
    expect(generateStructured).toHaveBeenCalledTimes(1)
  })

  it("says what it is doing: reading the message, then looking through the member's work", async () => {
    const stages: string[] = []
    const listTasks = vi.fn(async () => [])

    await executeWorkspaceFlow(input("tasks about the van"), deps("staff", { action: "find", reply: "", subject: "tasks" }, { listTasks, onStage: (stage) => stages.push(stage) }))
    await executeWorkspaceFlow(input("hello"), deps("staff", { action: "none", reply: "Hi." }, { onStage: (stage) => stages.push(stage) }))

    expect(stages).toEqual(["thinking", "finding", "thinking"])
  })

  it("plans with what the member mentioned in view", async () => {
    const generateStructured = vi.fn(deps("staff", { action: "none", reply: "It's due on the 20th." }).getAiRuntime!().provider.generateStructured)
    const mention = { id: "30000000-0000-4000-8000-000000000009", kind: "tasks" }
    const resolveMentions = vi.fn(async () => [{ details: "Task, open, due 2026-10-20", kind: "tasks" as const, name: "Renew permits" }])

    await executeWorkspaceFlow(
      { ...input("when is this due?"), mentions: [mention] },
      deps("staff", {}, { getAiRuntime: () => ({ model: { model: "test-model", provider: "test" }, provider: { generateStructured, id: "test" } }), resolveMentions })
    )

    expect(resolveMentions).toHaveBeenCalledWith({ actorUserId: ME, mentions: [mention], organizationId: ORG })
    expect(generateStructured.mock.calls[0]![0].input).toContain("Mentioned: Renew permits (tasks): Task, open, due 2026-10-20")
  })

  it("starts only what the member may create", async () => {
    const plan = { action: "create", reply: "Starting an intake form.", target: "template", title: "Client intake" }

    await expect(executeWorkspaceFlow(input("make an intake form"), deps("staff", plan))).resolves.toEqual({
      kind: "create",
      reply: "Starting an intake form.",
      target: "template",
      title: "Client intake",
    })
    await expect(executeWorkspaceFlow(input("make an intake form"), deps("external_reviewer", plan))).resolves.toEqual({
      kind: "reply",
      reply: "Your role can't start templates or documents. Ask a manager.",
    })
  })

  it("starts a template that carries an attached form, and stops at a form the member can't read", async () => {
    const SOURCE = "30000000-0000-4000-8000-000000000001"
    const plan = { action: "create", reply: "Recreating your form.", target: "document", title: "Pet intake" }
    const generateStructured = vi.fn(deps("staff", plan).getAiRuntime!().provider.generateStructured)
    const withSource = (requireSource: WorkspaceFlowDeps["requireSource"]): WorkspaceFlowDeps => ({
      ...deps("staff", plan),
      getAiRuntime: () => ({ model: { model: "test-model", provider: "test" }, provider: { generateStructured, id: "test" } }),
      requireSource,
    })

    await expect(
      executeWorkspaceFlow(
        { ...input("make this into a form"), sourceDocumentId: SOURCE },
        withSource(async () => undefined)
      )
    ).resolves.toEqual({ kind: "create", reply: "Recreating your form.", sourceDocumentId: SOURCE, target: "template", title: "Pet intake" })

    generateStructured.mockClear()
    await expect(
      executeWorkspaceFlow(
        { ...input("make this into a form"), sourceDocumentId: SOURCE },
        withSource(async () => {
          throw new TemplateFlowServiceError("Document was not found.", 404)
        })
      )
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(generateStructured).not.toHaveBeenCalled()
  })

  it("says plainly what an attached form needs, rather than starting a document or dropping the file", async () => {
    const withFile = { ...input("make this into a form"), sourceDocumentId: "30000000-0000-4000-8000-000000000001" }
    const documentsOnly = { customPermissions: ["documents:view", "documents:create"] as const, role: "staff" as const }
    const create = { action: "create", reply: "Recreating your form.", target: "document", title: "Pet intake" }

    await expect(
      executeWorkspaceFlow(withFile, { ...deps(documentsOnly, create), requireSource: async () => undefined })
    ).resolves.toEqual({ kind: "reply", reply: "Flow recreates an attached form as a template, and your role can't start templates. Ask a manager." })

    // Asked something else, the file is not silently left out.
    await expect(
      executeWorkspaceFlow(withFile, { ...deps("staff", { action: "find", reply: "Here they are.", subject: "templates" }), requireSource: async () => undefined })
    ).resolves.toEqual({ kind: "reply", reply: "Flow recreates an attached form as a new template. Ask it to make one, or remove the file to ask something else." })
  })
})

function input(message: string): Parameters<typeof executeWorkspaceFlow>[0] {
  return { actorUserId: ME, history: [], message, organizationId: ORG }
}

function deps(
  role: OrganizationPermissionSubject,
  plan: Record<string, unknown>,
  overrides: Partial<WorkspaceFlowDeps> = {}
): WorkspaceFlowDeps {
  const provider: AiProvider = {
    generateStructured: async (request) => ({
      model: request.model,
      text: JSON.stringify({ filter: "any", mine: false, query: "", subject: "none", target: "none", title: "", ...plan }),
      traceId: request.traceId,
      upstreamCalls: 1,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    }),
    id: "test",
  }

  return {
    getAiRuntime: () => ({ model: { model: "test-model", provider: "test" }, provider }),
    loadMembership: async () => role,
    now: () => NOW,
    ...overrides,
  }
}

function task(id: string, dueAt: string): Task {
  return {
    assignedAt: "2026-09-01T09:00:00.000Z",
    assignedBy: ME,
    assignedTo: ME,
    completedAt: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    createdBy: ME,
    description: null,
    dueAt,
    id,
    organizationId: ORG,
    revision: 1,
    status: "open",
    submissionId: null,
    title: id,
    updatedAt: "2026-09-01T09:00:00.000Z",
    updatedBy: ME,
  } as Task
}
