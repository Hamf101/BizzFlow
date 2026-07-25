import { describe, expect, it } from "vitest"

import { createBlankTemplateContent } from "@/types/template"

import {
  GeneratedDocumentFormDataError,
  getGeneratedDocumentAnswerBaselineFields,
  getGeneratedDocumentAnswerName,
  parseGeneratedDocumentAnswerBaseline,
  parseGeneratedDocumentAnswers
} from "./generated-document-form-data"

describe("generated document form data", () => {
  it("coerces text, checkbox, and drawing answer fields", () => {
    const formData = new FormData()
    formData.append(
      getGeneratedDocumentAnswerName("text", "client_name"),
      "Northstar"
    )
    formData.append(
      getGeneratedDocumentAnswerName("boolean", "approved"),
      "false"
    )
    formData.append(
      getGeneratedDocumentAnswerName("boolean", "approved"),
      "true"
    )
    formData.append(
      getGeneratedDocumentAnswerName("drawing", "manager_initials"),
      "data:image/png;base64,aGVsbG8="
    )

    expect(parseGeneratedDocumentAnswers(formData)).toEqual({
      client_name: "Northstar",
      approved: true,
      manager_initials: "data:image/png;base64,aGVsbG8="
    })
  })

  it("omits empty drawing fields so existing drawings remain unchanged", () => {
    const formData = new FormData()
    formData.append(
      getGeneratedDocumentAnswerName("drawing", "manager_signature"),
      ""
    )

    expect(parseGeneratedDocumentAnswers(formData)).toEqual({})
  })

  it("rejects malformed checkbox values", () => {
    const formData = new FormData()
    formData.append(getGeneratedDocumentAnswerName("boolean", "approved"), "on")

    expect(() => parseGeneratedDocumentAnswers(formData)).toThrow(
      GeneratedDocumentFormDataError
    )
  })

  it("preserves the baseline-specific malformed checkbox error", () => {
    const formData = new FormData()
    formData.append("answer-baseline.boolean.approved", "on")

    expect(() => parseGeneratedDocumentAnswerBaseline(formData)).toThrow(
      "A checkbox answer baseline was malformed."
    )
  })

  it("round-trips compact public answer baselines without drawing data", () => {
    const content = createBlankTemplateContent()
    content.blocks = [
      {
        id: "50000000-0000-4000-8000-000000000001",
        type: "text_field",
        fieldKey: "client_name",
        label: "Client name",
        required: true,
        helpText: null,
        placeholder: null,
        multiline: false
      },
      {
        id: "50000000-0000-4000-8000-000000000002",
        type: "checkbox_field",
        fieldKey: "approved",
        label: "Approved",
        required: false,
        helpText: null,
        checkedByDefault: false
      },
      {
        id: "50000000-0000-4000-8000-000000000003",
        type: "signature_field",
        fieldKey: "manager_signature",
        label: "Manager signature",
        required: true,
        helpText: null
      },
      {
        id: "50000000-0000-4000-8000-000000000004",
        type: "file_field",
        fieldKey: "supporting_document",
        label: "Supporting document",
        required: true,
        helpText: null
      }
    ]

    const fields = getGeneratedDocumentAnswerBaselineFields(content, {
      client_name: "Northstar",
      approved: true,
      manager_signature: "data:image/png;base64,large-drawing",
      supporting_document: "not-a-generated-document-answer"
    })
    const formData = new FormData()

    for (const field of fields) {
      formData.append(field.name, field.value)
    }

    expect(fields).toHaveLength(2)
    expect(parseGeneratedDocumentAnswerBaseline(formData)).toEqual({
      client_name: "Northstar",
      approved: true
    })
  })

  it("uses checkbox defaults only while the answer key is absent", () => {
    const content = createBlankTemplateContent()
    content.blocks = [
      {
        id: "50000000-0000-4000-8000-000000000010",
        type: "checkbox_field",
        fieldKey: "approved",
        label: "Approved",
        required: false,
        helpText: null,
        checkedByDefault: true
      }
    ]

    expect(getGeneratedDocumentAnswerBaselineFields(content, {})).toEqual([
      { name: "answer-baseline.boolean.approved", value: "true" }
    ])
    expect(
      getGeneratedDocumentAnswerBaselineFields(content, { approved: false })
    ).toEqual([{ name: "answer-baseline.boolean.approved", value: "false" }])
  })
})
