import type { S3Client } from "@aws-sdk/client-s3"

import type { R2Env } from "@/lib/env"
import type { AdminSupabaseClient } from "@/lib/supabase/admin"
import type { RenderGeneratedDocumentPdfInput } from "@/services/document-pdf-service"
import type { GeneratedDocumentSigningView } from "@/types/signing"

/** Identifiers required to finalize one completed generated document. */
export type FinalizeGeneratedDocumentPdfInput = {
  actorUserId: string
  organizationId: string
  documentId: string
}

/** Stable identifiers returned after an immutable final PDF is promoted. */
export type FinalizeGeneratedDocumentPdfResult = {
  finalizationId: string
  versionId: string
}

/** Persisted state of one generated-document finalization attempt. */
export type GeneratedDocumentFinalizationRecord = {
  id: string
  status: "pending" | "finalized"
  storageKey: string
  renderInputSha256: string
  pdfSha256: string | null
  byteSize: number | null
  documentVersionId: string | null
  createdAt: string
}

/** Values used by the database to allocate or reconcile a pending finalization. */
export type PrepareGeneratedDocumentFinalizationInput = {
  organizationId: string
  documentId: string
  finalizationId: string
  storageKey: string
  renderInputSha256: string
  createdBy: string
}

/** Values used to atomically promote rendered bytes to a document version. */
export type PromoteGeneratedDocumentFinalizationInput = {
  organizationId: string
  documentId: string
  finalizationId: string
  pdfSha256: string
  byteSize: number
  originalFilename: string
  finalizedBy: string
}

/** Persistence port used by the application finalization use case. */
export type GeneratedDocumentFinalizationPersistence = {
  requireViewPermission: (
    input: FinalizeGeneratedDocumentPdfInput
  ) => Promise<void>
  findByDocument: (
    organizationId: string,
    documentId: string
  ) => Promise<GeneratedDocumentFinalizationRecord | null>
  prepare: (
    input: PrepareGeneratedDocumentFinalizationInput
  ) => Promise<GeneratedDocumentFinalizationRecord>
  promote: (
    input: PromoteGeneratedDocumentFinalizationInput
  ) => Promise<string>
}

/** Bytes and immutable metadata passed to the private storage adapter. */
export type StoreGeneratedDocumentFinalPdfInput = {
  organizationId: string
  documentId: string
  finalizationId: string
  storageKey: string
  pdf: Buffer
  pdfSha256: string
}

/** Private object-storage port used by the finalization use case. */
export type GeneratedDocumentFinalizationStorage = {
  store: (input: StoreGeneratedDocumentFinalPdfInput) => Promise<void>
}

/** Focused loader for the tenant-scoped generated signing view. */
export type GeneratedDocumentSigningViewLoader = (
  input: FinalizeGeneratedDocumentPdfInput
) => Promise<GeneratedDocumentSigningView>

/** Focused renderer for an immutable generated-document snapshot. */
export type GeneratedDocumentFinalPdfRenderer = (
  input: RenderGeneratedDocumentPdfInput
) => Promise<Buffer>

/** Injectable dependencies for deterministic finalization and focused tests. */
export type GeneratedDocumentFinalizationServiceDeps = {
  client?: AdminSupabaseClient
  persistence?: GeneratedDocumentFinalizationPersistence
  storage?: GeneratedDocumentFinalizationStorage
  loadSigningView?: GeneratedDocumentSigningViewLoader
  renderPdf?: GeneratedDocumentFinalPdfRenderer
  createId?: () => string
  clock?: () => number
  r2Client?: S3Client
  r2Env?: R2Env
  putObject?: FinalizationPutObject
  headObject?: FinalizationHeadObject
}

/** Minimal conditional PUT command executor used by the R2 adapter. */
export type FinalizationPutObject = (
  client: S3Client,
  command: import("@aws-sdk/client-s3").PutObjectCommand
) => Promise<import("@aws-sdk/client-s3").PutObjectCommandOutput>

/** Minimal HEAD command executor used to reconcile conditional-write races. */
export type FinalizationHeadObject = (
  client: S3Client,
  command: import("@aws-sdk/client-s3").HeadObjectCommand
) => Promise<import("@aws-sdk/client-s3").HeadObjectCommandOutput>
