import type {
  TemplateRenderBlock,
  TemplateRenderPlan
} from "@/services/templates/template-render-plan"
import type { TemplateBlock, TemplateContent } from "@/types/template"

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
}

export type PdfFlowItem =
  | { kind: "branding" }
  | { kind: "title"; title: string }
  | { kind: "section_label"; label: string }
  | { kind: "field_group_label"; label: string }
  | PdfBlockFlowItem
  | {
      kind: "columns"
      left?: PdfBlockFlowItem
      right?: PdfBlockFlowItem
    }
  | { kind: "signing_intro" }
  | { kind: "signer"; signer: DocumentPdfSigner }

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
