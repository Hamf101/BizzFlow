import { describe, expect, it } from "vitest"

import {
  createTemplateFlowResponseSchema,
  TEMPLATE_FLOW_OPERATION_TYPES,
} from "@/services/template-ai/flow-response-schema"

type JsonSchemaNode = {
  type?: string | string[]
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  additionalProperties?: boolean
  anyOf?: JsonSchemaNode[]
  items?: JsonSchemaNode | JsonSchemaNode[]
  enum?: unknown[]
}

describe("template Flow response schema", () => {
  it("uses a compact closed response envelope", () => {
    const rootSchema = getRootSchema()

    expect(rootSchema.type).toBe("object")
    expect(rootSchema.additionalProperties).toBe(false)
    expect(rootSchema.required).toEqual([
      "assistantMessage",
      "needsConfirmation",
      "confirmationQuestion",
      "operations",
    ])
    expect(JSON.stringify(rootSchema).length).toBeLessThan(3_000)
    expect(JSON.stringify(rootSchema)).not.toContain('"anyOf"')
  })

  it("constrains operation names without nesting every payload variant", () => {
    const operationSchema = getOperationSchema()

    expect(operationSchema.type).toBe("object")
    expect(operationSchema.additionalProperties).toBe(false)
    expect(operationSchema.required).toEqual([
      "type",
      "summary",
      "payloadJson",
    ])
    expect(operationSchema.properties?.type?.enum).toEqual(
      TEMPLATE_FLOW_OPERATION_TYPES
    )
    expect(operationSchema.properties?.payloadJson?.type).toBe("string")
    expect(operationSchema.properties?.payload).toBeUndefined()
  })
})

function getRootSchema(): JsonSchemaNode {
  return createTemplateFlowResponseSchema() as JsonSchemaNode
}

function getOperationSchema(): JsonSchemaNode {
  const operationItems = getRootSchema().properties?.operations?.items

  if (!operationItems || Array.isArray(operationItems)) {
    throw new Error("Missing Flow operation item schema.")
  }

  return operationItems
}
