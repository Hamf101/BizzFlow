import { afterEach, describe, expect, it, vi } from "vitest"

import type {
  ResourcePurgeServiceClient,
  ResourcePurgeServiceDeps,
} from "@/services/documents/purge-contracts"
import {
  processDueResourcePurges,
  requestDocumentPurge,
  requestFolderPurge,
} from "@/services/documents/purge-service"

type RpcResult = {
  data: unknown
  error: unknown
}

const documentInput = {
  actorUserId: "user-1",
  organizationId: "org-1",
  documentId: "document-1",
  confirmationTitle: "Signed contract",
}

const folderInput = {
  actorUserId: "user-1",
  organizationId: "org-1",
  folderId: "folder-1",
  confirmationName: "Old contracts",
}

afterEach((): void => {
  vi.restoreAllMocks()
})

describe("manual resource purge requests", () => {
  it("queues a document purge with an idempotency job identifier and exact title", async () => {
    const { client, rpc } = createClient({
      request_document_purge: success("purge-job-1"),
    })
    const deps = createDeps(client)

    await expect(requestDocumentPurge(documentInput, deps)).resolves.toEqual({
      jobId: "purge-job-1",
      lifecycleState: "purge_pending",
    })
    expect(deps.createId).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith("request_document_purge", {
      target_org_id: "org-1",
      target_document_id: "document-1",
      target_actor_user_id: "user-1",
      target_confirmation_title: "Signed contract",
      target_job_id: "new-purge-job",
    })
  })

  it("queues a folder subtree purge with the exact folder name", async () => {
    const { client, rpc } = createClient({
      request_folder_purge: success("folder-purge-job"),
    })
    const deps = createDeps(client)

    await expect(requestFolderPurge(folderInput, deps)).resolves.toEqual({
      jobId: "folder-purge-job",
      lifecycleState: "purge_pending",
    })
    expect(rpc).toHaveBeenCalledWith("request_folder_purge", {
      target_org_id: "org-1",
      target_folder_id: "folder-1",
      target_actor_user_id: "user-1",
      target_confirmation_name: "Old contracts",
      target_job_id: "new-purge-job",
    })
  })

  it.each([
    {
      label: "document title",
      operation: () =>
        requestDocumentPurge(
          { ...documentInput, confirmationTitle: "   " },
          createDeps(createClient().client)
        ),
    },
    {
      label: "folder name",
      operation: () =>
        requestFolderPurge(
          { ...folderInput, confirmationName: "" },
          createDeps(createClient().client)
        ),
    },
  ])("rejects a blank $label before allocating a job", async ({ operation }) => {
    await expect(operation()).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it("normalizes a retention authorization rejection without exposing database detail", async () => {
    const { client } = createClient({
      request_document_purge: {
        data: null,
        error: {
          code: "42501",
          message:
            "Only an organization owner may purge a retention-protected document.",
        },
      },
    })

    await expect(
      requestDocumentPurge(documentInput, createDeps(client))
    ).rejects.toMatchObject({
      message: "You are not allowed to purge this document.",
      statusCode: 403,
    })
  })
})

describe("scheduled resource purge processing", () => {
  it("deletes a bounded leased batch and finalizes ready jobs", async () => {
    const leasedObjects = [
      leasedObject("object-1", "job-1", "organizations/org-1/documents/a.pdf"),
      leasedObject("object-2", "job-1", "organizations/org-1/documents/b.pdf"),
    ]
    const { client, rpc } = createClient({
      enqueue_due_resource_purges: success(1),
      lease_resource_purge_objects: success(leasedObjects),
      complete_resource_purge_object: success(true),
      finalize_ready_resource_purges: success(1),
    })
    const deps = createDeps(client)

    await expect(processDueResourcePurges({}, deps)).resolves.toEqual({
      enqueued: 1,
      leased: 2,
      deleted: 2,
      retryScheduled: 0,
      permanentlyFailed: 0,
      finalized: 1,
    })
    expect(rpc).toHaveBeenCalledWith("enqueue_due_resource_purges", {
      target_limit: 10,
    })
    expect(rpc).toHaveBeenCalledWith("lease_resource_purge_objects", {
      target_limit: 25,
      target_lease_seconds: 120,
    })
    expect(rpc).toHaveBeenCalledWith("finalize_ready_resource_purges", {
      target_limit: 10,
    })
    expect(deps.deleteDocumentStorageObject).toHaveBeenNthCalledWith(1, {
      storageKey: "organizations/org-1/documents/a.pdf",
    })
    expect(deps.deleteDocumentStorageObject).toHaveBeenNthCalledWith(2, {
      storageKey: "organizations/org-1/documents/b.pdf",
    })
    expect(rpc).toHaveBeenCalledWith("complete_resource_purge_object", {
      target_object_id: "object-1",
      target_lease_token: "lease-object-1",
    })
  })

  it("isolates storage failures, schedules retry, and never logs a raw key", async () => {
    const rawStorageKey =
      "organizations/org-secret/documents/doc-secret/private.pdf"
    const { client, rpc } = createClient({
      enqueue_due_resource_purges: success(0),
      lease_resource_purge_objects: success([
        leasedObject("object-1", "job-1", rawStorageKey),
      ]),
      fail_resource_purge_object: success("retry_wait"),
      finalize_ready_resource_purges: success(0),
    })
    const deps = createDeps(client)
    deps.deleteDocumentStorageObject = vi.fn(async (): Promise<void> => {
      throw new Error(`provider failed for ${rawStorageKey}`)
    })
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(processDueResourcePurges({}, deps)).resolves.toEqual({
      enqueued: 0,
      leased: 1,
      deleted: 0,
      retryScheduled: 1,
      permanentlyFailed: 0,
      finalized: 0,
    })
    expect(rpc).toHaveBeenCalledWith("fail_resource_purge_object", {
      target_object_id: "object-1",
      target_lease_token: "lease-object-1",
      target_error_code: "storage_delete_failed",
    })
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(rawStorageKey)
    expect(errorLog).toHaveBeenCalledWith("resource_purge_object_failed", {
      jobId: "job-1",
      objectId: "object-1",
      disposition: "retry_wait",
    })
  })

  it("reports a terminal per-object failure without restoring resource lifecycle", async () => {
    const { client } = createClient({
      enqueue_due_resource_purges: success(0),
      lease_resource_purge_objects: success([
        leasedObject("object-1", "job-1", "opaque/key.pdf"),
      ]),
      fail_resource_purge_object: success("failed"),
      finalize_ready_resource_purges: success(0),
    })
    const deps = createDeps(client)
    deps.deleteDocumentStorageObject = vi.fn(async (): Promise<void> => {
      throw new Error("R2 unavailable")
    })
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(processDueResourcePurges({}, deps)).resolves.toMatchObject({
      permanentlyFailed: 1,
      retryScheduled: 0,
      finalized: 0,
    })
  })

  it.each([
    [{ jobLimit: 0 }, "jobLimit"],
    [{ objectLimit: 101 }, "objectLimit"],
    [{ leaseSeconds: 601 }, "leaseSeconds"],
  ])("rejects out-of-range bounded option %s", async (options, field) => {
    const { client, rpc } = createClient()

    await expect(
      processDueResourcePurges(options, createDeps(client))
    ).rejects.toMatchObject({
      message: expect.stringContaining(field),
      statusCode: 400,
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})

function createClient(
  results: Record<string, RpcResult> = {}
): {
  client: ResourcePurgeServiceClient
  rpc: ReturnType<typeof vi.fn>
} {
  const rpc = vi.fn(
    async (name: string): Promise<RpcResult> =>
      results[name] ?? success(null)
  )

  return {
    client: { rpc } as unknown as ResourcePurgeServiceClient,
    rpc,
  }
}

function createDeps(
  client: ResourcePurgeServiceClient
): ResourcePurgeServiceDeps {
  return {
    client,
    createId: vi.fn((): string => "new-purge-job"),
    deleteDocumentStorageObject: vi.fn(async (): Promise<void> => undefined),
  }
}

function success(data: unknown): RpcResult {
  return { data, error: null }
}

function leasedObject(
  objectId: string,
  jobId: string,
  storageKey: string
): Record<string, unknown> {
  return {
    object_id: objectId,
    job_id: jobId,
    storage_key: storageKey,
    lease_token: `lease-${objectId}`,
    attempt_count: 1,
  }
}
