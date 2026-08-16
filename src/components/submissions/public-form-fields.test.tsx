import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  createBlankTemplateContent,
  type TemplateContentV3
} from "@/types/template"

import {
  PublicFormFieldList,
  type PublicFormInitialFile
} from "./public-form-fields"

const DROPDOWN_ID = "70000000-0000-4000-8000-000000000001"
const DROPDOWN_TEXT_ID = "70000000-0000-4000-8000-000000000002"
const CHECKBOX_ID = "70000000-0000-4000-8000-000000000003"
const CHECKBOX_TEXT_ID = "70000000-0000-4000-8000-000000000004"
const CHECKBOX_FILE_ID = "70000000-0000-4000-8000-000000000005"
const DROPDOWN_FILE_ID = "70000000-0000-4000-8000-000000000006"

function renderFields(
  content: TemplateContentV3,
  answers: Readonly<Record<string, unknown>>,
  initialFiles: readonly PublicFormInitialFile[] = []
): string {
  return renderToStaticMarkup(
    createElement(PublicFormFieldList, {
      answers,
      content,
      files: initialFiles,
      onAnswerChange: (): void => undefined,
      token: "public-token"
    })
  )
}

describe("PublicFormFieldList conditional visibility", () => {
  it("reacts to a controlling dropdown while preserving public field names", () => {
    const content = createDropdownContent()

    const standardMarkup = renderFields(content, {
      request_type: "Standard"
    })
    const otherMarkup = renderFields(content, { request_type: "Other" })

    expect(standardMarkup).toContain('name="field_request_type"')
    expect(standardMarkup).not.toContain(
      'data-public-form-field-key="request_details"'
    )
    expect(standardMarkup).not.toContain('name="field_request_details"')
    expect(standardMarkup).not.toContain("Dropdown evidence")

    expect(otherMarkup).toContain(
      'data-public-form-field-key="request_details"'
    )
    expect(otherMarkup).toContain('name="field_request_details"')
    expect(otherMarkup).toContain("Dropdown evidence")
    expect(otherMarkup).toContain('type="file"')
    expect(otherMarkup).toContain("required=\"\"")
  })

  it("unmounts hidden required text and file fields under a checkbox", () => {
    const content = createCheckboxContent()

    const hiddenMarkup = renderFields(content, { include_evidence: false })
    const visibleMarkup = renderFields(content, { include_evidence: true })

    expect(hiddenMarkup).toContain('name="field_include_evidence"')
    expect(hiddenMarkup).not.toContain('name="field_evidence_summary"')
    expect(hiddenMarkup).not.toContain("Required evidence file")
    expect(hiddenMarkup).not.toContain('type="file"')

    expect(visibleMarkup).toContain('name="field_evidence_summary"')
    expect(visibleMarkup).toContain("Required evidence file")
    expect(visibleMarkup).toContain('type="file"')
  })

  it("restores verified file display state after a server navigation", () => {
    const markup = renderFields(
      createCheckboxContent(),
      { include_evidence: true },
      [
        {
          fieldKey: "evidence_file",
          fileId: "70000000-0000-4000-8000-000000000099",
          originalFilename: "verified-evidence.pdf"
        }
      ]
    )

    expect(markup).toContain("verified-evidence.pdf")
    expect(markup).toContain("Uploaded and verified")
    expect(markup).not.toContain('type="file"')
  })
})

function createDropdownContent(): TemplateContentV3 {
  const content = createBlankTemplateContent()
  content.blocks = [
    {
      id: DROPDOWN_ID,
      type: "dropdown_field",
      fieldKey: "request_type",
      label: "Request type",
      required: true,
      helpText: null,
      placeholder: "Choose a request type",
      options: ["Standard", "Other"]
    },
    {
      id: DROPDOWN_TEXT_ID,
      type: "text_field",
      fieldKey: "request_details",
      label: "Please specify",
      required: true,
      helpText: null,
      placeholder: null,
      multiline: false,
      visibleWhen: {
        sourceBlockId: DROPDOWN_ID,
        operator: "equals",
        value: "Other"
      }
    },
    {
      id: DROPDOWN_FILE_ID,
      type: "file_field",
      fieldKey: "dropdown_evidence",
      label: "Dropdown evidence",
      required: true,
      helpText: null,
      visibleWhen: {
        sourceBlockId: DROPDOWN_ID,
        operator: "equals",
        value: "Other"
      }
    }
  ]
  return content
}

function createCheckboxContent(): TemplateContentV3 {
  const content = createBlankTemplateContent()
  content.blocks = [
    {
      id: CHECKBOX_ID,
      type: "checkbox_field",
      fieldKey: "include_evidence",
      label: "Include evidence",
      required: false,
      helpText: null,
      checkedByDefault: false
    },
    {
      id: CHECKBOX_TEXT_ID,
      type: "text_field",
      fieldKey: "evidence_summary",
      label: "Evidence summary",
      required: true,
      helpText: null,
      placeholder: null,
      multiline: true,
      visibleWhen: {
        sourceBlockId: CHECKBOX_ID,
        operator: "equals",
        value: true
      }
    },
    {
      id: CHECKBOX_FILE_ID,
      type: "file_field",
      fieldKey: "evidence_file",
      label: "Required evidence file",
      required: true,
      helpText: null,
      visibleWhen: {
        sourceBlockId: CHECKBOX_ID,
        operator: "equals",
        value: true
      }
    }
  ]
  return content
}
