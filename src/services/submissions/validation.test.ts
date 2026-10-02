import { describe, expect, it } from "vitest"

import {
  normalizeSubmissionDraftAnswers,
  validateSubmissionForSubmit
} from "@/services/submissions/validation"
import { mergeAndNormalizeSubmissionAnswers } from "@/services/submissions/shared"
import type { Submission } from "@/types/submission"
import { parseTemplateContent, type TemplateContent } from "@/types/template"
import {
  createStructuredAnswerContent,
  STRUCTURED_ANSWERS
} from "@/types/template-answer.test-support"

const DRAWING_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAqklEQVR4nOXQyw2EMAwFwLTAbTug/wqztxUCIRYIjBMfIkX52H5Tps9cl6vWWjKtsgbIBvHbZIXYHGSD2L3IAnH4YHSIvx+OCnH6w2gQlz+OAnG7QO8QzQr1CtG8YG8QjxXuBeLxBtEhXmsUFeL1htEgmHwUCAYQBYIDaAgeXEPwwBqCB9UQPKCG4ME0BA+kIXgQDcEDaAg+uIbgA2sIPqiG4ANqCD6YhvgCi4+tg797B8QAAAAASUVORK5CYII="

const SNAPSHOT = createSubmissionSnapshot()
const CONDITIONAL_SNAPSHOT = createConditionalSubmissionSnapshot()

describe("submission answer validation", () => {
  it("normalizes every supported non-file answer in a draft", async () => {
    await expect(
      normalizeSubmissionDraftAnswers(SNAPSHOT, {
        vendor_name: "  Northstar Labs  ",
        effective_date: " 2026-07-18 ",
        acknowledged: true,
        risk_level: " Standard ",
        manager_initials: ` ${DRAWING_DATA_URL} `,
        manager_signature: DRAWING_DATA_URL
      })
    ).resolves.toEqual({
      vendor_name: "Northstar Labs",
      effective_date: "2026-07-18",
      acknowledged: true,
      risk_level: "Standard",
      manager_initials: DRAWING_DATA_URL,
      manager_signature: DRAWING_DATA_URL
    })
  })

  it("allows a draft to keep required answers incomplete", async () => {
    await expect(
      normalizeSubmissionDraftAnswers(SNAPSHOT, {
        vendor_name: "   ",
        acknowledged: false,
        manager_signature: ""
      })
    ).resolves.toEqual({
      vendor_name: "",
      acknowledged: false,
      manager_signature: ""
    })
  })

  it("keeps an Other detail only while its dropdown condition is active", async () => {
    await expect(
      normalizeSubmissionDraftAnswers(CONDITIONAL_SNAPSHOT, {
        category: " Other ",
        other_details: " Custom category "
      })
    ).resolves.toEqual({
      category: "Other",
      other_details: "Custom category"
    })

    await expect(
      normalizeSubmissionDraftAnswers(CONDITIONAL_SNAPSHOT, {
        category: "Standard",
        other_details: "Stale hidden value"
      })
    ).resolves.toEqual({ category: "Standard" })
  })

  it("uses stored controller answers when normalizing a dependent-only patch", async () => {
    await expect(
      normalizeSubmissionDraftAnswers(
        CONDITIONAL_SNAPSHOT,
        { other_details: " Updated detail " },
        { category: "Other", include_evidence: false }
      )
    ).resolves.toEqual({ other_details: "Updated detail" })

    await expect(
      normalizeSubmissionDraftAnswers(
        CONDITIONAL_SNAPSHOT,
        { other_details: "Hidden detail" },
        { category: "Standard", include_evidence: false }
      )
    ).resolves.toEqual({})
  })

  it("merges a dependent-only service patch with its stored controller", async () => {
    const submission = createConditionalSubmission()

    await expect(
      mergeAndNormalizeSubmissionAnswers(
        submission,
        { other_details: " Updated detail " },
        {}
      )
    ).resolves.toEqual({
      category: "Other",
      include_evidence: false,
      other_details: "Updated detail"
    })
  })

  it("does not resurrect a stale hidden value when a service patch reveals it", async () => {
    const submission = createConditionalSubmission()
    submission.values = {
      category: "Standard",
      include_evidence: false,
      other_details: "Legacy hidden detail"
    }

    await expect(
      mergeAndNormalizeSubmissionAnswers(
        submission,
        { category: "Other" },
        {}
      )
    ).resolves.toEqual({
      category: "Other",
      include_evidence: false
    })
  })

  it("prunes stale answers when a checkbox condition becomes false", async () => {
    await expect(
      normalizeSubmissionDraftAnswers(CONDITIONAL_SNAPSHOT, {
        category: "Standard",
        include_evidence: false,
        evidence_notes: "Stale notes"
      })
    ).resolves.toEqual({
      category: "Standard",
      include_evidence: false
    })
  })

  it.each([
    [null, "Submission answers must be a JSON object."],
    [[], "Submission answers must be a JSON object."],
    [{ unknown_field: "value" }, "unknown_field is not part"],
    [{ acknowledged: "yes" }, "Acknowledged must be checked or unchecked."],
    [{ effective_date: "2026-02-30" }, "Effective date must be a valid date."],
    [{ risk_level: "Extreme" }, "Risk level must use one of"],
    [
      { manager_signature: "data:image/png;base64,aGVsbG8=" },
      "drawn manager signature is invalid"
    ],
    [{ evidence: "evidence.pdf" }, "Evidence must be uploaded as a file."]
  ])("rejects an invalid draft answer object: %s", async (answers, message) => {
    await expect(
      normalizeSubmissionDraftAnswers(SNAPSHOT, answers)
    ).rejects.toMatchObject({
      code: "invalid_submission_answers",
      statusCode: 400,
      message: expect.stringContaining(message)
    })
  })

  it("accepts a complete submission with a verified required file", async () => {
    await expect(
      validateSubmissionForSubmit(
        SNAPSHOT,
        {
          vendor_name: "Northstar Labs",
          effective_date: "2026-07-18",
          acknowledged: true,
          risk_level: "Standard",
          manager_initials: DRAWING_DATA_URL,
          manager_signature: DRAWING_DATA_URL
        },
        new Set(["evidence"])
      )
    ).resolves.toMatchObject({
      vendor_name: "Northstar Labs",
      acknowledged: true,
      manager_signature: DRAWING_DATA_URL
    })
  })

  it("rejects each missing required answer, including a verified file", async () => {
    const completeAnswers = {
      vendor_name: "Northstar Labs",
      effective_date: "2026-07-18",
      acknowledged: true,
      risk_level: "Standard",
      manager_initials: DRAWING_DATA_URL,
      manager_signature: DRAWING_DATA_URL
    }

    await expect(
      validateSubmissionForSubmit(
        SNAPSHOT,
        { ...completeAnswers, acknowledged: false },
        new Set(["evidence"])
      )
    ).rejects.toMatchObject({
      code: "incomplete_submission",
      message:
        "Acknowledged must be completed before this submission can be submitted."
    })

    await expect(
      validateSubmissionForSubmit(SNAPSHOT, completeAnswers, new Set())
    ).rejects.toMatchObject({
      code: "incomplete_submission",
      message:
        "Evidence must be completed before this submission can be submitted."
    })
  })

  it("rejects available files that do not belong to a file field", async () => {
    await expect(
      validateSubmissionForSubmit(SNAPSHOT, {}, new Set(["vendor_name"]))
    ).rejects.toMatchObject({
      code: "invalid_submission_answers",
      statusCode: 400,
      message:
        "Available file field vendor_name is not part of this template snapshot."
    })
  })

  it("skips hidden required fields and ignores their verified file for completeness", async () => {
    await expect(
      validateSubmissionForSubmit(
        CONDITIONAL_SNAPSHOT,
        {
          category: "Standard",
          include_evidence: false,
          other_details: "Stale detail",
          evidence_notes: "Stale notes"
        },
        new Set(["evidence"])
      )
    ).resolves.toEqual({
      category: "Standard",
      include_evidence: false
    })
  })

  it("requires conditional fields only after their controllers reveal them", async () => {
    await expect(
      validateSubmissionForSubmit(
        CONDITIONAL_SNAPSHOT,
        { category: "Other", include_evidence: false },
        new Set()
      )
    ).rejects.toMatchObject({
      code: "incomplete_submission",
      message:
        "Please specify category must be completed before this submission can be submitted."
    })

    await expect(
      validateSubmissionForSubmit(
        CONDITIONAL_SNAPSHOT,
        {
          category: "Standard",
          include_evidence: true,
          evidence_notes: "Attached proof"
        },
        new Set()
      )
    ).rejects.toMatchObject({
      code: "incomplete_submission",
      message:
        "Evidence must be completed before this submission can be submitted."
    })
  })

  it("rejects duplicate field keys in an untrusted snapshot", async () => {
    const duplicateSnapshot = structuredClone(SNAPSHOT)
    const duplicateBlock = structuredClone(duplicateSnapshot.blocks[0])
    duplicateBlock.id = "90000000-0000-4000-8000-000000000099"
    duplicateSnapshot.blocks.push(duplicateBlock)

    await expect(
      normalizeSubmissionDraftAnswers(duplicateSnapshot, {})
    ).rejects.toMatchObject({
      code: "invalid_submission_snapshot",
      statusCode: 500
    })
  })
})

describe("structured submission answers", () => {
  const STRUCTURED = createStructuredAnswerContent()

  it("normalizes each structured kind to one canonical shape", async () => {
    await expect(
      normalizeSubmissionDraftAnswers(STRUCTURED, {
        tools: [" Saw ", "Ladder"],
        checks: { "Lights work": " No ", "Exits clear": "" },
        hours: [["", " ", ""], [" 2026-10-01 ", "-1,234.5", " x "]],
        log: Array.from({ length: 100 }, () => [""]),
        amount: "-1,200.50",
        ref: "AB12"
      })
    ).resolves.toEqual({
      tools: ["Ladder", "Saw"],
      checks: { "Lights work": "No" },
      hours: [["2026-10-01", "-1,234.5", "x"]],
      log: [],
      amount: "-1,200.50",
      ref: "AB12"
    })
  })

  it("submits only once every required structured answer is complete", async () => {
    await expect(
      validateSubmissionForSubmit(STRUCTURED, STRUCTURED_ANSWERS, new Set())
    ).resolves.toEqual(STRUCTURED_ANSWERS)

    for (const incomplete of [
      { tools: [] },
      { checks: { "Exits clear": "Yes" } },
      { hours: [["", "", ""]] }
    ]) {
      await expect(
        validateSubmissionForSubmit(
          STRUCTURED,
          { ...STRUCTURED_ANSWERS, ...incomplete },
          new Set()
        )
      ).rejects.toMatchObject({ code: "incomplete_submission" })
    }
  })

  it.each([
    ["a choice that is not an option", { tools: ["Hammer"] }],
    ["a choice ticked twice", { tools: ["Saw", "Saw"] }],
    ["several choices sent as text", { tools: "Saw" }],
    ["a grid key that is not a row", { checks: { "Roof sound": "Yes" } }],
    ["a __proto__ grid key", { checks: JSON.parse('{"__proto__":"Yes"}') }],
    ["a grid choice that is not an option", { checks: { "Exits clear": "Maybe" } }],
    ["a grid sent as a list", { checks: ["Yes"] }],
    ["a table row with too many cells", { hours: [["2026-10-01", "1", "x", "extra"]] }],
    ["a table cell that is not text", { hours: [["2026-10-01", 1, "x"]] }],
    ["a table cell over 500 characters", { log: [["x".repeat(501)]] }],
    ["a date cell that is not a date", { hours: [["2026-02-30", "1", ""]] }],
    ["a number cell that is not a number", { hours: [["", "1.2.3", ""]] }],
    ["more rows than a fixed table shows", { hours: [["", "1", ""], ["", "2", ""], ["", "3", ""]] }],
    ["a 10k-row table", { log: Array.from({ length: 10_000 }, () => ["x"]) }],
    ["money to three decimals", { amount: "1.005" }],
    ["a reference longer than its boxes", { ref: "ABCDE" }]
  ])("rejects %s", async (_case, answers) => {
    await expect(
      normalizeSubmissionDraftAnswers(STRUCTURED, answers)
    ).rejects.toMatchObject({ code: "invalid_submission_answers", statusCode: 400 })
  })
})

function createSubmissionSnapshot(): TemplateContent {
  return parseTemplateContent({
    schemaVersion: 2,
    blocks: [
      {
        id: "90000000-0000-4000-8000-000000000001",
        type: "text_field",
        fieldKey: "vendor_name",
        label: "Vendor name",
        required: true,
        helpText: null,
        placeholder: null,
        multiline: false
      },
      {
        id: "90000000-0000-4000-8000-000000000002",
        type: "date_field",
        fieldKey: "effective_date",
        label: "Effective date",
        required: true,
        helpText: null
      },
      {
        id: "90000000-0000-4000-8000-000000000003",
        type: "checkbox_field",
        fieldKey: "acknowledged",
        label: "Acknowledged",
        required: true,
        helpText: null,
        checkedByDefault: false
      },
      {
        id: "90000000-0000-4000-8000-000000000004",
        type: "dropdown_field",
        fieldKey: "risk_level",
        label: "Risk level",
        required: true,
        helpText: null,
        placeholder: null,
        options: ["Standard", "Elevated"]
      },
      {
        id: "90000000-0000-4000-8000-000000000005",
        type: "initials_field",
        fieldKey: "manager_initials",
        label: "Manager initials",
        required: false,
        helpText: null
      },
      {
        id: "90000000-0000-4000-8000-000000000006",
        type: "signature_field",
        fieldKey: "manager_signature",
        label: "Manager signature",
        required: true,
        helpText: null
      },
      {
        id: "90000000-0000-4000-8000-000000000007",
        type: "file_field",
        fieldKey: "evidence",
        label: "Evidence",
        required: true,
        helpText: null
      }
    ]
  })
}

function createConditionalSubmissionSnapshot(): TemplateContent {
  const categoryBlockId = "91000000-0000-4000-8000-000000000001"
  const includeEvidenceBlockId = "91000000-0000-4000-8000-000000000002"

  return parseTemplateContent({
    schemaVersion: 3,
    branding: {},
    layout: {},
    sections: [],
    fieldGroups: [],
    blockRules: [],
    blocks: [
      {
        id: categoryBlockId,
        type: "dropdown_field",
        fieldKey: "category",
        label: "Category",
        required: true,
        helpText: null,
        placeholder: null,
        options: ["Standard", "Other"]
      },
      {
        id: includeEvidenceBlockId,
        type: "checkbox_field",
        fieldKey: "include_evidence",
        label: "Include evidence",
        required: false,
        helpText: null,
        checkedByDefault: false
      },
      {
        id: "91000000-0000-4000-8000-000000000003",
        type: "text_field",
        fieldKey: "other_details",
        label: "Please specify category",
        required: true,
        helpText: null,
        placeholder: null,
        multiline: false,
        visibleWhen: {
          sourceBlockId: categoryBlockId,
          operator: "equals",
          value: "Other"
        }
      },
      {
        id: "91000000-0000-4000-8000-000000000004",
        type: "text_field",
        fieldKey: "evidence_notes",
        label: "Evidence notes",
        required: true,
        helpText: null,
        placeholder: null,
        multiline: true,
        visibleWhen: {
          sourceBlockId: includeEvidenceBlockId,
          operator: "equals",
          value: true
        }
      },
      {
        id: "91000000-0000-4000-8000-000000000005",
        type: "file_field",
        fieldKey: "evidence",
        label: "Evidence",
        required: true,
        helpText: null,
        visibleWhen: {
          sourceBlockId: includeEvidenceBlockId,
          operator: "equals",
          value: true
        }
      }
    ]
  })
}

function createConditionalSubmission(): Submission {
  return {
    id: "94000000-0000-4000-8000-000000000001",
    organizationId: "94000000-0000-4000-8000-000000000002",
    title: "Conditional submission",
    templateId: "94000000-0000-4000-8000-000000000003",
    templateRevision: 1,
    templateSnapshot: CONDITIONAL_SNAPSHOT,
    values: {
      category: "Other",
      include_evidence: false,
      other_details: "Prior detail"
    },
    revision: 1,
    status: "draft",
    createdBy: "94000000-0000-4000-8000-000000000004",
    updatedBy: "94000000-0000-4000-8000-000000000004",
    assignedTo: null,
    assignedBy: null,
    assignedAt: null,
    requiredApprovals: null,
    submittedBy: null,
    submittedAt: null,
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z"
  }
}
