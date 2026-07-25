import { describe, expect, it } from "vitest"

import {
  normalizeSubmissionDraftAnswers,
  validateSubmissionForSubmit
} from "@/services/submissions/validation"
import { parseTemplateContent, type TemplateContent } from "@/types/template"

const DRAWING_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAqklEQVR4nOXQyw2EMAwFwLTAbTug/wqztxUCIRYIjBMfIkX52H5Tps9cl6vWWjKtsgbIBvHbZIXYHGSD2L3IAnH4YHSIvx+OCnH6w2gQlz+OAnG7QO8QzQr1CtG8YG8QjxXuBeLxBtEhXmsUFeL1htEgmHwUCAYQBYIDaAgeXEPwwBqCB9UQPKCG4ME0BA+kIXgQDcEDaAg+uIbgA2sIPqiG4ANqCD6YhvgCi4+tg797B8QAAAAASUVORK5CYII="

const SNAPSHOT = createSubmissionSnapshot()

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
