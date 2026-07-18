import { describe, expect, it, vi } from "vitest"

import {
  suggestTemplateBlocks,
  type TemplateAiServiceDeps,
} from "@/services/template-ai-service"
import {
  createBlankTemplateContent,
  type TemplateContent,
} from "@/types/template"

const EXISTING_BLOCK_ID = "00000000-0000-4000-8000-000000000001"
const PROPOSAL_BLOCK_ID = "00000000-0000-4000-8000-000000000002"

describe("template AI service", () => {
  it("requests strict private routing and returns canonical proposal blocks", async () => {
    const content = createContentWithPrivateImageAndExistingField()
    const fetchImpl = vi.fn<typeof fetch>(
      async (): Promise<Response> => jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                proposals: [
                  {
                    type: "text_field",
                    fieldKey: "client_name",
                    label: "Client legal name",
                    required: true,
                    helpText: "Use the registered legal name.",
                    placeholder: "Acme LLC",
                    multiline: false,
                  },
                ],
              }),
            },
          },
        ],
      })
    )
    const authorizeTemplateManagement = vi.fn(async (): Promise<void> => {})

    const proposals = await suggestTemplateBlocks(
      createSuggestionInput(content),
      createDependencies({
        authorizeTemplateManagement,
        createId: (): string => PROPOSAL_BLOCK_ID,
        fetchImpl,
      })
    )

    expect(authorizeTemplateManagement).toHaveBeenCalledWith({
      actorUserId: "user-1",
      organizationId: "org-1",
    })
    expect(proposals).toEqual([
      {
        id: PROPOSAL_BLOCK_ID,
        type: "text_field",
        fieldKey: "client_name_2",
        label: "Client legal name",
        required: true,
        helpText: "Use the registered legal name.",
        placeholder: "Acme LLC",
        multiline: false,
      },
    ])

    const requestInit = fetchImpl.mock.calls[0]?.[1]
    const requestBody = JSON.parse(String(requestInit?.body)) as {
      messages: Array<{ role: string; content: string }>
      model: string
      provider: { data_collection: string; require_parameters: boolean }
      response_format: {
        json_schema: { strict: boolean; schema: Record<string, unknown> }
        type: string
      }
    }
    const userMessage = requestBody.messages.find(
      (message: { role: string }): boolean => message.role === "user"
    )

    expect(requestInit?.headers).toMatchObject({
      Authorization: "Bearer test-openrouter-key",
    })
    expect(requestBody.model).toBe("openai/gpt-5-mini")
    expect(requestBody.provider).toEqual({
      require_parameters: true,
      data_collection: "deny",
    })
    expect(requestBody.response_format.type).toBe("json_schema")
    expect(requestBody.response_format.json_schema.strict).toBe(true)
    expect(requestBody.response_format.json_schema.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
    })
    expect(userMessage?.content).not.toContain("aGVsbG8=")
    expect(userMessage?.content).toContain('"hasLogo":true')
    expect(userMessage?.content).toContain('"imageDataOmitted":true')
  })

  it("rejects provider output that violates the canonical proposal schema", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (): Promise<Response> => jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                proposals: [
                  {
                    type: "table",
                    headers: ["Item", "Amount"],
                    rows: [["Consulting"]],
                  },
                ],
              }),
            },
          },
        ],
      })
    )

    await expect(
      suggestTemplateBlocks(
        createSuggestionInput(createBlankTemplateContent()),
        createDependencies({ fetchImpl })
      )
    ).rejects.toMatchObject({
      statusCode: 502,
      message: "The AI provider returned suggestions that failed validation.",
    })
  })

  it("returns file upload proposals for internal submission templates", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (): Promise<Response> =>
        jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  proposals: [
                    {
                      type: "file_field",
                      fieldKey: "supporting_document",
                      label: "Supporting document",
                      required: true,
                      helpText: "Upload one supporting file.",
                    },
                  ],
                }),
              },
            },
          ],
        })
    )

    await expect(
      suggestTemplateBlocks(
        createSuggestionInput(createBlankTemplateContent()),
        createDependencies({
          createId: (): string => PROPOSAL_BLOCK_ID,
          fetchImpl,
        })
      )
    ).resolves.toEqual([
      {
        id: PROPOSAL_BLOCK_ID,
        type: "file_field",
        fieldKey: "supporting_document",
        label: "Supporting document",
        required: true,
        helpText: "Upload one supporting file.",
      },
    ])
  })

  it("maps abort failures to a bounded timeout response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (): Promise<Response> => {
      const error = new Error("request aborted")
      error.name = "AbortError"
      throw error
    })

    await expect(
      suggestTemplateBlocks(
        createSuggestionInput(createBlankTemplateContent()),
        createDependencies({ fetchImpl })
      )
    ).rejects.toMatchObject({
      statusCode: 504,
      message: "AI suggestions timed out. Try a shorter request.",
    })
  })

  it("validates requests before authorization or provider calls", async () => {
    const authorizeTemplateManagement = vi.fn(async (): Promise<void> => {})
    const fetchImpl = vi.fn()

    await expect(
      suggestTemplateBlocks(
        {
          ...createSuggestionInput(createBlankTemplateContent()),
          instruction: "no",
        },
        createDependencies({
          authorizeTemplateManagement,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        })
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(authorizeTemplateManagement).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

function createSuggestionInput(content: TemplateContent): {
  actorUserId: string
  organizationId: string
  draft: {
    title: string
    description: string
    content: TemplateContent
  }
  section: string
  instruction: string
} {
  return {
    actorUserId: "user-1",
    organizationId: "org-1",
    draft: {
      title: "Professional services agreement",
      description: "Agreement for a new client.",
      content,
    },
    section: "body",
    instruction: "Add a field for the client's legal name.",
  }
}

function createDependencies(
  overrides: Partial<TemplateAiServiceDeps> = {}
): TemplateAiServiceDeps {
  return {
    authorizeTemplateManagement: async (): Promise<void> => {},
    getConfig: () => ({
      OPENROUTER_API_KEY: "test-openrouter-key",
      OPENROUTER_MODEL: "openai/gpt-5-mini",
      OPENROUTER_TIMEOUT_MS: 1_000,
    }),
    ...overrides,
  }
}

function createContentWithPrivateImageAndExistingField(): TemplateContent {
  const content = createBlankTemplateContent()

  return {
    ...content,
    branding: {
      ...content.branding,
      logoDataUrl: "data:image/png;base64,aGVsbG8=",
    },
    sections: {
      ...content.sections,
      body: {
        blocks: [
          {
            id: EXISTING_BLOCK_ID,
            type: "image",
            dataUrl: "data:image/png;base64,aGVsbG8=",
            altText: "Organization logo",
            caption: null,
            alignment: "center",
            widthPercent: 50,
          },
          {
            id: "00000000-0000-4000-8000-000000000003",
            type: "text_field",
            fieldKey: "client_name",
            label: "Client name",
            required: true,
            helpText: null,
            placeholder: null,
            multiline: false,
          },
        ],
      },
    },
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}
