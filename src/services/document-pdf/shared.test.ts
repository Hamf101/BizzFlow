import { describe, expect, it } from "vitest"

import { createBlankTemplateContent } from "@/types/template"

import { fitMarginWords, formatFieldValue, normalizePdfInput } from "./shared"
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

describe("header and footer words", () => {
  it("lets a long title use the room a short page count leaves, and keeps a centred word clear of both sides", () => {
    // A 400-point line: the title would need 600, the page count 60.
    const titled = fitMarginWords({ left: 600, right: 60 }, 400, 12)

    expect(titled).toEqual({ left: 328, right: 60 })
    // Both long: they share the line evenly and never meet.
    expect(fitMarginWords({ left: 600, right: 300 }, 400, 12)).toEqual({ left: 194, right: 194 })
    // A centred word takes up to a third and stays centred; the sides share what is left.
    expect(fitMarginWords({ center: 50, left: 600, right: 20 }, 400, 12)).toEqual({ center: 50, left: 163, right: 20 })
    expect(fitMarginWords({ center: 900 }, 300, 12)).toEqual({ center: 100 })
    expect(fitMarginWords({}, 400, 12)).toEqual({})
  })
})
