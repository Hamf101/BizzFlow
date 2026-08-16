import type { TemplateFlowOperationType } from "@/types/template-flow"

export type FlowJsonSchema = Record<string, unknown>

export const TEMPLATE_FLOW_OPERATION_TYPES = [
  "set_title",
  "set_description",
  "set_branding",
  "add_block",
  "update_block",
  "update_image",
  "move_block",
  "remove_block",
] as const satisfies readonly TemplateFlowOperationType[]

/**
 * Creates the compact structured-output schema for one Flow turn.
 *
 * The stable response envelope keeps operation payloads as JSON strings. Flow
 * parses those strings and validates them against canonical operation and
 * template schemas before applying any document edit.
 *
 * @returns Provider-neutral JSON Schema for the Flow response envelope.
 */
export function createTemplateFlowResponseSchema(): FlowJsonSchema {
  return createClosedObjectSchema({
    assistantMessage: {
      type: "string",
      description:
        "Concise response explaining the result or asking one necessary question.",
    },
    needsConfirmation: {
      type: "boolean",
      description:
        "True only when a destructive or ambiguous request needs clarification before editing.",
    },
    confirmationQuestion: {
      type: "string",
      description:
        "Clarification question when confirmation is needed; otherwise an empty string.",
    },
    operations: {
      type: "array",
      maxItems: 24,
      items: createClosedObjectSchema({
        type: {
          type: "string",
          enum: TEMPLATE_FLOW_OPERATION_TYPES,
        },
        summary: {
          type: "string",
          description:
            "Short past-tense ledger description of the completed action.",
        },
        payloadJson: {
          type: "string",
          description:
            "A compact JSON-encoded object matching the selected operation's payload contract.",
        },
      }),
    },
  })
}

function createClosedObjectSchema(
  properties: Record<string, FlowJsonSchema>
): FlowJsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  }
}
