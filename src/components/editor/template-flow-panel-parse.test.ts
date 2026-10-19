import { describe, expect, it } from "vitest"

import { parseFlowProposal, parseFlowResult } from "@/components/editor/template-flow-panel"
import { createBlankTemplateContent } from "@/types/template"

type Json = Record<string, unknown>

const ledger = (): Json => ({ id: "i", type: "add_block", summary: "s", target: "t", affectedBlockIds: ["b"], dependsOn: [0] })
const message = (role: string): Json => ({ id: `m-${role}`, role, content: "c", authorUserId: null, authorName: null, operations: [ledger()], changedBlockIds: ["b"], receiptStatus: null, createdAt: "2026-10-06T09:00:00.000Z" })
const issue = (): Json => ({ code: "c", severity: "warning", message: "m", affectedBlockIds: ["b"] })
const proposal = (): Json => ({
  id: "p",
  status: "pending",
  baseDraftFingerprint: "f",
  candidateDraft: { title: "T", description: "", content: createBlankTemplateContent() },
  operations: [ledger()],
  wireOperations: [{ type: "add_block", summary: "s", payload: { a: 1 } }],
  changedBlockIds: ["b"],
  qualityIssues: [issue()],
})
const result = (): Json => ({ proposal: proposal(), messages: [message("user"), message("assistant")], needsConfirmation: false, persistenceWarning: null })

// Each case changes a valid payload, then says what reading it gives: the
// payload as read, or null when it is refused.
const resultCases: Array<[string, (r: Json) => unknown, (r: Json) => unknown]> = [
  ["valid", (r) => r, (r) => r],
  ["extra key dropped", (r) => ({ ...r, x: 1 }), (r) => r],
  ["warning kept", (r) => ({ ...r, persistenceWarning: "w" }), (r) => ({ ...r, persistenceWarning: "w" })],
  ["warning not a string", (r) => ({ ...r, persistenceWarning: 42 }), (r) => r],
  ["warning missing", (r) => without(r, "persistenceWarning"), (r) => r],
  ["no proposal", (r) => ({ ...r, proposal: null }), (r) => ({ ...r, proposal: null })],
  ["proposal missing", (r) => without(r, "proposal"), () => null],
  ["proposal an array", (r) => ({ ...r, proposal: [] }), () => null],
  ["proposal a string", (r) => ({ ...r, proposal: "x" }), () => null],
  ["proposal invalid", (r) => ({ ...r, proposal: { ...proposal(), status: "done" } }), () => null],
  ["confirmation missing", (r) => without(r, "needsConfirmation"), () => null],
  ["confirmation a string", (r) => ({ ...r, needsConfirmation: "true" }), () => null],
  ["one message", (r) => ({ ...r, messages: [message("user")] }), () => null],
  ["three messages", (r) => ({ ...r, messages: [message("user"), message("assistant"), message("user")] }), () => null],
  ["messages not a list", (r) => ({ ...r, messages: {} }), () => null],
  ["payload null", () => null, () => null],
  ["payload a list", () => [], () => null],
  ["payload a string", () => "x", () => null],
  ["author named", (r) => withMessage(r, { authorName: "Ada" }), (r) => withMessage(r, { authorName: "Ada" })],
  ["author id from an older server missing", (r) => withMessage(r, { authorUserId: undefined }), (r) => r],
  ["author missing", (r) => withMessage(r, { authorName: undefined }), () => null],
  ["author a number", (r) => withMessage(r, { authorName: 1 }), () => null],
  ["receipt proposed", (r) => withMessage(r, { receiptStatus: "proposed" }), (r) => withMessage(r, { receiptStatus: "proposed" })],
  ["receipt missing", (r) => withMessage(r, { receiptStatus: undefined }), () => null],
  ["receipt unknown", (r) => withMessage(r, { receiptStatus: "applied" }), () => null],
  ["role unknown", (r) => withMessage(r, { role: "system" }), () => null],
  ["id missing", (r) => withMessage(r, { id: undefined }), () => null],
  ["created a number", (r) => withMessage(r, { createdAt: 1 }), () => null],
  ["message ids filtered", (r) => withMessage(r, { changedBlockIds: [1, "b", null] }), (r) => r],
  ["message ids not a list", (r) => withMessage(r, { changedBlockIds: "b" }), () => null],
  ["message extra key dropped", (r) => withMessage(r, { x: 1 }), (r) => r],
  ["message a list", (r) => ({ ...r, messages: [[], message("assistant")] }), () => null],
  ["operation unknown type", (r) => withMessage(r, { operations: [{ ...ledger(), type: "nope" }] }), () => null],
  ["operation type missing", (r) => withMessage(r, { operations: [{ ...ledger(), type: undefined }] }), () => null],
  ["operation a list", (r) => withMessage(r, { operations: [[]] }), () => null],
  ["operation target missing", (r) => withMessage(r, { operations: [{ ...ledger(), target: undefined }] }), () => null],
  ["operation ids not a list", (r) => withMessage(r, { operations: [{ ...ledger(), affectedBlockIds: "b" }] }), () => null],
  ["operation ids filtered", (r) => withMessage(r, { operations: [{ ...ledger(), affectedBlockIds: [1, "b"] }] }), (r) => r],
  ["depends missing", (r) => withMessage(r, { operations: [{ ...ledger(), dependsOn: undefined }] }), (r) => withMessage(r, { operations: [{ ...ledger(), dependsOn: [] }] })],
  ["depends not a list", (r) => withMessage(r, { operations: [{ ...ledger(), dependsOn: "0" }] }), (r) => withMessage(r, { operations: [{ ...ledger(), dependsOn: [] }] })],
  ["depends filtered", (r) => withMessage(r, { operations: [{ ...ledger(), dependsOn: [0, 1.5, "2", -1, null] }] }), (r) => withMessage(r, { operations: [{ ...ledger(), dependsOn: [0, -1] }] })],
  ["operation extra key dropped", (r) => withMessage(r, { operations: [{ ...ledger(), x: 1 }] }), (r) => r],
]

const proposalCases: Array<[string, (p: Json) => unknown, (p: Json) => unknown]> = [
  ["valid", (p) => p, (p) => p],
  ["stale", (p) => ({ ...p, status: "stale" }), (p) => ({ ...p, status: "stale" })],
  ["status unknown", (p) => ({ ...p, status: "applied" }), () => null],
  ["fingerprint missing", (p) => without(p, "baseDraftFingerprint"), () => null],
  ["extra key dropped", (p) => ({ ...p, x: 1 }), (p) => p],
  ["draft a list", (p) => ({ ...p, candidateDraft: [] }), () => null],
  ["draft title missing", (p) => withDraft(p, { title: undefined }), () => null],
  ["draft description missing", (p) => withDraft(p, { description: undefined }), () => null],
  ["draft content invalid", (p) => withDraft(p, { content: { schemaVersion: 9 } }), () => null],
  ["draft extra key dropped", (p) => withDraft(p, { x: 1 }), (p) => p],
  ["operation invalid", (p) => ({ ...p, operations: [{ ...ledger(), type: "nope" }] }), () => null],
  ["operations not a list", (p) => ({ ...p, operations: {} }), () => null],
  ["fewer wire operations", (p) => ({ ...p, wireOperations: [] }), () => null],
  ["wire operation a string", (p) => ({ ...p, wireOperations: ["x"] }), () => null],
  ["wire operation a list", (p) => ({ ...p, wireOperations: [[]] }), () => null],
  ["wire operation null", (p) => ({ ...p, wireOperations: [null] }), () => null],
  ["wire operation kept whole", (p) => ({ ...p, wireOperations: [{ anything: true }] }), (p) => ({ ...p, wireOperations: [{ anything: true }] })],
  ["changed ids not strings", (p) => ({ ...p, changedBlockIds: ["b", 1] }), () => null],
  ["changed ids not a list", (p) => ({ ...p, changedBlockIds: "b" }), () => null],
  ["issues not a list", (p) => ({ ...p, qualityIssues: null }), () => null],
  ["issue severity unknown", (p) => ({ ...p, qualityIssues: [{ ...issue(), severity: "info" }] }), () => null],
  ["issue ids not strings", (p) => ({ ...p, qualityIssues: [{ ...issue(), affectedBlockIds: [1] }] }), () => null],
  ["issue code missing", (p) => ({ ...p, qualityIssues: [{ ...issue(), code: undefined }] }), () => null],
  ["issue extra key dropped", (p) => ({ ...p, qualityIssues: [{ ...issue(), x: 1 }] }), (p) => p],
  ["not a record", () => "x", () => null],
]

function without(value: Json, key: string): Json {
  return { ...value, [key]: undefined }
}

function withMessage(r: Json, change: Json): Json {
  const [first, second] = r.messages as Json[]
  return { ...r, messages: [first, { ...second, ...change }] }
}

function withDraft(p: Json, change: Json): Json {
  return { ...p, candidateDraft: { ...(p.candidateDraft as Json), ...change } }
}

function read(payload: unknown): unknown {
  try {
    return parseFlowResult(payload)
  } catch (error) {
    expect((error as Error).message).toBe("Flow returned an invalid response.")
    return null
  }
}

function strip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

describe("reading Flow's answer", () => {
  it.each(resultCases)("%s", (_name, change, outcome) => {
    expect(strip(read(strip(change(result()))))).toEqual(strip(outcome(result())))
  })

  it.each(proposalCases)("proposal: %s", (_name, change, outcome) => {
    expect(strip(parseFlowProposal(strip(change(proposal()))))).toEqual(strip(outcome(proposal())))
  })
})
