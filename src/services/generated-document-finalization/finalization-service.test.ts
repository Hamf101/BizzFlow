import { describe, expect, it, vi } from "vitest"

import {
  finalizeGeneratedDocumentPdf,
  type FinalizeGeneratedDocumentPdfInput,
} from "@/services/generated-document-finalization-service"
import type {
  GeneratedDocumentFinalizationPersistence,
  GeneratedDocumentFinalizationRecord,
  GeneratedDocumentFinalizationStorage,
} from "@/services/generated-document-finalization/contracts"
import { buildGeneratedDocumentFinalizationStorageKey } from "@/services/generated-document-finalization/domain"
import { buildCanonicalFinalizationRenderInput } from "@/services/generated-document-finalization/render-input"
import type { RenderGeneratedDocumentPdfInput } from "@/services/document-pdf-service"
import type { GeneratedDocumentSigningView } from "@/types/signing"
import { createBlankTemplateContent } from "@/types/template"

const ACTOR_ID = "10000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001"
const DOCUMENT_ID = "30000000-0000-4000-8000-000000000001"
const FINALIZATION_ID = "40000000-0000-4000-8000-000000000001"
const WINNER_FINALIZATION_ID = "40000000-0000-4000-8000-000000000002"
const VERSION_ID = "50000000-0000-4000-8000-000000000001"
const CREATED_AT = "2026-07-18T07:08:09.987Z"
const PDF = Buffer.from("%PDF-1.7\nimmutable-test-pdf")

const input: FinalizeGeneratedDocumentPdfInput = {
  actorUserId: ACTOR_ID,
  organizationId: ORGANIZATION_ID,
  documentId: DOCUMENT_ID,
}

describe("generated document finalization service", () => {
  it("returns the exact finalized version without loading, rendering, or uploading", async () => {
    const view = createSigningView("completed")
    const renderHash = buildCanonicalFinalizationRenderInput(view).sha256
    const persistence = createPersistence({
      existing: createFinalizationRecord({
        status: "finalized",
        renderInputSha256: renderHash,
        pdfSha256: "a".repeat(64),
        byteSize: PDF.length,
        documentVersionId: VERSION_ID,
      }),
    })
    const loadSigningView = vi.fn(async () => view)
    const renderPdf = vi.fn(async () => PDF)
    const storage = createStorage()

    const result = await finalizeGeneratedDocumentPdf(input, {
      persistence,
      loadSigningView,
      renderPdf,
      storage,
    })

    expect(result).toEqual({
      finalizationId: FINALIZATION_ID,
      versionId: VERSION_ID,
    })
    expect(persistence.requireViewPermission).toHaveBeenCalledOnce()
    expect(loadSigningView).not.toHaveBeenCalled()
    expect(renderPdf).not.toHaveBeenCalled()
    expect(storage.store).not.toHaveBeenCalled()
    expect(persistence.prepare).not.toHaveBeenCalled()
    expect(persistence.promote).not.toHaveBeenCalled()
  })

  it("allocates, renders, stores, and promotes a new completed finalization", async () => {
    const view = createSigningView("completed")
    const persistence = createPersistence()
    const storage = createStorage()
    const renderPdf = vi.fn(async () => PDF)

    const result = await finalizeGeneratedDocumentPdf(input, {
      persistence,
      loadSigningView: async () => view,
      renderPdf,
      storage,
      createId: () => FINALIZATION_ID,
    })

    expect(result).toEqual({
      finalizationId: FINALIZATION_ID,
      versionId: VERSION_ID,
    })
    expect(renderPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: DOCUMENT_ID,
        workflowStatus: "completed",
        metadataTimestamp: "2026-07-18T07:08:09.000Z",
      })
    )
    expect(storage.store).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        documentId: DOCUMENT_ID,
        finalizationId: FINALIZATION_ID,
        storageKey: buildGeneratedDocumentFinalizationStorageKey(
          ORGANIZATION_ID,
          DOCUMENT_ID,
          FINALIZATION_ID
        ),
        pdf: PDF,
        pdfSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    )
    expect(persistence.promote).toHaveBeenCalledWith(
      expect.objectContaining({
        finalizationId: FINALIZATION_ID,
        byteSize: PDF.length,
        originalFilename: "Quarterly-service-agreement-final.pdf",
      })
    )
  })

  it("reuses a pending finalization without generating a new id", async () => {
    const view = createSigningView("completed")
    const renderHash = buildCanonicalFinalizationRenderInput(view).sha256
    const existing = createFinalizationRecord({
      renderInputSha256: renderHash,
    })
    const persistence = createPersistence({ existing })
    const createId = vi.fn(() => "60000000-0000-4000-8000-000000000001")

    const result = await finalizeGeneratedDocumentPdf(input, {
      persistence,
      loadSigningView: async () => view,
      renderPdf: async () => PDF,
      storage: createStorage(),
      createId,
    })

    expect(result.finalizationId).toBe(FINALIZATION_ID)
    expect(createId).not.toHaveBeenCalled()
    expect(persistence.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        finalizationId: FINALIZATION_ID,
        storageKey: existing.storageKey,
      })
    )
  })

  it("joins a concurrent prepare winner with a different id and key", async () => {
    const view = createSigningView("completed")
    const renderHash = buildCanonicalFinalizationRenderInput(view).sha256
    const winnerStorageKey = buildGeneratedDocumentFinalizationStorageKey(
      ORGANIZATION_ID,
      DOCUMENT_ID,
      WINNER_FINALIZATION_ID
    )
    const persistence = createPersistence({
      prepared: createFinalizationRecord({
        id: WINNER_FINALIZATION_ID,
        storageKey: winnerStorageKey,
        renderInputSha256: renderHash,
      }),
    })
    const storage = createStorage()

    const result = await finalizeGeneratedDocumentPdf(input, {
      persistence,
      loadSigningView: async () => view,
      renderPdf: async () => PDF,
      storage,
      createId: () => FINALIZATION_ID,
    })

    expect(persistence.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ finalizationId: FINALIZATION_ID })
    )
    expect(storage.store).toHaveBeenCalledWith(
      expect.objectContaining({
        finalizationId: WINNER_FINALIZATION_ID,
        storageKey: winnerStorageKey,
      })
    )
    expect(result).toEqual({
      finalizationId: WINNER_FINALIZATION_ID,
      versionId: VERSION_ID,
    })
  })

  it("returns when a concurrent winner finalizes during prepare", async () => {
    const view = createSigningView("completed")
    const renderHash = buildCanonicalFinalizationRenderInput(view).sha256
    const persistence = createPersistence({
      prepared: createFinalizationRecord({
        status: "finalized",
        renderInputSha256: renderHash,
        pdfSha256: "b".repeat(64),
        byteSize: PDF.length,
        documentVersionId: VERSION_ID,
      }),
    })
    const renderPdf = vi.fn(async () => PDF)
    const storage = createStorage()

    const result = await finalizeGeneratedDocumentPdf(input, {
      persistence,
      loadSigningView: async () => view,
      renderPdf,
      storage,
      createId: () => FINALIZATION_ID,
    })

    expect(result).toEqual({
      finalizationId: FINALIZATION_ID,
      versionId: VERSION_ID,
    })
    expect(renderPdf).not.toHaveBeenCalled()
    expect(storage.store).not.toHaveBeenCalled()
    expect(persistence.promote).not.toHaveBeenCalled()
  })

  it("rejects a document that is not completed before preparation", async () => {
    const persistence = createPersistence()
    const renderPdf = vi.fn(async () => PDF)
    const storage = createStorage()

    await expect(
      finalizeGeneratedDocumentPdf(input, {
        persistence,
        loadSigningView: async () => createSigningView("awaiting_signatures"),
        renderPdf,
        storage,
        createId: () => FINALIZATION_ID,
      })
    ).rejects.toMatchObject({
      message: "Only completed generated documents can be finalized.",
      statusCode: 409,
    })

    expect(persistence.prepare).not.toHaveBeenCalled()
    expect(renderPdf).not.toHaveBeenCalled()
    expect(storage.store).not.toHaveBeenCalled()
  })

  it("fails closed when prepare returns a different render-input hash", async () => {
    const persistence = createPersistence({
      prepared: createFinalizationRecord({
        renderInputSha256: "f".repeat(64),
      }),
    })
    const renderPdf = vi.fn(async () => PDF)
    const storage = createStorage()

    await expect(
      finalizeGeneratedDocumentPdf(input, {
        persistence,
        loadSigningView: async () => createSigningView("completed"),
        renderPdf,
        storage,
        createId: () => FINALIZATION_ID,
      })
    ).rejects.toMatchObject({
      message: "Generated document finalization state does not match this render.",
      statusCode: 409,
    })

    expect(renderPdf).not.toHaveBeenCalled()
    expect(storage.store).not.toHaveBeenCalled()
    expect(persistence.promote).not.toHaveBeenCalled()
  })

  it("hashes document-derived input before adding second-precision DB metadata", async () => {
    const view = createSigningView("completed")
    const expectedBase = buildCanonicalFinalizationRenderInput(view)
    const persistence = createPersistence()
    let renderedInput: RenderGeneratedDocumentPdfInput | undefined

    await finalizeGeneratedDocumentPdf(input, {
      persistence,
      loadSigningView: async () => view,
      renderPdf: async (renderInput: RenderGeneratedDocumentPdfInput) => {
        renderedInput = renderInput
        return PDF
      },
      storage: createStorage(),
      createId: () => FINALIZATION_ID,
    })

    expect(persistence.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        renderInputSha256: expectedBase.sha256,
      })
    )
    expect(renderedInput?.metadataTimestamp).toBe(
      "2026-07-18T07:08:09.000Z"
    )
    expect(expectedBase.input.metadataTimestamp).toBeUndefined()
    expect(renderedInput?.signers?.map((signer) => signer.id)).toEqual([
      "70000000-0000-4000-8000-000000000001",
      "70000000-0000-4000-8000-000000000002",
    ])
  })
})

function createPersistence(options: {
  existing?: GeneratedDocumentFinalizationRecord | null
  prepared?: GeneratedDocumentFinalizationRecord
} = {}): GeneratedDocumentFinalizationPersistence {
  const requireViewPermission = vi.fn(async (): Promise<void> => undefined)
  const findByDocument = vi.fn(
    async (): Promise<GeneratedDocumentFinalizationRecord | null> =>
      options.existing ?? null
  )
  const prepare = vi.fn(
    async (prepareInput): Promise<GeneratedDocumentFinalizationRecord> =>
      options.prepared ??
      createFinalizationRecord({
        id: prepareInput.finalizationId,
        storageKey: prepareInput.storageKey,
        renderInputSha256: prepareInput.renderInputSha256,
      })
  )
  const promote = vi.fn(async (): Promise<string> => VERSION_ID)

  return { requireViewPermission, findByDocument, prepare, promote }
}

function createStorage(): GeneratedDocumentFinalizationStorage & {
  store: ReturnType<typeof vi.fn>
} {
  return {
    store: vi.fn(async (): Promise<void> => undefined),
  }
}

function createFinalizationRecord(
  overrides: Partial<GeneratedDocumentFinalizationRecord> = {}
): GeneratedDocumentFinalizationRecord {
  return {
    id: FINALIZATION_ID,
    status: "pending",
    storageKey: buildGeneratedDocumentFinalizationStorageKey(
      ORGANIZATION_ID,
      DOCUMENT_ID,
      FINALIZATION_ID
    ),
    renderInputSha256: "a".repeat(64),
    pdfSha256: null,
    byteSize: null,
    documentVersionId: null,
    createdAt: CREATED_AT,
    ...overrides,
  }
}

function createSigningView(
  workflowStatus: "draft" | "awaiting_signatures" | "completed"
): GeneratedDocumentSigningView {
  return {
    organizationName: "BizFlow Studio",
    document: {
      id: DOCUMENT_ID,
      organizationId: ORGANIZATION_ID,
      folderId: null,
      title: "Quarterly service agreement",
      description: null,
      sourceKind: "generated",
      templateId: null,
      templateRevision: 1,
      templateSnapshot: createBlankTemplateContent(),
      createdBy: ACTOR_ID,
      updatedBy: ACTOR_ID,
      archivedAt: null,
      createdAt: "2026-07-18T01:00:00.000Z",
      updatedAt: "2026-07-18T02:00:00.000Z",
    },
    answers: {
      zeta: "last key",
      alpha: "first key",
    },
    workflowStatus,
    recipients: [
      {
        id: "70000000-0000-4000-8000-000000000002",
        organizationId: ORGANIZATION_ID,
        documentId: DOCUMENT_ID,
        userId: null,
        name: "Second signer",
        email: "second@example.com",
        requiresSignature: true,
        status: "signed",
        tokenExpiresAt: "2026-07-25T00:00:00.000Z",
        invitedAt: "2026-07-18T04:00:00.000Z",
        viewedAt: "2026-07-18T04:15:00.000Z",
        signedAt: "2026-07-18T04:30:00.000Z",
        signatureDataUrl: null,
        initialsDataUrl: null,
      },
      {
        id: "70000000-0000-4000-8000-000000000001",
        organizationId: ORGANIZATION_ID,
        documentId: DOCUMENT_ID,
        userId: null,
        name: "First signer",
        email: "first@example.com",
        requiresSignature: true,
        status: "signed",
        tokenExpiresAt: "2026-07-25T00:00:00.000Z",
        invitedAt: "2026-07-18T03:00:00.000Z",
        viewedAt: "2026-07-18T03:15:00.000Z",
        signedAt: "2026-07-18T03:30:00.000Z",
        signatureDataUrl: null,
        initialsDataUrl: null,
      },
    ],
  }
}
