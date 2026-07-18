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
}

export type NormalizedPdfInput = Omit<
  RenderGeneratedDocumentPdfInput,
  "content"
> & {
  content: TemplateContent
  signers: DocumentPdfSigner[]
}

export type PdfFlowItem =
  | { kind: "branding" }
  | { kind: "title" }
  | {
      kind: "block"
      block: TemplateBlock
      answerOverride?: string
      fieldContinued?: boolean
      listMarkers?: string[]
    }
  | { kind: "signing_intro" }
  | { kind: "signer"; signer: DocumentPdfSigner }

export type PdfPagePlan = {
  items: PdfFlowItem[]
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
