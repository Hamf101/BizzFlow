import { describe, expect, it } from "vitest"

import {
  parseSubmissionFileRow,
  parseSubmissionRow,
  SubmissionDomainError,
} from "@/types/submission"
import { createBlankTemplateContent } from "@/types/template"

const SUBMISSION_ID = "10000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001"
const TEMPLATE_ID = "30000000-0000-4000-8000-000000000001"
const USER_ID = "40000000-0000-4000-8000-000000000001"
const FILE_ID = "50000000-0000-4000-8000-000000000001"
const CREATED_AT = "2026-07-18T15:00:00.000Z"
const UPDATED_AT = "2026-07-18T16:00:00.000Z"
const EXPECTED_CHECKSUM = "a".repeat(64)

const DRAFT_ROW = {
  id: SUBMISSION_ID,
  org_id: ORGANIZATION_ID,
  title: "Vendor onboarding",
  template_id: TEMPLATE_ID,
  template_revision: 3,
  template_snapshot: createBlankTemplateContent(),
  values: { vendor_name: "Northstar Labs", confirmed: true },
  status: "draft",
  revision: 2,
  created_by: USER_ID,
  updated_by: USER_ID,
  submitted_by: null,
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
  submitted_at: null,
}

const PENDING_FILE_ROW = {
  id: FILE_ID,
  org_id: ORGANIZATION_ID,
  submission_id: SUBMISSION_ID,
  field_key: "insurance_certificate",
  status: "upload_pending",
  storage_key: `organizations/${ORGANIZATION_ID}/submissions/${SUBMISSION_ID}/files/insurance_certificate/${FILE_ID}/certificate.pdf`,
  original_filename: "certificate.pdf",
  safe_filename: "certificate.pdf",
  content_type: "application/pdf",
  byte_size: 12_345,
  expected_checksum_sha256: EXPECTED_CHECKSUM,
  checksum_sha256: null,
  available_at: null,
  uploaded_by: USER_ID,
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
}

describe("submission persistence types", () => {
  it("parses and maps a draft submission row", () => {
    const submission = parseSubmissionRow({
      ...DRAFT_ROW,
      ignored_rpc_metadata: "forward-compatible",
    })

    expect(submission).toEqual({
      id: SUBMISSION_ID,
      organizationId: ORGANIZATION_ID,
      title: "Vendor onboarding",
      templateId: TEMPLATE_ID,
      templateRevision: 3,
      templateSnapshot: DRAFT_ROW.template_snapshot,
      values: DRAFT_ROW.values,
      status: "draft",
      revision: 2,
      createdBy: USER_ID,
      updatedBy: USER_ID,
      submittedBy: null,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      submittedAt: null,
    })
  })

  it("preserves submitted lifecycle metadata", () => {
    const submission = parseSubmissionRow({
      ...DRAFT_ROW,
      status: "submitted",
      submitted_by: USER_ID,
      submitted_at: UPDATED_AT,
    })

    expect(submission.status).toBe("submitted")
    expect(submission.submittedBy).toBe(USER_ID)
    expect(submission.submittedAt).toBe(UPDATED_AT)
  })

  it.each([
    {
      row: { ...DRAFT_ROW, status: "approved" },
      reason: "unsupported status",
    },
    {
      row: { ...DRAFT_ROW, submitted_at: UPDATED_AT },
      reason: "draft with submission metadata",
    },
    {
      row: { ...DRAFT_ROW, template_snapshot: { schemaVersion: 1 } },
      reason: "invalid snapshot",
    },
    {
      row: { ...DRAFT_ROW, values: { vendor_name: { nested: true } } },
      reason: "non-scalar answers",
    },
  ])("rejects an invalid submission row: $reason", ({ row }) => {
    expect(() => parseSubmissionRow(row)).toThrowError(
      expect.objectContaining<Partial<SubmissionDomainError>>({
        code: "invalid_submission_row",
        statusCode: 500,
      })
    )
  })

  it("parses pending and available single-file metadata", () => {
    expect(parseSubmissionFileRow(PENDING_FILE_ROW)).toEqual({
      id: FILE_ID,
      organizationId: ORGANIZATION_ID,
      submissionId: SUBMISSION_ID,
      fieldKey: "insurance_certificate",
      status: "upload_pending",
      storageKey: PENDING_FILE_ROW.storage_key,
      originalFilename: "certificate.pdf",
      safeFilename: "certificate.pdf",
      contentType: "application/pdf",
      byteSize: 12_345,
      expectedChecksumSha256: EXPECTED_CHECKSUM,
      checksumSha256: null,
      availableAt: null,
      uploadedBy: USER_ID,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    })

    const checksum = "b".repeat(64)
    const availableFile = parseSubmissionFileRow({
      ...PENDING_FILE_ROW,
      status: "available",
      checksum_sha256: checksum,
      available_at: UPDATED_AT,
    })

    expect(availableFile.status).toBe("available")
    expect(availableFile.checksumSha256).toBe(checksum)
    expect(availableFile.availableAt).toBe(UPDATED_AT)
  })

  it("accepts legacy active files without expected or verified checksums", () => {
    const pendingFile = parseSubmissionFileRow({
      ...PENDING_FILE_ROW,
      expected_checksum_sha256: null,
    })
    const availableFile = parseSubmissionFileRow({
      ...PENDING_FILE_ROW,
      status: "available",
      expected_checksum_sha256: null,
      available_at: UPDATED_AT,
    })

    expect(pendingFile.expectedChecksumSha256).toBeNull()
    expect(pendingFile.checksumSha256).toBeNull()
    expect(availableFile.expectedChecksumSha256).toBeNull()
    expect(availableFile.checksumSha256).toBeNull()
  })

  it.each([
    {
      row: { ...PENDING_FILE_ROW, status: "superseded" },
      reason: "superseded row outside the active-file union",
    },
    {
      row: { ...PENDING_FILE_ROW, checksum_sha256: "a".repeat(64) },
      reason: "pending file with a checksum",
    },
    {
      row: { ...PENDING_FILE_ROW, status: "available" },
      reason: "available file without an availability timestamp",
    },
    {
      row: {
        ...PENDING_FILE_ROW,
        expected_checksum_sha256: "not-a-checksum",
      },
      reason: "invalid expected checksum",
    },
    {
      row: {
        ...PENDING_FILE_ROW,
        status: "available",
        checksum_sha256: "not-a-checksum",
        available_at: UPDATED_AT,
      },
      reason: "invalid available checksum",
    },
    {
      row: { ...PENDING_FILE_ROW, field_key: "not a key" },
      reason: "invalid field key",
    },
    {
      row: { ...PENDING_FILE_ROW, safe_filename: "../unsafe.pdf" },
      reason: "unsafe filename",
    },
  ])("rejects an invalid submission file row: $reason", ({ row }) => {
    expect(() => parseSubmissionFileRow(row)).toThrowError(
      expect.objectContaining<Partial<SubmissionDomainError>>({
        code: "invalid_submission_file_row",
        statusCode: 500,
      })
    )
  })
})
