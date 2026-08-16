import { PDFDocument } from "pdf-lib"
import { describe, expect, it } from "vitest"

import {
  renderGeneratedDocumentPdf,
  type RenderGeneratedDocumentPdfInput
} from "@/services/document-pdf-service"
import { createPdfPagePlans } from "@/services/document-pdf/planner"
import { normalizePdfInput } from "@/services/document-pdf/shared"
import type { PdfFlowItem, PdfPagePlan } from "@/services/document-pdf/types"
import { createPdfLayoutMetrics } from "@/services/document-pdf/layout"
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

  it("applies real repeated-header and footer policies to every planned page", () => {
    const input = createPdfInput({
      longBody: true,
      repeatHeader: true,
      repeatFooter: true
    })
    const content = requireVersionThreeContent(input)

    content.layout = {
      ...content.layout,
      footerPolicy: "first_page"
    }

    const plans = planPdf(input)

    expect(plans.length).toBeGreaterThan(1)
    expect(
      plans.map(
        (page: PdfPagePlan): number =>
          page.items.filter(
            (item: PdfFlowItem): boolean => item.kind === "branding"
          ).length
      )
    ).toEqual(Array.from({ length: plans.length }, (): number => 1))
    expect(plans.map((page: PdfPagePlan): boolean => page.showHeader)).toEqual(
      Array.from({ length: plans.length }, (): boolean => true)
    )
    expect(plans.map((page: PdfPagePlan): boolean => page.showFooter)).toEqual([
      true,
      ...Array.from(
        { length: plans.length - 1 },
        (): boolean => false
      )
    ])
  })

  it("suppresses the visible PDF footer when page numbering is disabled", () => {
    const input = createPdfInput({
      longBody: true,
      repeatHeader: false,
      repeatFooter: true
    })
    const content = requireVersionThreeContent(input)

    content.layout = {
      ...content.layout,
      pageNumbering: "none"
    }

    const plans = planPdf(input)

    expect(
      plans.every(
        (page: PdfPagePlan): boolean =>
          !page.showFooter && !page.showPageNumber
      )
    ).toBe(true)
    expect(
      plans.every(
        (page: PdfPagePlan): boolean =>
          page.items.every(
            (item: PdfFlowItem): boolean => item.kind !== "branding"
          )
      )
    ).toBe(true)
  })

  it("carries the shared final title and visible blocks into the PDF flow", () => {
    const input = createPdfInput({
      repeatHeader: false,
      repeatFooter: false
    })
    const content = input.content as TemplateContent

    if (content.schemaVersion !== 3) {
      throw new Error("Expected a version-three PDF fixture.")
    }

    content.layout = {
      ...content.layout,
      printedTitle: { mode: "custom", text: "Printable authorization" }
    }
    content.blocks = [
      {
        id: "20000000-0000-4000-8000-000000000001",
        type: "checkbox_field",
        fieldKey: "include_private_terms",
        label: "Include private terms",
        required: false,
        helpText: null,
        checkedByDefault: false
      },
      {
        id: "20000000-0000-4000-8000-000000000002",
        type: "paragraph",
        text: "Always visible terms",
        alignment: "left"
      },
      {
        id: "20000000-0000-4000-8000-000000000003",
        type: "text_field",
        fieldKey: "private_terms",
        label: "Private terms",
        required: false,
        helpText: null,
        placeholder: null,
        multiline: true,
        visibleWhen: {
          sourceBlockId: "20000000-0000-4000-8000-000000000001",
          operator: "equals",
          value: true
        }
      }
    ]
    content.sections = []
    input.answers = { include_private_terms: false }
    input.signers = []

    const normalized = normalizePdfInput(input)
    const plans = createPdfPagePlans(normalized)
    const flowItems = plans.flatMap(
      (page: PdfPagePlan): PdfFlowItem[] => page.items
    )
    const titleItems = flowItems.filter(
      (
        item: PdfFlowItem
      ): item is Extract<PdfFlowItem, { kind: "title" }> =>
        item.kind === "title"
    )
    const plannedBlockIds = collectPlannedBlockIds(plans)
    const renderPlanBlockIds = normalized.renderPlan.blocks.map(
      ({ block }): string => block.id
    )

    expect(normalized.title).toBe("Professional services agreement")
    expect(normalized.renderPlan.title).toBe("Printable authorization")
    expect(titleItems).toEqual([
      { kind: "title", title: "Printable authorization" }
    ])
    expect(plannedBlockIds).toEqual(renderPlanBlockIds)
    expect(plannedBlockIds).toEqual([
      "20000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000002"
    ])
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

  it("honors section page breaks and keep-together boundaries", () => {
    const input = createPdfInput({
      repeatHeader: false,
      repeatFooter: false
    })
    const content = requireVersionThreeContent(input)
    const fillerBlocks = Array.from(
      { length: 7 },
      (_value: unknown, index: number) => ({
        id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        type: "paragraph" as const,
        text: `Preparation note ${index + 1}`,
        alignment: "left" as const
      })
    )
    const firstFieldId = "30000000-0000-4000-8000-000000000101"
    const secondFieldId = "30000000-0000-4000-8000-000000000102"

    content.layout = {
      ...content.layout,
      pageSize: "A5",
      orientation: "landscape",
      marginPreset: "generous"
    }
    content.blocks = [
      ...fillerBlocks,
      {
        id: firstFieldId,
        type: "text_field",
        fieldKey: "approval_name",
        label: "Approval name",
        required: true,
        helpText: null,
        placeholder: null,
        multiline: false
      },
      {
        id: secondFieldId,
        type: "date_field",
        fieldKey: "approval_date",
        label: "Approval date",
        required: true,
        helpText: null
      }
    ]
    content.sections = [
      {
        id: "30000000-0000-4000-8000-000000000201",
        label: "Preparation",
        startBlockId: fillerBlocks[0].id,
        pageBreakBefore: false,
        keepTogether: false
      },
      {
        id: "30000000-0000-4000-8000-000000000202",
        label: "Approval",
        startBlockId: firstFieldId,
        pageBreakBefore: false,
        keepTogether: true
      }
    ]
    content.fieldGroups = []
    content.blockRules = []
    input.answers = {
      approval_name: "Avery Morgan",
      approval_date: "2026-08-03"
    }
    input.signers = []

    const plans = planPdf(input)
    const firstFieldPage = findPlannedBlockPage(plans, firstFieldId)
    const secondFieldPage = findPlannedBlockPage(plans, secondFieldId)
    const labels = collectPlannedStructureLabels(plans)

    expect(firstFieldPage).toBeGreaterThan(0)
    expect(secondFieldPage).toBe(firstFieldPage)
    expect(labels).toEqual(["Preparation", "Approval"])
  })

  it("starts a new page at an explicit canonical section break", () => {
    const input = createPdfInput({
      repeatHeader: false,
      repeatFooter: false
    })
    const content = requireVersionThreeContent(input)
    const firstBlockId = "35000000-0000-4000-8000-000000000001"
    const secondBlockId = "35000000-0000-4000-8000-000000000002"

    content.blocks = [
      {
        id: firstBlockId,
        type: "paragraph",
        text: "First section content",
        alignment: "left"
      },
      {
        id: secondBlockId,
        type: "paragraph",
        text: "Second section content",
        alignment: "left"
      }
    ]
    content.sections = [
      {
        id: "35000000-0000-4000-8000-000000000101",
        label: "First",
        startBlockId: firstBlockId,
        pageBreakBefore: false,
        keepTogether: false
      },
      {
        id: "35000000-0000-4000-8000-000000000102",
        label: "Second",
        startBlockId: secondBlockId,
        pageBreakBefore: true,
        keepTogether: false
      }
    ]
    content.fieldGroups = []
    content.blockRules = []
    input.signers = []

    const plans = planPdf(input)
    const secondSectionLabelPage = plans.findIndex(
      (page: PdfPagePlan): boolean =>
        page.items.some(
          (item: PdfFlowItem): boolean =>
            item.kind === "section_label" && item.label === "Second"
        )
    )

    expect(findPlannedBlockPage(plans, firstBlockId)).toBe(0)
    expect(findPlannedBlockPage(plans, secondBlockId)).toBe(1)
    expect(secondSectionLabelPage).toBe(1)
  })

  it("moves a keep-with-next block when only the first block would fit", () => {
    const input = createPdfInput({
      repeatHeader: false,
      repeatFooter: false
    })
    const content = requireVersionThreeContent(input)
    const fillerBlocks = Array.from(
      { length: 8 },
      (_value: unknown, index: number) => ({
        id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        type: "paragraph" as const,
        text: `Background note ${index + 1}`,
        alignment: "left" as const
      })
    )
    const headingId = "40000000-0000-4000-8000-000000000101"
    const paragraphId = "40000000-0000-4000-8000-000000000102"

    content.layout = {
      ...content.layout,
      pageSize: "A5",
      orientation: "landscape",
      marginPreset: "generous"
    }
    content.blocks = [
      ...fillerBlocks,
      {
        id: headingId,
        type: "heading",
        text: "Approval terms",
        level: 2,
        alignment: "left"
      },
      {
        id: paragraphId,
        type: "paragraph",
        text: "These terms stay with their heading.",
        alignment: "left"
      }
    ]
    content.sections = []
    content.fieldGroups = []
    content.blockRules = [
      {
        blockId: headingId,
        pageBreakBefore: false,
        keepWithNext: true
      }
    ]
    input.signers = []

    const plans = planPdf(input)
    const headingPage = findPlannedBlockPage(plans, headingId)
    const paragraphPage = findPlannedBlockPage(plans, paragraphId)

    expect(headingPage).toBeGreaterThan(0)
    expect(paragraphPage).toBe(headingPage)
  })

  it("renders canonical two-column field groups as paired PDF flow rows", async () => {
    const input = createPdfInput({
      repeatHeader: false,
      repeatFooter: false
    })
    const content = requireVersionThreeContent(input)
    const leftFieldId = "50000000-0000-4000-8000-000000000001"
    const rightFieldId = "50000000-0000-4000-8000-000000000002"

    content.blocks = [
      {
        id: leftFieldId,
        type: "text_field",
        fieldKey: "contact_name",
        label: "Contact name",
        required: true,
        helpText: null,
        placeholder: null,
        multiline: false
      },
      {
        id: rightFieldId,
        type: "date_field",
        fieldKey: "contact_date",
        label: "Contact date",
        required: true,
        helpText: null
      }
    ]
    content.sections = []
    content.fieldGroups = [
      {
        id: "50000000-0000-4000-8000-000000000101",
        label: "Contact",
        startBlockId: leftFieldId,
        endBlockId: rightFieldId,
        columns: 2,
        keepTogether: true
      }
    ]
    content.blockRules = []
    input.answers = {
      contact_name: "Northstar Labs",
      contact_date: "2026-08-03"
    }
    input.signers = []

    const plans = planPdf(input)
    const columnRows = plans
      .flatMap((page: PdfPagePlan): PdfFlowItem[] => page.items)
      .filter(
        (
          item: PdfFlowItem
        ): item is Extract<PdfFlowItem, { kind: "columns" }> =>
          item.kind === "columns"
      )
    const buffer = await renderGeneratedDocumentPdf(input)

    expect(columnRows).toHaveLength(1)
    expect(columnRows[0]?.left?.block.id).toBe(leftFieldId)
    expect(columnRows[0]?.right?.block.id).toBe(rightFieldId)
    expect(collectPlannedStructureLabels(plans)).toEqual(["Contact"])
    expect(buffer.subarray(0, 5).toString("utf8")).toBe("%PDF-")
  })

  it("uses density and margin settings to change printable pagination", () => {
    const compactInput = createDensityPdfInput("compact", "compact")
    const comfortableInput = createDensityPdfInput(
      "comfortable",
      "generous"
    )

    expect(planPdf(compactInput).length).toBeLessThan(
      planPdf(comfortableInput).length
    )
  })

  it("renders a generated document snapshot and signing record to PDF bytes", async () => {
    const buffer = await renderGeneratedDocumentPdf(
      createPdfInput({ repeatHeader: true, repeatFooter: false })
    )

    expect(buffer.subarray(0, 5).toString("utf8")).toBe("%PDF-")
    expect(buffer.length).toBeGreaterThan(1_000)
  })

  it("renders saved page size, orientation, and margins through pdf-lib", async () => {
    const input = createPdfInput({
      repeatHeader: false,
      repeatFooter: false
    })
    const content = requireVersionThreeContent(input)

    content.layout = {
      ...content.layout,
      pageSize: "Letter",
      orientation: "landscape",
      marginPreset: "generous"
    }

    const normalized = normalizePdfInput(input)
    const metrics = createPdfLayoutMetrics(
      normalized.renderPlan.geometry,
      normalized.renderPlan.layout
    )
    const buffer = await renderGeneratedDocumentPdf(input)
    const renderedDocument = await PDFDocument.load(buffer)
    const renderedPage = renderedDocument.getPage(0)

    expect(metrics).toMatchObject({
      pageWidth: 792,
      pageHeight: 612,
      margin: 56,
      contentWidth: 680,
      flowTopY: 556,
      pageCapacity: 500
    })
    expect(renderedPage.getWidth()).toBe(792)
    expect(renderedPage.getHeight()).toBe(612)
  })

  it("keeps the established default A4 planning measurements", () => {
    const normalized = normalizePdfInput(
      createPdfInput({ repeatHeader: true, repeatFooter: true })
    )
    const metrics = createPdfLayoutMetrics(
      normalized.renderPlan.geometry,
      normalized.renderPlan.layout
    )

    expect(metrics).toMatchObject({
      pageWidth: 595.28,
      pageHeight: 841.89,
      margin: 40,
      contentWidth: 515.28,
      flowTopY: 805.89,
      pageCapacity: 760,
      densityItemGapAdjustment: 0
    })
  })

  // Multi-page renders embed the full DejaVu fonts and legitimately exceed
  // vitest's 5s default on loaded machines; the generous timeout keeps the
  // suite deterministic without hiding real hangs.
  it("renders every planned page through the production pdf-lib adapter", { timeout: 30_000 }, async () => {
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

  it("renders byte-identical PDFs for the same persisted metadata timestamp", { timeout: 30_000 }, async () => {
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
      collectFlowItemBlockIds(item)
    )
  )
}

function collectFlowItemBlockIds(item: PdfFlowItem): string[] {
  if (item.kind === "block") {
    return [item.block.id]
  }

  if (item.kind === "columns") {
    return [
      ...(item.left ? [item.left.block.id] : []),
      ...(item.right ? [item.right.block.id] : [])
    ]
  }

  return []
}

function findPlannedBlockPage(
  plans: PdfPagePlan[],
  blockId: string
): number {
  return plans.findIndex((page: PdfPagePlan): boolean =>
    page.items.some((item: PdfFlowItem): boolean =>
      collectFlowItemBlockIds(item).includes(blockId)
    )
  )
}

function collectPlannedStructureLabels(plans: PdfPagePlan[]): string[] {
  return plans.flatMap((page: PdfPagePlan): string[] =>
    page.items.flatMap((item: PdfFlowItem): string[] =>
      item.kind === "section_label" || item.kind === "field_group_label"
        ? [item.label]
        : []
    )
  )
}

function requireVersionThreeContent(
  input: RenderGeneratedDocumentPdfInput
): Extract<TemplateContent, { schemaVersion: 3 }> {
  const content = input.content as TemplateContent

  if (content.schemaVersion !== 3) {
    throw new Error("Expected a version-three PDF fixture.")
  }

  return content
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
      layout: {
        ...content.layout,
        headerPolicy: options.repeatHeader ? "all_pages" : "none",
        footerPolicy: options.repeatFooter ? "all_pages" : "none"
      },
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

function createDensityPdfInput(
  density: "balanced" | "compact" | "comfortable",
  marginPreset: "compact" | "generous" | "standard"
): RenderGeneratedDocumentPdfInput {
  const input = createPdfInput({
    repeatHeader: false,
    repeatFooter: false
  })
  const content = requireVersionThreeContent(input)

  content.layout = {
    ...content.layout,
    pageSize: "A5",
    orientation: "landscape",
    density,
    marginPreset
  }
  content.blocks = Array.from(
    { length: 24 },
    (_value: unknown, index: number) => ({
      id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      type: "paragraph" as const,
      text: `Compact planning line ${index + 1}`,
      alignment: "left" as const
    })
  )
  content.sections = []
  content.fieldGroups = []
  content.blockRules = []
  input.signers = []

  return input
}
