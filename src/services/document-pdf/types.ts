import type {
  TemplateRenderBlock,
  TemplateRenderPlan
} from "@/services/templates/template-render-plan"
import type { BlockFrame, TemplateBlock, TemplateContent } from "@/types/template"

export type PdfTextAlignment = "left" | "center" | "right"

export type DocumentPdfSigner = {
  id: string
  name: string
  email: string
  requiresSignature: boolean
  status: "pending" | "viewed" | "signed"
  signedAt: string | null
  signatureDataUrl?: string | null
  initialsDataUrl?: string | null
}

export type RenderGeneratedDocumentPdfInput = {
  documentId: string
  title: string
  content: unknown
  answers: Record<string, unknown>
  workflowStatus: "draft" | "awaiting_signatures" | "completed"
  signers?: DocumentPdfSigner[]
  metadataTimestamp?: string
}

export type NormalizedPdfInput = Omit<
  RenderGeneratedDocumentPdfInput,
  "content"
> & {
  content: TemplateContent
  renderPlan: TemplateRenderPlan
  signers: DocumentPdfSigner[]
}

export type PdfBlockFlowItem = {
  kind: "block"
  block: TemplateBlock
  renderBlock: TemplateRenderBlock
  answerOverride?: string
  fieldContinued?: boolean
  listMarkers?: string[]
  /** Where it sits across the page, when not across the whole of it. */
  frame?: BlockFrame
  /** A cell that the next cell on its page sits on, with no gap between. */
  joinsNext?: boolean
  /** A grid's or table's rows this piece prints, each with its place among them. */
  rows?: ReadonlyArray<Readonly<{ cells: readonly string[]; index: number }>>
  /** Rows printed straight under the piece above, without the title and header row. */
  joinsAbove?: boolean
  /** A grid's or table's last piece, which its help follows. */
  last?: boolean
}

/** Where an item of a boxed section sits in its box: whether it opens it, closes it, or both. */
export type PdfSectionBox = Readonly<{ closes: boolean; opens: boolean; sectionId: string }>

export type PdfFlowItem = (
  | { kind: "branding" }
  | { kind: "title"; title: string }
  | { kind: "section_label"; label: string }
  | { kind: "field_group_label"; label: string }
  | PdfBlockFlowItem
  | {
      kind: "columns"
      /** Each column's width in twelfths of the content width. */
      widths: readonly number[]
      /** One cell per column, left to right; null where a column is empty. */
      cells: readonly (PdfBlockFlowItem | null)[]
      /** A row of cells that the next cell on its page sits on, with no gap between. */
      joinsNext?: boolean
    }
  /** Space left above a block, in points. */
  | { kind: "space"; height: number }
  | { kind: "signing_intro" }
  | { kind: "signer"; signer: DocumentPdfSigner }
) & {
  /** In a boxed section, laid out inside its box. */
  box?: PdfSectionBox
}

export type PdfPagePlan = {
  items: PdfFlowItem[]
  showFooter: boolean
  showHeader: boolean
  showPageNumber: boolean
}

export type PdfFieldBlock = Exclude<
  TemplateBlock,
  | { type: "heading" }
  | { type: "paragraph" }
  | { type: "bullet_list" }
  | { type: "numbered_list" }
  | { type: "image" }
  | { type: "table" }
  | { type: "divider" }
>
