import { describe, expect, it } from "vitest"

import {
  completePublicFormFileUpload,
  createPublicFormFileUploadUrl,
  createPublicFormLink,
  getPublicFormDraftState,
  getPublicFormLinkByToken,
  savePublicFormDraft,
  submitPublicForm,
  supersedePublicFormFile,
} from "@/services/public-form-service"
import {
  CHECKSUM,
  createDeps,
  createDraftRow,
  createFileRow,
  createLinkRow,
  createTemplateContent,
  createTemplateRow,
  DRAFT_TOKEN,
  FakePublicFormClient,
  FILE_ID,
  LINK_ID,
  MANAGER_ID,
  ORG_ID,
  OTHER_DRAFT_TOKEN,
  OTHER_ORG_ID,
  PUBLIC_TOKEN,
  SUBMISSION_ID,
  TEMPLATE_ID,
  type FakeRow,
  type FakeTableName,
} from "@/services/public-form-service.test-support"
import {
  templateContentV3Schema,
  type TemplateContentV3,
} from "@/types/template"

function seedValidLink(
  extra: Partial<Record<FakeTableName, FakeRow[]>> = {}
): FakePublicFormClient {
  return new FakePublicFormClient({
    document_templates: [createTemplateRow()],
    public_form_links: [createLinkRow()],
    organizations: [{ id: ORG_ID, name: "Acme" }],
    ...extra,
  })
}

describe("createPublicFormLink", () => {
  it("reads the template from document_templates and stores the link", async () => {
    const client = new FakePublicFormClient({
      document_templates: [createTemplateRow()],
    })

    const link = await createPublicFormLink(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        templateId: TEMPLATE_ID,
        maxSubmissions: 5,
      },
      createDeps(client, [LINK_ID])
    )

    expect(link.token).toBe(PUBLIC_TOKEN)
    expect(link.maxSubmissions).toBe(5)
    expect(client.tables.public_form_links).toHaveLength(1)
  })

  it("rejects a template that belongs to another organization", async () => {
    const client = new FakePublicFormClient({
      document_templates: [createTemplateRow({ org_id: OTHER_ORG_ID })],
    })

    await expect(
      createPublicFormLink(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          templateId: TEMPLATE_ID,
        },
        createDeps(client, [LINK_ID])
      )
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("rejects an unpublished template", async () => {
    const client = new FakePublicFormClient({
      document_templates: [createTemplateRow({ status: "draft" })],
    })

    await expect(
      createPublicFormLink(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          templateId: TEMPLATE_ID,
        },
        createDeps(client, [LINK_ID])
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe("getPublicFormLinkByToken", () => {
  it("resolves an active link with its template", async () => {
    const preview = await getPublicFormLinkByToken(
      PUBLIC_TOKEN,
      createDeps(seedValidLink())
    )

    expect(preview.valid).toBe(true)
    expect(preview.template?.id).toBe(TEMPLATE_ID)
    expect(preview.organizationName).toBe("Acme")
  })

  it.each([
    ["disabled", { status: "disabled" }, "disabled"],
    ["expired", { expires_at: "2026-07-30T00:00:00.000Z" }, "expired"],
    [
      "at its submission ceiling",
      { max_submissions: 2, submission_count: 2 },
      "max_submissions_reached",
    ],
  ])("reports a link that is %s", async (_label, overrides, reason) => {
    const client = new FakePublicFormClient({
      document_templates: [createTemplateRow()],
      public_form_links: [createLinkRow(overrides)],
    })

    const preview = await getPublicFormLinkByToken(
      PUBLIC_TOKEN,
      createDeps(client)
    )

    expect(preview.valid).toBe(false)
    expect(preview.invalidReason).toBe(reason)
    expect(preview.template).toBeNull()
  })

  it("reports not_found for an unknown token", async () => {
    const preview = await getPublicFormLinkByToken(
      "no-such-token",
      createDeps(seedValidLink())
    )

    expect(preview.invalidReason).toBe("not_found")
  })
})

describe("createPublicFormFileUploadUrl", () => {
  it("allocates a draft submission that parents the file", async () => {
    const client = seedValidLink()

    const result = await createPublicFormFileUploadUrl(
      {
        token: PUBLIC_TOKEN,
        fieldKey: "evidence",
        originalFilename: "evidence.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
        checksumSha256: CHECKSUM,
      },
      createDeps(client, [SUBMISSION_ID, FILE_ID])
    )

    expect(result.draftToken).toBe(DRAFT_TOKEN)

    expect(client.tables.submissions[0]).toMatchObject({
      id: SUBMISSION_ID,
      status: "draft",
      public_form_link_id: LINK_ID,
      public_draft_token: DRAFT_TOKEN,
      submitted_at: null,
    })

    // The object key must embed the real submission id, or the database's
    // submission_files_storage_key_check rejects the row outright.
    const file = client.tables.submission_files[0]
    expect(file.submission_id).toBe(SUBMISSION_ID)
    expect(file.storage_key).toContain(`/submissions/${SUBMISSION_ID}/`)
    expect(file.status).toBe("upload_pending")
    expect(file.checksum_sha256).toBeNull()
  })

  it("reuses the draft when a valid handle is supplied", async () => {
    const client = seedValidLink({ submissions: [createDraftRow()] })

    const result = await createPublicFormFileUploadUrl(
      {
        token: PUBLIC_TOKEN,
        draftToken: DRAFT_TOKEN,
        fieldKey: "evidence",
        originalFilename: "evidence.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
        checksumSha256: CHECKSUM,
      },
      createDeps(client, [FILE_ID])
    )

    expect(result.draftToken).toBe(DRAFT_TOKEN)
    expect(client.tables.submissions).toHaveLength(1)
  })

  it("refuses a handle that belongs to a different link", async () => {
    const client = seedValidLink({
      submissions: [
        createDraftRow({
          public_draft_token: OTHER_DRAFT_TOKEN,
          public_form_link_id: "30000000-0000-4000-8000-000000000009",
        }),
      ],
    })

    await expect(
      createPublicFormFileUploadUrl(
        {
          token: PUBLIC_TOKEN,
          draftToken: OTHER_DRAFT_TOKEN,
          fieldKey: "evidence",
          originalFilename: "evidence.pdf",
          contentType: "application/pdf",
          byteSize: 1024,
          checksumSha256: CHECKSUM,
        },
        createDeps(client, [FILE_ID])
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("refuses a field the template does not declare as a file field", async () => {
    const client = seedValidLink()

    await expect(
      createPublicFormFileUploadUrl(
        {
          token: PUBLIC_TOKEN,
          fieldKey: "full_name",
          originalFilename: "evidence.pdf",
          contentType: "application/pdf",
          byteSize: 1024,
          checksumSha256: CHECKSUM,
        },
        createDeps(client, [SUBMISSION_ID, FILE_ID])
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("refuses a malformed checksum", async () => {
    const client = seedValidLink()

    await expect(
      createPublicFormFileUploadUrl(
        {
          token: PUBLIC_TOKEN,
          fieldKey: "evidence",
          originalFilename: "evidence.pdf",
          contentType: "application/pdf",
          byteSize: 1024,
          checksumSha256: "not-a-checksum",
        },
        createDeps(client, [SUBMISSION_ID, FILE_ID])
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("refuses uploads once the link is disabled", async () => {
    const client = new FakePublicFormClient({
      document_templates: [createTemplateRow()],
      public_form_links: [createLinkRow({ status: "disabled" })],
    })

    await expect(
      createPublicFormFileUploadUrl(
        {
          token: PUBLIC_TOKEN,
          fieldKey: "evidence",
          originalFilename: "evidence.pdf",
          contentType: "application/pdf",
          byteSize: 1024,
          checksumSha256: CHECKSUM,
        },
        createDeps(client, [SUBMISSION_ID, FILE_ID])
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it.each([
    ["checkbox", true, false],
    ["dropdown", "Upload", "Skip"],
  ] as const)(
    "allocates only after a revealed %s-controlled file is checkpointed",
    async (controllerType, revealedValue, hiddenValue) => {
      const content = createConditionalFileContent(controllerType)
      const visibleClient = seedValidLink({
        document_templates: [createTemplateRow({ content })],
      })
      const visibleDeps = createDeps(visibleClient, [SUBMISSION_ID, FILE_ID])
      const checkpoint = await savePublicFormDraft(
        {
          token: PUBLIC_TOKEN,
          values: { upload_evidence: revealedValue },
        },
        visibleDeps
      )

      await expect(
        createPublicFormFileUploadUrl(
          {
            token: PUBLIC_TOKEN,
            draftToken: checkpoint.draftToken,
            fieldKey: "conditional_evidence",
            originalFilename: "evidence.pdf",
            contentType: "application/pdf",
            byteSize: 1024,
            checksumSha256: CHECKSUM,
          },
          visibleDeps
        )
      ).resolves.toMatchObject({ fileId: FILE_ID })
      expect(visibleClient.tables.submissions[0]?.values).toEqual({
        upload_evidence: revealedValue,
      })

      const hiddenClient = seedValidLink({
        document_templates: [createTemplateRow({ content })],
      })
      const hiddenDeps = createDeps(hiddenClient, [SUBMISSION_ID, FILE_ID])
      const hiddenCheckpoint = await savePublicFormDraft(
        {
          token: PUBLIC_TOKEN,
          values: { upload_evidence: hiddenValue },
        },
        hiddenDeps
      )

      await expect(
        createPublicFormFileUploadUrl(
          {
            token: PUBLIC_TOKEN,
            draftToken: hiddenCheckpoint.draftToken,
            fieldKey: "conditional_evidence",
            originalFilename: "evidence.pdf",
            contentType: "application/pdf",
            byteSize: 1024,
            checksumSha256: CHECKSUM,
          },
          hiddenDeps
        )
      ).rejects.toMatchObject({ statusCode: 400 })
      expect(hiddenClient.tables.submission_files).toHaveLength(0)
    }
  )
})

describe("public form draft checkpoints", () => {
  it("uses optimistic revisions and restores verified file state", async () => {
    const client = seedValidLink({
      submissions: [
        createDraftRow({
          values: { full_name: "Ada" },
          revision: 3,
        }),
      ],
      submission_files: [
        createFileRow({
          status: "available",
          original_filename: "verified.pdf",
        }),
      ],
    })

    await expect(
      savePublicFormDraft(
        {
          token: PUBLIC_TOKEN,
          draftToken: DRAFT_TOKEN,
          expectedRevision: 2,
          values: { full_name: "Grace" },
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(client.tables.submissions[0]?.values).toEqual({ full_name: "Ada" })

    await expect(
      getPublicFormDraftState(PUBLIC_TOKEN, DRAFT_TOKEN, createDeps(client))
    ).resolves.toMatchObject({
      draftToken: DRAFT_TOKEN,
      revision: 3,
      values: { full_name: "Ada" },
      files: [
        {
          fileId: FILE_ID,
          fieldKey: "evidence",
          originalFilename: "verified.pdf",
        },
      ],
    })
  })

  it("supersedes an exact token-scoped public file through the RPC", async () => {
    const client = seedValidLink({
      submissions: [createDraftRow()],
      submission_files: [createFileRow({ status: "available" })],
    })

    await expect(
      supersedePublicFormFile(
        { token: PUBLIC_TOKEN, draftToken: DRAFT_TOKEN, fileId: FILE_ID },
        createDeps(client)
      )
    ).resolves.toEqual({ fileId: FILE_ID })
    expect(client.tables.submission_files[0]?.status).toBe("superseded")
    expect(client.rpcCalls.at(-1)).toEqual({
      name: "supersede_public_submission_file",
      args: {
        target_public_form_token: PUBLIC_TOKEN,
        target_public_draft_token: DRAFT_TOKEN,
        target_file_id: FILE_ID,
      },
    })

    const replacementId = "50000000-0000-4000-8000-000000000002"
    await expect(
      createPublicFormFileUploadUrl(
        {
          token: PUBLIC_TOKEN,
          draftToken: DRAFT_TOKEN,
          fieldKey: "evidence",
          originalFilename: "replacement.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
          checksumSha256: CHECKSUM,
        },
        createDeps(client, [replacementId])
      )
    ).resolves.toMatchObject({ fileId: replacementId })
    expect(
      client.tables.submission_files.map((file) => file.status)
    ).toEqual(["superseded", "upload_pending"])
  })

  it("restores an uploaded file after validation fails and then submits", async () => {
    const client = seedValidLink()
    const deps = createDeps(client, [SUBMISSION_ID, FILE_ID])
    const checkpoint = await savePublicFormDraft(
      { token: PUBLIC_TOKEN, values: { agreed: false } },
      deps
    )
    const allocation = await createPublicFormFileUploadUrl(
      {
        token: PUBLIC_TOKEN,
        draftToken: checkpoint.draftToken,
        fieldKey: "evidence",
        originalFilename: "evidence.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
        checksumSha256: CHECKSUM,
      },
      deps
    )
    await completePublicFormFileUpload(
      {
        token: PUBLIC_TOKEN,
        draftToken: checkpoint.draftToken,
        fileId: allocation.fileId,
      },
      deps
    )

    await expect(
      submitPublicForm(
        {
          token: PUBLIC_TOKEN,
          draftToken: checkpoint.draftToken,
          expectedRevision: checkpoint.revision,
          values: { agreed: "false" },
        },
        deps
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    await expect(
      getPublicFormDraftState(PUBLIC_TOKEN, checkpoint.draftToken, deps)
    ).resolves.toMatchObject({
      revision: checkpoint.revision,
      files: [{ fileId: FILE_ID, fieldKey: "evidence" }],
    })

    await expect(
      submitPublicForm(
        {
          token: PUBLIC_TOKEN,
          draftToken: checkpoint.draftToken,
          expectedRevision: checkpoint.revision,
          values: { full_name: "Ada Lovelace", agreed: "false" },
        },
        deps
      )
    ).resolves.toMatchObject({ status: "submitted" })
  })
})

describe("completePublicFormFileUpload", () => {
  it("verifies the stored object before marking the file available", async () => {
    const client = seedValidLink({
      submissions: [createDraftRow()],
      submission_files: [createFileRow()],
    })
    const deps = createDeps(client)

    await completePublicFormFileUpload(
      { token: PUBLIC_TOKEN, draftToken: DRAFT_TOKEN, fileId: FILE_ID },
      deps
    )

    expect(deps.verifySubmissionUpload).toHaveBeenCalledWith(
      expect.objectContaining({ checksumSha256: CHECKSUM, byteSize: 1024 })
    )
    expect(client.tables.submission_files[0]).toMatchObject({
      status: "available",
      checksum_sha256: CHECKSUM,
    })
  })

  it("does not mark the file available when verification fails", async () => {
    const client = seedValidLink({
      submissions: [createDraftRow()],
      submission_files: [createFileRow()],
    })

    await expect(
      completePublicFormFileUpload(
        { token: PUBLIC_TOKEN, draftToken: DRAFT_TOKEN, fileId: FILE_ID },
        {
          ...createDeps(client),
          verifySubmissionUpload: async () => {
            throw new Error("object missing")
          },
        }
      )
    ).rejects.toThrow()

    expect(client.tables.submission_files[0].status).toBe("upload_pending")
  })

  it("refuses a file belonging to another organization's submission", async () => {
    const client = seedValidLink({
      submissions: [createDraftRow()],
      submission_files: [
        createFileRow({
          org_id: OTHER_ORG_ID,
          submission_id: "40000000-0000-4000-8000-000000000009",
        }),
      ],
    })

    await expect(
      completePublicFormFileUpload(
        { token: PUBLIC_TOKEN, draftToken: DRAFT_TOKEN, fileId: FILE_ID },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("submitPublicForm", () => {
  it("stores a validated submission and claims link capacity", async () => {
    const client = seedValidLink()

    const result = await submitPublicForm(
      {
        token: PUBLIC_TOKEN,
        values: { full_name: "Ada Lovelace", agreed: "true" },
      },
      createDeps(client, [SUBMISSION_ID])
    )

    expect(result.status).toBe("submitted")
    expect(client.rpcCalls).toEqual([
      {
        name: "increment_public_form_link_submission_count",
        args: { p_token: PUBLIC_TOKEN },
      },
    ])

    const submission = client.tables.submissions[0]
    expect(submission).toMatchObject({
      status: "submitted",
      public_form_link_id: LINK_ID,
      public_draft_token: null,
      submitted_by: null,
    })
    expect(submission.values).toEqual({
      full_name: "Ada Lovelace",
      agreed: true,
    })
  })

  it("rejects a field key the template snapshot does not declare", async () => {
    const client = seedValidLink()

    await expect(
      submitPublicForm(
        {
          token: PUBLIC_TOKEN,
          values: { full_name: "Ada", injected_field: "payload" },
        },
        createDeps(client, [SUBMISSION_ID])
      )
    ).rejects.toMatchObject({ statusCode: 400 })

    // Capacity must not be consumed by a submission that never validated.
    expect(client.rpcCalls).toHaveLength(0)
    expect(client.tables.submissions).toHaveLength(0)
  })

  it("rejects a missing required answer", async () => {
    const client = seedValidLink()

    await expect(
      submitPublicForm(
        { token: PUBLIC_TOKEN, values: { agreed: "true" } },
        createDeps(client, [SUBMISSION_ID])
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("refuses to exceed the max-submission ceiling", async () => {
    const client = new FakePublicFormClient({
      document_templates: [createTemplateRow()],
      public_form_links: [
        createLinkRow({ max_submissions: 1, submission_count: 0 }),
      ],
      organizations: [{ id: ORG_ID, name: "Acme" }],
    })
    const deps = createDeps(client, [SUBMISSION_ID, SUBMISSION_ID])

    await submitPublicForm(
      { token: PUBLIC_TOKEN, values: { full_name: "First", agreed: "false" } },
      deps
    )

    await expect(
      submitPublicForm(
        {
          token: PUBLIC_TOKEN,
          values: { full_name: "Second", agreed: "false" },
        },
        deps
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(client.tables.submissions).toHaveLength(1)
  })

  it("transitions an allocated draft and clears its handle", async () => {
    const client = seedValidLink({
      submissions: [createDraftRow({ revision: 3 })],
      submission_files: [
        createFileRow({ status: "available", checksum_sha256: CHECKSUM }),
      ],
    })

    const result = await submitPublicForm(
      {
        token: PUBLIC_TOKEN,
        draftToken: DRAFT_TOKEN,
        expectedRevision: 3,
        values: { full_name: "Ada Lovelace", agreed: "true" },
      },
      createDeps(client)
    )

    expect(result.submissionId).toBe(SUBMISSION_ID)
    expect(client.tables.submissions).toHaveLength(1)
    expect(client.tables.submissions[0]).toMatchObject({
      status: "submitted",
      public_draft_token: null,
      revision: 4,
    })
  })

  it("refuses to submit a stale public draft revision", async () => {
    const client = seedValidLink({
      submissions: [createDraftRow({ revision: 2 })],
    })

    await expect(
      submitPublicForm(
        {
          token: PUBLIC_TOKEN,
          draftToken: DRAFT_TOKEN,
          expectedRevision: 1,
          values: { full_name: "Ada Lovelace", agreed: "false" },
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(client.rpcCalls).toHaveLength(0)
    expect(client.tables.submissions[0]?.status).toBe("draft")
  })

  it("ignores a file answer the browser invents for an unverified upload", async () => {
    const client = seedValidLink({
      submissions: [createDraftRow()],
      submission_files: [createFileRow({ status: "upload_pending" })],
    })

    await expect(
      submitPublicForm(
        {
          token: PUBLIC_TOKEN,
          draftToken: DRAFT_TOKEN,
          expectedRevision: 1,
          values: { full_name: "Ada", agreed: "false", evidence: "spoofed" },
        },
        createDeps(client)
      )
    ).resolves.toMatchObject({ status: "submitted" })

    expect(client.tables.submissions[0].values).toEqual({
      full_name: "Ada",
      agreed: false,
    })
  })
})

function createConditionalFileContent(
  controllerType: "checkbox" | "dropdown"
): TemplateContentV3 {
  const content = templateContentV3Schema.parse(createTemplateContent())
  const controller =
    controllerType === "checkbox"
      ? {
          id: "10000000-0000-4000-8000-0000000000b1",
          type: "checkbox_field" as const,
          fieldKey: "upload_evidence",
          label: "Upload evidence",
          required: false,
          helpText: null,
          checkedByDefault: false,
        }
      : {
          id: "10000000-0000-4000-8000-0000000000b1",
          type: "dropdown_field" as const,
          fieldKey: "upload_evidence",
          label: "Upload evidence",
          required: false,
          helpText: null,
          placeholder: null,
          options: ["Upload", "Skip"],
        }

  content.blocks = [
    controller,
    {
      id: "10000000-0000-4000-8000-0000000000b2",
      type: "file_field",
      fieldKey: "conditional_evidence",
      label: "Conditional evidence",
      required: true,
      helpText: null,
      visibleWhen: {
        sourceBlockId: controller.id,
        operator: "equals",
        value: controllerType === "checkbox" ? true : "Upload",
      },
    },
  ]
  return content
}
