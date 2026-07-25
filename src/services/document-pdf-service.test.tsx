import { PDFDocument } from "pdf-lib"
import { describe, expect, it } from "vitest"

import {
  renderGeneratedDocumentPdf,
  type RenderGeneratedDocumentPdfInput
} from "@/services/document-pdf-service"
import { createPdfPagePlans } from "@/services/document-pdf/planner"
import { normalizePdfInput } from "@/services/document-pdf/shared"
import type { PdfFlowItem, PdfPagePlan } from "@/services/document-pdf/types"
import {
  createBlankTemplateContent,
  type TemplateContent
} from "@/types/template"

const VALID_DRAWING_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

describe("document PDF service", () => {
  it("keeps every document block in one printable page flow", () => {
    const plans = planPdf(
      createPdfInput({
        longBody: true,
        repeatHeader: true,
        repeatFooter: true
      })
    )
    const blockIds = collectPlannedBlockIds(plans)

    expect(plans.length).toBeGreaterThan(1)
    expect(blockIds).toContain("00000000-0000-4000-8000-000000000001")
    expect(blockIds).toContain("00000000-0000-4000-8000-000000000009")
  })

  it("splits long prose, lists, tables, and text answers before paging", () => {
    const blockItems = planPdf(createStressPdfInput())
      .flatMap((page: PdfPagePlan): PdfFlowItem[] => page.items)
      .filter(
        (item: PdfFlowItem): item is Extract<PdfFlowItem, { kind: "block" }> =>
          item.kind === "block"
      )
    const blockTypes = blockItems.map((item) => item.block.type)
    const textFieldItems = blockItems.filter(
      (item): boolean => item.block.type === "text_field"
    )

    expect(
      blockTypes.filter((type): boolean => type === "paragraph").length
    ).toBeGreaterThan(1)
    expect(
      blockTypes.filter((type): boolean => type === "numbered_list").length
    ).toBeGreaterThan(1)
    expect(
      blockTypes.filter((type): boolean => type === "table").length
    ).toBeGreaterThan(1)
    expect(textFieldItems.length).toBeGreaterThan(1)
    expect(
      textFieldItems.some((item): boolean => item.fieldContinued === true)
    ).toBe(true)
  })

  it("renders a generated document snapshot and signing record to PDF bytes", async () => {
    const buffer = await renderGeneratedDocumentPdf(
      createPdfInput({ repeatHeader: true, repeatFooter: false })
    )

    expect(buffer.subarray(0, 5).toString("utf8")).toBe("%PDF-")
    expect(buffer.length).toBeGreaterThan(1_000)
  })

  it("renders every planned page through the production pdf-lib adapter", async () => {
    const input = createPdfInput({
      longBody: true,
      repeatHeader: true,
      repeatFooter: true
    })
    const plannedPageCount = planPdf(input).length
    const buffer = await renderGeneratedDocumentPdf(input)
    const renderedDocument = await PDFDocument.load(buffer)

    expect(plannedPageCount).toBeGreaterThan(1)
    expect(renderedDocument.getPageCount()).toBe(plannedPageCount)
  })

  it("renders byte-identical PDFs for the same persisted metadata timestamp", async () => {
    const input = {
      ...createPdfInput({ repeatHeader: true, repeatFooter: true }),
      metadataTimestamp: "2026-07-18T03:14:15.926Z"
    }

    const firstBuffer = await renderGeneratedDocumentPdf(input)
    const secondBuffer = await renderGeneratedDocumentPdf(input)

    expect(firstBuffer.equals(secondBuffer)).toBe(true)

    const renderedDocument = await PDFDocument.load(firstBuffer, {
      updateMetadata: false
    })

    expect(renderedDocument.getCreationDate()?.toISOString()).toBe(
      "2026-07-18T03:14:15.000Z"
    )
    expect(renderedDocument.getModificationDate()?.toISOString()).toBe(
      "2026-07-18T03:14:15.000Z"
    )
  })

  it("rejects malformed PDF metadata timestamps", async () => {
    await expect(
      renderGeneratedDocumentPdf({
        ...createPdfInput({ repeatHeader: false, repeatFooter: false }),
        metadataTimestamp: "tomorrow morning"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "PDF metadata timestamp is invalid."
    })
  })

  it("rejects malformed signature drawings before rendering", async () => {
    const input = createPdfInput({ repeatHeader: false, repeatFooter: false })

    await expect(
      renderGeneratedDocumentPdf({
        ...input,
        signers: [
          {
            ...input.signers![0],
            signatureDataUrl: "javascript:alert(1)"
          }
        ]
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "A signature or initials drawing is invalid."
    })
  })
})

function planPdf(input: RenderGeneratedDocumentPdfInput): PdfPagePlan[] {
  return createPdfPagePlans(normalizePdfInput(input))
}

function collectPlannedBlockIds(plans: PdfPagePlan[]): string[] {
  return plans.flatMap((page: PdfPagePlan): string[] =>
    page.items.flatMap((item: PdfFlowItem): string[] =>
      item.kind === "block" ? [item.block.id] : []
    )
  )
}

function createPdfInput(options: {
  longBody?: boolean
  repeatFooter: boolean
  repeatHeader: boolean
}): RenderGeneratedDocumentPdfInput {
  const content = createBlankTemplateContent()

  return {
    documentId: "document-1",
    title: "Professional services agreement",
    workflowStatus: "completed",
    answers: {
      client_name: "Northstar Labs",
      effective_date: "2026-07-17",
      accepted: true
    },
    signers: [
      {
        id: "signer-1",
        name: "Avery Morgan",
        email: "avery@example.com",
        requiresSignature: true,
        status: "signed",
        signedAt: "2026-07-17T18:30:00.000Z",
        signatureDataUrl: VALID_DRAWING_DATA_URL,
        initialsDataUrl: VALID_DRAWING_DATA_URL
      },
      {
        id: "signer-2",
        name: "Jordan Lee",
        email: "jordan@example.com",
        requiresSignature: true,
        status: "signed",
        signedAt: "2026-07-17T19:10:00.000Z"
      }
    ],
    content: {
      ...content,
      branding: {
        ...content.branding,
        organizationName: "BizFlow Studio",
        primaryColor: "#17324D"
      },
      blocks: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          type: "paragraph",
          text: "Confidential client agreement",
          alignment: "right"
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          type: "heading",
          text: "Scope of work",
          level: 2,
          alignment: "left"
        },
        {
          id: "00000000-0000-4000-8000-000000000003",
          type: "paragraph",
          text: options.longBody
            ? Array.from(
                { length: 120 },
                (): string =>
                  "The parties agree to the following services and terms."
              ).join(" ")
            : "The parties agree to the following services and terms.",
          alignment: "left"
        },
        {
          id: "00000000-0000-4000-8000-000000000004",
          type: "bullet_list",
          items: ["Discovery workshop", "Implementation", "Handoff"]
        },
        {
          id: "00000000-0000-4000-8000-000000000005",
          type: "table",
          headers: ["Phase", "Amount"],
          rows: [
            ["Discovery", "$1,500"],
            ["Delivery", "$4,500"]
          ]
        },
        {
          id: "00000000-0000-4000-8000-000000000006",
          type: "text_field",
          fieldKey: "client_name",
          label: "Client legal name",
          required: true,
          helpText: null,
          placeholder: null,
          multiline: false
        },
        {
          id: "00000000-0000-4000-8000-000000000007",
          type: "date_field",
          fieldKey: "effective_date",
          label: "Effective date",
          required: true,
          helpText: null
        },
        {
          id: "00000000-0000-4000-8000-000000000008",
          type: "checkbox_field",
          fieldKey: "accepted",
          label: "Terms accepted",
          required: true,
          helpText: null,
          checkedByDefault: false
        },
        {
          id: "00000000-0000-4000-8000-000000000009",
          type: "paragraph",
          text: "BizFlow Studio • Internal reference BF-2026-0717",
          alignment: "center"
        }
      ]
    }
  }
}

function createStressPdfInput(): RenderGeneratedDocumentPdfInput {
  const input = createPdfInput({
    repeatHeader: true,
    repeatFooter: true
  })
  const content = input.content as TemplateContent
  const longValue = Array.from(
    { length: 250 },
    (): string => "A detailed provision remains part of this agreement."
  ).join(" ")

  input.answers.client_name = longValue
  content.blocks = [
    {
      id: "10000000-0000-4000-8000-000000000001",
      type: "paragraph",
      text: longValue,
      alignment: "left"
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      type: "numbered_list",
      items: Array.from(
        { length: 8 },
        (_value: unknown, index: number): string =>
          `Requirement ${index + 1}. ${"Supporting detail ".repeat(70)}`
      )
    },
    {
      id: "10000000-0000-4000-8000-000000000003",
      type: "table",
      headers: ["Item", "Terms"],
      rows: Array.from(
        { length: 6 },
        (_value: unknown, index: number): string[] => [
          `Line ${index + 1}`,
          "Detailed commercial condition ".repeat(45)
        ]
      )
    },
    {
      id: "10000000-0000-4000-8000-000000000004",
      type: "text_field",
      fieldKey: "client_name",
      label: "Client legal name",
      required: true,
      helpText: null,
      placeholder: null,
      multiline: true
    }
  ]

  return input
}
