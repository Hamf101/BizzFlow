import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib"
import { describe, expect, it } from "vitest"

import {
  createPngBytes,
  toImageDataUrl
} from "@/lib/image-header.test-support"
import {
  renderGeneratedDocumentPdf,
  type RenderGeneratedDocumentPdfInput
} from "@/services/document-pdf-service"
import { createPdfPagePlans } from "@/services/document-pdf/planner"
import { createSampleDocumentInput } from "@/services/document-pdf/sample-document.test-support"
import { normalizePdfInput } from "@/services/document-pdf/shared"
import type { PdfFlowItem, PdfPagePlan } from "@/services/document-pdf/types"
import { createPdfLayoutMetrics, getPdfColumnFrames, type PdfLayoutMetrics } from "@/services/document-pdf/layout"
import { resizeTemplateLayout } from "@/services/templates/template-render-plan"
import {
  createBlankTemplateContent,
  type TemplateContent
} from "@/types/template"

const VALID_DRAWING_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

// Each case embeds fonts and renders a real PDF, which costs seconds rather
// than milliseconds. Vitest runs files in parallel, so on a busy machine the
// stock 5s budget expires mid-render and the failure reads as a changed
// fingerprint — a real PDF regression is exactly what this file exists to
// catch, so a timeout that imitates one is worse than a slow test. Only the
// clock is relaxed here; every assertion is unchanged.
const PDF_RENDER_TIMEOUT_MS = 30_000

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

  it("prints a row of any blocks in columns at their widths", async () => {
    const input = createPdfInput({
      repeatHeader: false,
      repeatFooter: false
    })
    const content = requireVersionThreeContent(input)
    const leftFieldId = "50000000-0000-4000-8000-000000000001"
    const rightFieldId = "50000000-0000-4000-8000-000000000002"
    const noteId = "50000000-0000-4000-8000-000000000003"

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
      },
      {
        id: noteId,
        type: "paragraph",
        text: "We reply within two working days.",
        alignment: "left"
      }
    ]
    content.sections = []
    content.fieldGroups = [
      {
        id: "50000000-0000-4000-8000-000000000101",
        label: "Contact",
        startBlockId: leftFieldId,
        endBlockId: noteId,
        columns: 3,
        widths: [3, 6, 3],
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
    expect(columnRows[0]?.cells.map((cell) => cell?.block.id)).toEqual([leftFieldId, rightFieldId, noteId])
    expect(columnRows[0]?.widths).toEqual([3, 6, 3])

    // The middle column is twice the others, after two gaps.
    const frames = getPdfColumnFrames({ columnGap: 12, contentWidth: 492, margin: 50 } as PdfLayoutMetrics, [3, 6, 3])

    expect(frames).toEqual([
      { width: 117, x: 50 },
      { width: 234, x: 179 },
      { width: 117, x: 425 }
    ])
    expect(collectPlannedStructureLabels(plans)).toEqual(["Contact"])
    expect(buffer.subarray(0, 5).toString("utf8")).toBe("%PDF-")
  })

  it("leaves room to write by hand in a blank form, more for a long answer", () => {
    const pagesFor = (multiline: boolean): number => {
      const input = createPdfInput({ repeatHeader: false, repeatFooter: false })
      const content = requireVersionThreeContent(input)

      content.blocks = Array.from({ length: 30 }, (_value: unknown, index: number) => ({
        id: `51000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        type: "text_field" as const,
        fieldKey: `answer_${index}`,
        label: `Question ${index + 1}`,
        required: false,
        helpText: null,
        placeholder: null,
        multiline
      }))
      content.sections = []
      content.fieldGroups = []
      content.blockRules = []
      input.answers = {}
      input.signers = []

      return planPdf(input).length
    }

    expect(pagesFor(true)).toBeGreaterThan(pagesFor(false))
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

  it("gives a fillable PDF a form field for each answer, holding the answers so far", { timeout: PDF_RENDER_TIMEOUT_MS }, async () => {
    const input = createSampleDocumentInput()
    // A name the PDF's standard fonts cannot write, which a viewer must still show.
    input.answers = { ...input.answers, client_name: "Zoë Łukasz — Ōsaka" }
    const regular = await PDFDocument.load(await renderGeneratedDocumentPdf(input))
    const fillable = await PDFDocument.load(await renderGeneratedDocumentPdf(input, { fillable: true }))
    const form = fillable.getForm()
    const [page] = fillable.getPages()

    expect(regular.getForm().getFields()).toHaveLength(0)
    expect(form.getTextField("client_name").getText()).toBe("Zoë Łukasz — Ōsaka")
    expect(form.getTextField("effective_date").getText()).toBe("2026-07-17")
    expect(form.getDropdown("engagement_type").getOptions()).toEqual(["Fixed fee", "Time and materials"])
    expect(form.getDropdown("engagement_type").getSelected()).toEqual(["Fixed fee"])
    expect(form.getCheckBox("terms_accepted").isChecked()).toBe(true)

    for (const field of form.getFields()) {
      for (const widget of field.acroField.getWidgets()) {
        const box = widget.getRectangle()

        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(page.getWidth())
        expect(box.height).toBeGreaterThan(8)
      }
    }
  })

  it("prints a choice shown as radio buttons one option a line, inside the room the planner left, as one radio group", { timeout: PDF_RENDER_TIMEOUT_MS }, async () => {
    const input = createPdfInput({ repeatHeader: false, repeatFooter: false })
    const content = requireVersionThreeContent(input)
    const radios = (index: number, options: string[]) => ({
      id: `52000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      type: "dropdown_field" as const,
      display: "radios" as const,
      fieldKey: `choice_${index}`,
      label: `Question ${index + 1}`,
      required: false,
      helpText: "Choose one.",
      placeholder: null,
      options
    })
    // The worst case: more options, and longer, than one page holds.
    const many = Array.from({ length: 100 }, (_value: unknown, index: number): string => `Option ${index + 1} ${"long words ".repeat(20).trim()}`)

    content.blocks = [
      ...Array.from({ length: 24 }, (_value: unknown, index: number) => radios(index, index % 2 ? ["Yes", "No"] : ["Never", "Monthly", "Weekly", "Daily"])),
      radios(24, many),
      { id: "52000000-0000-4000-8000-000000000099", type: "text_field", fieldKey: "after", label: "After", required: false, helpText: null, placeholder: null, multiline: false }
    ]
    content.sections = []
    content.fieldGroups = []
    content.blockRules = []
    input.answers = { choice_1: "No", choice_24: many[99], after: "Next" }
    input.signers = []

    const normalized = normalizePdfInput(input)
    const metrics = createPdfLayoutMetrics(normalized.renderPlan.geometry, normalized.renderPlan.layout)
    const fillable = await PDFDocument.load(await renderGeneratedDocumentPdf(input, { fillable: true }))
    const form = fillable.getForm()

    expect(form.getRadioGroup("choice_1").getOptions()).toEqual(["Yes", "No"])
    expect(form.getRadioGroup("choice_1").getSelected()).toBe("No")
    expect(form.getRadioGroup("choice_0").getOptions()).toEqual(["Never", "Monthly", "Weekly", "Daily"])
    expect(form.getRadioGroup("choice_0").getSelected()).toBeUndefined()
    // Carried over pages, it is still one question with one answer.
    expect(form.getRadioGroup("choice_24").getOptions()).toEqual(many)
    expect(form.getRadioGroup("choice_24").getSelected()).toBe(many[99])

    // Drawn in order, each option sits below the last on its page, and none
    // below the page's flow: the planner reserved what the renderer drew.
    const widgets = form.getFields().flatMap((field) => field.acroField.getWidgets())
    const flowBottom = metrics.flowTopY - metrics.pageCapacity

    expect(fillable.getPageCount()).toBeGreaterThan(2)
    widgets.forEach((widget, index) => {
      const box = widget.getRectangle()
      const previous = widgets[index - 1]

      expect(box.y).toBeGreaterThanOrEqual(flowBottom - 0.5)

      if (previous && previous.P() === widget.P()) {
        expect(box.y + box.height).toBeLessThanOrEqual(previous.getRectangle().y)
      }
    })
  })

  it("prints radio buttons set side by side along a line, wrapping onto the next, inside the room the planner left", { timeout: PDF_RENDER_TIMEOUT_MS }, async () => {
    const input = createPdfInput({ repeatHeader: false, repeatFooter: false })
    const content = requireVersionThreeContent(input)
    // The worst case: a line of many options, and one option wider than the page.
    const sets = [["Yes", "No"], Array.from({ length: 14 }, (_value: unknown, index: number): string => `Choice ${index + 1}`), ["Short", "words ".repeat(40).trim(), "After"]]

    content.blocks = Array.from({ length: 30 }, (_value: unknown, index: number) => ({
      id: `53000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      type: "dropdown_field" as const,
      display: "radios" as const,
      across: true as const,
      fieldKey: `across_${index}`,
      label: `Question ${index + 1}`,
      required: false,
      helpText: null,
      placeholder: null,
      options: sets[index % 3]
    }))
    content.sections = []
    content.fieldGroups = []
    content.blockRules = []
    input.answers = { across_0: "No" }
    input.signers = []

    const normalized = normalizePdfInput(input)
    const metrics = createPdfLayoutMetrics(normalized.renderPlan.geometry, normalized.renderPlan.layout)
    const form = (await PDFDocument.load(await renderGeneratedDocumentPdf(input, { fillable: true }))).getForm()
    const boxes = (key: string) => form.getRadioGroup(key).acroField.getWidgets().map((widget) => widget.getRectangle())
    const [yes, no] = boxes("across_0")
    const many = boxes("across_1")
    const [short, long, after] = boxes("across_2")
    const flowBottom = metrics.flowTopY - metrics.pageCapacity

    expect(form.getRadioGroup("across_0").getSelected()).toBe("No")
    expect(no.y).toBe(yes.y)
    expect(no.x).toBeGreaterThan(yes.x + 20)
    // Many options fill a line, then go on to the next.
    expect(new Set(many.map((box) => box.y)).size).toBeGreaterThan(1)
    expect(many[1].y).toBe(many[0].y)
    // An option too wide to share a line takes one of its own.
    expect(long.y).toBeLessThan(short.y)
    expect(after.y).toBeLessThan(long.y - 15)
    form.getFields().forEach((field) => {
      field.acroField.getWidgets().forEach((widget) => {
        const box = widget.getRectangle()

        // A widget's rectangle takes in half its border.
        expect(box.x).toBeGreaterThanOrEqual(metrics.margin - 0.5)
        expect(box.x + box.width).toBeLessThanOrEqual(metrics.margin + metrics.contentWidth + 0.5)
        expect(box.y).toBeGreaterThanOrEqual(flowBottom - 0.5)
      })
    })
  })

  it("prints answers on a line beside their labels, ruled lines for a long answer, and a signature's caption under its line", { timeout: PDF_RENDER_TIMEOUT_MS }, async () => {
    const input = createPdfInput({ repeatHeader: false, repeatFooter: false })
    const content = requireVersionThreeContent(input)
    const text = (index: number, label: string, multiline = false) => ({
      id: `54000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      type: "text_field" as const,
      fieldKey: `line_${index}`,
      label,
      required: false,
      helpText: null,
      placeholder: null,
      multiline
    })

    content.layout = { ...content.layout, fieldStyle: "line" }
    content.blocks = [
      text(0, "Name"),
      text(1, "Phone"),
      text(2, "Write the full legal name of the business exactly as it appears on its registration certificate"),
      text(3, "Notes", true),
      { id: "54000000-0000-4000-8000-000000000099", type: "signature_field", fieldKey: "sign", label: "Signature", required: false, helpText: null },
      // Rows of fields on lines: a signature beside a date, and a label that wraps beside two that do not.
      { id: "54000000-0000-4000-8000-000000000098", type: "signature_field", fieldKey: "applicant", label: "Applicant signature", required: false, helpText: null },
      { id: "54000000-0000-4000-8000-000000000097", type: "date_field", fieldKey: "signed_on", label: "Date", required: false, helpText: null },
      text(4, "Middle initial"),
      text(5, "First name"),
      text(6, "Last name")
    ]
    content.sections = []
    content.fieldGroups = [
      { id: "54000000-0000-4000-8000-000000000100", label: null, startBlockId: "54000000-0000-4000-8000-000000000098", endBlockId: "54000000-0000-4000-8000-000000000097", columns: 2, widths: [8, 4], keepTogether: false },
      { id: "54000000-0000-4000-8000-000000000101", label: null, startBlockId: text(4, "").id, endBlockId: text(6, "").id, columns: 3, widths: [2, 5, 5], keepTogether: false }
    ]
    content.blockRules = []
    input.answers = { line_0: "Avery Morgan", line_2: "Northstar", line_3: "Call after five." }
    input.signers = []

    const normalized = normalizePdfInput(input)
    const metrics = createPdfLayoutMetrics(normalized.renderPlan.geometry, normalized.renderPlan.layout)
    const pdf = await PDFDocument.load(await renderGeneratedDocumentPdf(input, { fillable: true }))
    const form = pdf.getForm()
    const box = (key: string) => form.getTextField(key).acroField.getWidgets()[0].getRectangle()
    const [name, phone, long, notes] = ["line_0", "line_1", "line_2", "line_3"].map(box)

    // Beside its label, one band tall, and the next field one band and a gap below.
    expect(name.height).toBe(15)
    expect(name.x).toBeGreaterThan(metrics.margin + 20)
    expect(name.x).toBeLessThan(metrics.margin + metrics.contentWidth * 0.45)
    expect(name.y - (phone.y + phone.height)).toBeCloseTo(12, 5)
    // A long label wraps at 45% of the width, and its line starts after it.
    expect(long.x).toBeCloseTo(metrics.margin + metrics.contentWidth * 0.45 + 6, 5)
    expect(long.x + long.width).toBeCloseTo(metrics.margin + metrics.contentWidth, 5)
    expect(long.height).toBeGreaterThanOrEqual(30)
    // A long answer is one multiline field over three ruled lines.
    expect(form.getTextField("line_3").isMultiline()).toBe(true)
    expect(form.getTextField("line_3").acroField.getWidgets()).toHaveLength(1)
    expect(notes).toMatchObject({ height: 60, width: metrics.contentWidth, x: metrics.margin })
    // The signature has no label above it: its caption sits 8pt under its line,
    // which is 56pt under the gap after the notes.
    const captions = drawnTexts(pdf, 0).filter((drawn) => drawn.size === 8)

    expect(captions[0]?.y).toBe(notes.y - 10 - 56 - 2 - 8)
    // Side by side, the date's line is level with the signature's, over its caption.
    expect(box("signed_on").y).toBeCloseTo((captions[1]?.y ?? 0) + 2 + 8, 1)
    // A wrapped label drops nothing: the three lines in its row sit level.
    const [initial, first, last] = ["line_4", "line_5", "line_6"].map(box)

    expect(initial.height).toBe(30)
    expect(first.y).toBeCloseTo(initial.y, 1)
    expect(last.y).toBeCloseTo(initial.y, 1)
    // Printed, an answer beside a wrapped label sits on its last line, just above the rule.
    const printed = await PDFDocument.load(await renderGeneratedDocumentPdf(input))

    expect(drawnTexts(printed, 0).some((drawn) => drawn.size === 10 && Math.abs(drawn.x - long.x) < 0.5 && Math.abs(drawn.y - (long.y + 2 + 15 - 10)) < 0.5)).toBe(true)
  })

  it("prints answers in cells that touch beside and below each other, and stay inside the room the planner left", { timeout: PDF_RENDER_TIMEOUT_MS }, async () => {
    const input = createPdfInput({ repeatHeader: false, repeatFooter: false })
    const content = requireVersionThreeContent(input)
    const text = (index: number, multiline = false, helpText: string | null = null) => ({
      id: `55000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      type: "text_field" as const,
      fieldKey: `cell_${index}`,
      label: `Question ${index + 1}`,
      required: index % 2 === 0,
      helpText,
      placeholder: null,
      multiline
    })

    content.layout = { ...content.layout, fieldStyle: "cell" }
    content.blocks = [text(0), text(1), text(2), { id: "55000000-0000-4000-8000-000000000099", type: "paragraph", text: "Thank you.", alignment: "left" }, text(3)]
    content.sections = []
    content.fieldGroups = [{ id: "55000000-0000-4000-8000-000000000100", label: null, startBlockId: text(0).id, endBlockId: text(1).id, columns: 2, keepTogether: false }]
    content.blockRules = []
    input.answers = { cell_0: "Avery", cell_1: "Morgan", cell_2: "avery@example.com", cell_3: "Yes" }
    input.signers = []

    const normalized = normalizePdfInput(input)
    const metrics = createPdfLayoutMetrics(normalized.renderPlan.geometry, normalized.renderPlan.layout)
    const form = (await PDFDocument.load(await renderGeneratedDocumentPdf(input, { fillable: true }))).getForm()
    const box = (key: string) => form.getTextField(key).acroField.getWidgets()[0].getRectangle()
    const [first, last, email, after] = ["cell_0", "cell_1", "cell_2", "cell_3"].map(box)

    // Side by side, the two cells share one edge: padding each side, less the overlap.
    expect(first.x).toBeCloseTo(metrics.margin + 4, 5)
    expect(last.x - (first.x + first.width)).toBeCloseTo(7.3, 5)
    expect(last.x + last.width).toBeCloseTo(metrics.margin + metrics.contentWidth - 4, 5)
    expect(last.y).toBe(first.y)
    // The next cell sits on the row: padding, less the shared edge, then its label.
    expect(first.y - (email.y + email.height)).toBeCloseTo(4 - 0.7 + 4 + 10 + 2, 5)
    // Around a paragraph, the usual gap: 10 above it, 8 under its line.
    expect(email.y - (after.y + after.height)).toBeCloseTo(4 + 10 + 15 + 8 + 4 + 10 + 2, 5)

    // The worst case: sixty cells with long answers, side by side and alone,
    // carried over pages, every answer inside the page's flow. In the rows, a
    // long answer's lines stand beside short ones whose help hangs lower.
    const inRow = (index: number): boolean => index >= 10 && index <= 39
    const many = Array.from({ length: 60 }, (_value: unknown, index: number) =>
      text(index, index % 3 === 1, index % 3 !== 1 ? "Write it as on your passport, with every name in full, as the office that issued it spells them." : null)
    )

    content.blocks = many
    content.fieldGroups = [{ id: "55000000-0000-4000-8000-000000000100", label: null, startBlockId: many[10].id, endBlockId: many[39].id, columns: 3, keepTogether: false }]
    input.answers = Object.fromEntries(
      many.map((block, index: number) => [block.fieldKey, inRow(index) ? "Yes" : `Answer ${index} ${"long words ".repeat(index * 3).trim()}`])
    )

    const flowBottom = metrics.flowTopY - metrics.pageCapacity

    // On lines too, where a row's lines drop level with its lowest.
    for (const fieldStyle of ["cell", "line"] as const) {
      content.layout = { ...content.layout, fieldStyle }

      const worst = await PDFDocument.load(await renderGeneratedDocumentPdf(input, { fillable: true }))

      expect(worst.getPageCount()).toBeGreaterThan(2)
      // No line of text, help hanging under a row included, prints below the flow.
      worst.getPages().forEach((_page, index: number) => {
        expect(Math.min(...drawnTexts(worst, index).map((drawn) => drawn.y))).toBeGreaterThanOrEqual(flowBottom - 0.5)
      })
      worst.getForm().getFields().forEach((field) => {
        // Under a cell's answer, its padding and any help; under a line, any help after a 3pt gap.
        const help = many.some((block) => block.fieldKey === field.getName() && block.helpText)
        const below = fieldStyle === "cell" ? 4 + (help ? 10 : 0) : help ? 13 : 0

        field.acroField.getWidgets().forEach((widget) => {
          const rectangle = widget.getRectangle()

          expect(rectangle.x).toBeGreaterThanOrEqual(metrics.margin - 0.5)
          expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(metrics.margin + metrics.contentWidth + 0.5)
          expect(rectangle.y).toBeGreaterThanOrEqual(flowBottom + below - 0.5)
          expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(metrics.flowTopY + 0.5)
        })
      })
    }
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

  it("prints a resized page at its new paper size with the original layout scaled up", { timeout: PDF_RENDER_TIMEOUT_MS }, async () => {
    const input = createPdfInput({ repeatHeader: false, repeatFooter: false })
    const content = requireVersionThreeContent(input)
    const a4 = normalizePdfInput(input)
    const a4Metrics = createPdfLayoutMetrics(a4.renderPlan.geometry, a4.renderPlan.layout)
    const a4Pages = createPdfPagePlans(a4)

    content.layout = resizeTemplateLayout(content.layout, { pageSize: "A3" })

    const a3 = normalizePdfInput(input)
    const rendered = await PDFDocument.load(await renderGeneratedDocumentPdf(input))

    // Laid out exactly as on A4, then printed on A3.
    const a3Metrics = createPdfLayoutMetrics(a3.renderPlan.geometry, a3.renderPlan.layout)
    expect(a3Metrics.pageCapacity).toBeCloseTo(a4Metrics.pageCapacity, 0)
    expect(a3Metrics.contentWidth).toBeCloseTo(a4Metrics.contentWidth, 2)
    expect(createPdfPagePlans(a3)).toEqual(a4Pages)
    expect(rendered.getPageCount()).toBe(a4Pages.length)
    expect(rendered.getPage(0).getWidth()).toBeCloseTo(841.89, 1)
    expect(rendered.getPage(0).getHeight()).toBeCloseTo(1190.55, 1)
  })

  it("leaves the title out of a document that prints none", () => {
    const input = createPdfInput({ repeatHeader: false, repeatFooter: false })
    const content = requireVersionThreeContent(input)
    content.layout = { ...content.layout, printedTitle: { mode: "none" } }

    const pages = createPdfPagePlans(normalizePdfInput(input))

    expect(pages.flatMap((page) => page.items).some((item) => item.kind === "title")).toBe(false)
  })

  it("prints a default A4 page inside the margins the editor draws", () => {
    const normalized = normalizePdfInput(
      createPdfInput({ repeatHeader: true, repeatFooter: true })
    )
    const { geometry } = normalized.renderPlan
    const metrics = createPdfLayoutMetrics(geometry, normalized.renderPlan.layout)

    expect(metrics).toMatchObject({
      contentWidth: geometry.widthPoints - geometry.margins.left - geometry.margins.right,
      flowTopY: geometry.heightPoints - geometry.margins.top,
      pageCapacity: geometry.heightPoints - geometry.margins.top - geometry.margins.bottom,
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

  it("refuses a PNG image block over 16 megapixels", async () => {
    const input = createPdfInput({ repeatHeader: false, repeatFooter: false })

    requireVersionThreeContent(input).blocks.push({
      id: "00000000-0000-4000-8000-000000000010",
      type: "image",
      dataUrl: toImageDataUrl("png", createPngBytes(4_001, 4_000)),
      altText: "Site plan",
      caption: null,
      alignment: "center",
      widthPercent: 100
    })

    await expect(renderGeneratedDocumentPdf(input)).rejects.toMatchObject({
      statusCode: 400,
      message: "An embedded document image is too large."
    })
  })

  it("embeds a logo repeated on every page once", async () => {
    const input = createPdfInput({
      longBody: true,
      repeatHeader: true,
      repeatFooter: false
    })
    const content = requireVersionThreeContent(input)

    content.branding = {
      ...content.branding,
      logoDataUrl: toImageDataUrl("png", createPngBytes(120, 40))
    }

    const bytes = await renderGeneratedDocumentPdf({ ...input, signers: [] })
    const pdf = await PDFDocument.load(bytes)
    const pagesShowingAnImage = pdf
      .getPages()
      .filter(
        (page): boolean =>
          page.node.Resources()?.has(PDFName.of("XObject")) ?? false
      )

    expect(pdf.getPageCount()).toBeGreaterThan(1)
    expect(pagesShowingAnImage).toHaveLength(pdf.getPageCount())
    // One image object serves every page. The render's image cache is also
    // what its PNG pixel allowance is counted from.
    expect(bytes.toString("latin1").match(/\/Subtype \/Image/g)).toHaveLength(1)
  })
}, PDF_RENDER_TIMEOUT_MS)

// Where each piece of text on a page is drawn, and at what size, read from its content.
function drawnTexts(pdf: PDFDocument, pageIndex: number): Array<{ size: number; x: number; y: number }> {
  const contents = pdf.getPage(pageIndex).node.Contents()
  const entries = contents instanceof PDFArray ? contents.asArray() : [contents]
  const source = entries
    .map((entry) => {
      const stream = entry instanceof PDFRef ? pdf.context.lookup(entry) : entry

      return stream instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1") : ""
    })
    .join("\n")

  return source.split("BT").slice(1).flatMap((piece: string) => {
    const size = /([\d.]+) Tf/.exec(piece)
    const at = /(-?[\d.]+) (-?[\d.]+) Tm/.exec(piece)

    return size && at ? [{ size: Number(size[1]), x: Number(at[1]), y: Number(at[2]) }] : []
  })
}

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
    return item.cells.flatMap((cell) => (cell ? [cell.block.id] : []))
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
