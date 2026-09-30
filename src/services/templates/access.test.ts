import { describe, expect, it } from "vitest"

import {
  getTemplateAccess,
  requireCanCreateTemplates,
  requireTemplateAccess,
  templateVisibility,
} from "./access"
import type { TemplateServiceClient } from "./contracts"

const ORG = "10000000-0000-4000-8000-000000000001"
const ACTOR = "20000000-0000-4000-8000-000000000001"
const TEMPLATE = "30000000-0000-4000-8000-000000000001"
const input = { actorUserId: ACTOR, organizationId: ORG, templateId: TEMPLATE }

function clientAnswering(answers: {
  member?: boolean
  editable?: string[]
  hidden?: string[]
  level?: "editor" | "user" | "viewer" | null
  permissions?: string[] | null
}): TemplateServiceClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: answers.member === false ? null : { role: "staff", role_definition: { permissions: answers.permissions ?? [] } },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
    rpc: async (name: string) => ({
      data:
        name === "get_template_access_level"
          ? (answers.level ?? null)
          : name === "hidden_template_ids"
            ? (answers.hidden ?? [])
            : (answers.editable ?? []),
      error: null,
    }),
  } as never
}

describe("what a member may do with one template", () => {
  it("passes on what the database answers", async () => {
    await expect(getTemplateAccess(clientAnswering({ level: "user" }), input)).resolves.toBe("user")
    await expect(getTemplateAccess(clientAnswering({ level: null }), input)).resolves.toBeNull()
  })

  it("says the template does not exist to someone who cannot open it", async () => {
    await expect(requireTemplateAccess(clientAnswering({ level: null }), input, "viewer", "No.")).rejects.toMatchObject({
      message: "Document template was not found.",
      statusCode: 404,
    })
  })

  it("refuses someone outside the workspace rather than saying whether it exists", async () => {
    await expect(requireTemplateAccess(clientAnswering({ level: null, member: false }), input, "viewer", "You cannot view document templates.")).rejects.toMatchObject({
      message: "You cannot view document templates.",
      statusCode: 403,
    })
  })

  it("refuses, with the reason, someone who can open it but not do this", async () => {
    await expect(requireTemplateAccess(clientAnswering({ level: "user" }), input, "editor", "You cannot edit this template.")).rejects.toMatchObject({
      message: "You cannot edit this template.",
      statusCode: 403,
    })
    await expect(requireTemplateAccess(clientAnswering({ level: "viewer" }), input, "user", "No.")).rejects.toMatchObject({ statusCode: 403 })
  })

  it("lets anyone at or above the level through, and says which they have", async () => {
    await expect(requireTemplateAccess(clientAnswering({ level: "editor" }), input, "user", "No.")).resolves.toBe("editor")
    await expect(requireTemplateAccess(clientAnswering({ level: "viewer" }), input, "viewer", "No.")).resolves.toBe("viewer")
  })
})

describe("who may make a template", () => {
  it("is anyone allowed to create, or to manage, templates", async () => {
    await expect(requireCanCreateTemplates(clientAnswering({ permissions: ["templates:create"] }), ORG, ACTOR)).resolves.toBeUndefined()
    await expect(requireCanCreateTemplates(clientAnswering({ permissions: ["templates:manage"] }), ORG, ACTOR)).resolves.toBeUndefined()
  })

  it("refuses everyone else", async () => {
    await expect(requireCanCreateTemplates(clientAnswering({ permissions: ["templates:view"] }), ORG, ACTOR)).rejects.toMatchObject({
      message: "You cannot create templates.",
      statusCode: 403,
    })
  })
})

describe("which templates a list leaves out or adds", () => {
  it("names the restricted ones the member cannot open, and the ones they may edit", async () => {
    await expect(templateVisibility(clientAnswering({ editable: ["e1"], hidden: ["h1", "h2"] }), ORG, ACTOR)).resolves.toEqual({
      editable: ["e1"],
      hidden: ["h1", "h2"],
    })
  })
})
