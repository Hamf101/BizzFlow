import { describe, expect, it } from "vitest"

import { createBlankTemplateContent } from "@/types/template"

import { formatFieldValue, normalizePdfInput } from "./shared"
import type { PdfFieldBlock } from "./types"

describe("printed answers", () => {
  it("prints a date the way its field asks", () => {
    const block = {
      dateFormat: { month: "long", order: "dmy", separator: " " },
      fieldKey: "move_in",
      helpText: null,
      id: "00000000-0000-4000-8000-000000000001",
      label: "Move-in date",
      required: true,
      type: "date_field",
    } as PdfFieldBlock

    expect(formatFieldValue(block, "2026-09-02")).toBe("2 September 2026")
    expect(formatFieldValue({ ...block, dateFormat: undefined } as PdfFieldBlock, "2026-09-02")).toBe("2026-09-02")
  })
})

describe("drawn boxes", () => {
  it("print only their own signer's mark: the sender's drawing, or the k-th signer's", () => {
    const drawing = (name: string) => `data:image/png;base64,${name}`
    const box = (fieldKey: string, type: "signature_field" | "initials_field", signer?: "sender" | number) => ({
      fieldKey,
      helpText: null,
      id: `00000000-0000-4000-8000-00000000000${fieldKey.length}`,
      label: fieldKey,
      required: false,
      type,
      ...(signer === undefined ? {} : { signer }),
    })
    const signer = (id: string, signature: string | null, initials: string | null) => ({
      email: "",
      id,
      initialsDataUrl: initials,
      name: id,
      requiresSignature: true,
      signatureDataUrl: signature,
      signedAt: null,
      status: "signed" as const,
    })
    const { answers } = normalizePdfInput({
      answers: { a: drawing("Rm9yZ2Vk"), bb: drawing("Rm9yZ2Vk"), ccc: drawing("U2VuZGVy"), dddd: drawing("Rm9yZ2Vk") },
      content: {
        ...createBlankTemplateContent(),
        // No signer named is Signer 1; Signer 3 is not on this document.
        blocks: [box("a", "signature_field"), box("bb", "initials_field", 2), box("ccc", "signature_field", "sender"), box("dddd", "signature_field", 3)],
      },
      documentId: "document-1",
      signers: [signer("first", drawing("Rmlyc3Q="), drawing("Rmk=")), signer("second", drawing("U2Vjb25k"), drawing("U2U="))],
      title: "Lease",
      workflowStatus: "completed",
    })

    expect(answers).toEqual({ a: drawing("Rmlyc3Q="), bb: drawing("U2U="), ccc: drawing("U2VuZGVy") })
  })
})
