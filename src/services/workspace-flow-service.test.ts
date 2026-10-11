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
