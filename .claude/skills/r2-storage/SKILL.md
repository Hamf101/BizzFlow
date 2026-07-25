---
name: r2-storage
description: >-
  BizFlow Cloudflare R2 file-storage conventions. Use when working with file uploads/downloads,
  signed URLs, object keys, or the S3 client — under src/lib/r2 or any *-storage-service. Covers
  private-bucket rules, create-only (IfNoneMatch) signed uploads, short TTLs, the canonical
  object-key layout, server-side upload verification (size/type/checksum/magic bytes), and
  injectable signer dependencies for tests.
---

# BizFlow R2 storage

**Bytes live in a private R2 bucket; metadata lives in Postgres.** R2 is reached through the
S3 API (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`). Reference implementation:
`src/services/submission-storage-service.ts`; client factory: `src/lib/r2/client.ts`.

## Iron rules

1. **Private only. Never expose a raw R2 URL.** The browser only ever gets a short-lived signed
   URL, minted **after** a permission check in a service.
2. **Permission first.** Signed-URL creation is gated by the same `requirePermission` flow as
   any other operation (see `writing-services`). Storage helpers assume the caller already
   authorized.
3. **Validate identifiers before signing.** Every id in an object key is regex-checked
   (`UUID_PATTERN`, `FIELD_KEY_PATTERN`, safe-filename) so a key can't be traversed or spoofed.
4. **Verify after upload.** A create-only PUT is not trusted until the server GETs the object and
   re-checks size, content-type, checksum, and magic bytes.

## The R2 client

```ts
new S3Client({
  endpoint: r2Env.CLOUDFLARE_R2_ENDPOINT,
  region:   r2Env.CLOUDFLARE_R2_REGION,
  forcePathStyle: true,                        // R2 wants the bucket in the URL path
  requestChecksumCalculation: "WHEN_REQUIRED", // keep presigned PUT URLs free of CRC32 params
  credentials: { accessKeyId: …, secretAccessKey: … },
})
```
Get env via `getR2Env()` / `getFileUploadPolicyEnv()` from `@/lib/env` (validated; never read
`process.env` directly). Deps let tests inject `r2Client`, `r2Env`, `signer`, `getObject`,
`deleteObject`.

## Object keys — canonical, create-only layout

```
organizations/{org_id}/documents/{document_id}/versions/{version_id}/original.{ext}
organizations/{org_id}/submissions/{submission_id}/files/{field_key}/{file_id}/{safe_filename}
organizations/{org_id}/public-submissions/{submission_id}/files/{field_key}/{file_id}/{safe_filename}
```
Build keys with a `buildXObjectKey(input)` helper that validates each segment and throws `400`
on a bad id. Keys always start `organizations/{org_id}/…` so tenancy is in the path.

## Create-only signed upload

```ts
const command = new PutObjectCommand({
  Bucket: r2Env.CLOUDFLARE_R2_BUCKET_NAME,
  Key: storageKey,
  ContentLength: input.byteSize,
  ContentType: input.contentType,
  IfNoneMatch: "*",                 // ← create-only: a PUT can never overwrite an existing object
})
const uploadUrl = await signer(client, command, {
  expiresIn: Math.min(env.CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS, SUBMISSION_UPLOAD_URL_MAX_TTL_SECONDS), // ≤ 15 min
  signableHeaders: new Set(["content-type"]),
})
```
- **`IfNoneMatch: "*"`** enforces application-level immutability — critical for finalized
  documents and submission files. Use it for anything that must not be replaced.
- **Upload URLs are short-lived** — cap at 15 min (`SUBMISSION_UPLOAD_URL_MAX_TTL_SECONDS`).
  Pair a create-only allocation with the scheduled tombstone/orphan cleanup so a delayed
  upload can't leave a dangling object.
- Enforce the file policy **before** signing: `validateSubmissionUploadRequest` (MIME allowlist
  ∩ policy, `byteSize` ≤ min(policy, 20 MB), sha256 shape) and
  `assertFilenameMatchesContentType`.

## Post-upload verification (don't trust the client)

`verifyXUpload` GETs the object and rejects `409` unless **all** hold: `ContentLength ===
byteSize`, `ContentType === contentType`, streamed bytes re-hash to the claimed
`checksum_sha256`, and the **magic-byte signature** matches the type (`%PDF-`; PNG/JPEG headers;
UTF-8 for CSV; a validated ZIP central directory with the required entry and **no
`vbaProject.bin`** for DOCX/XLSX). Only after verification do you promote the DB row to
`available`/finalized.

## Downloads

Mint a GET signed URL with `ResponseContentDisposition: 'attachment; filename="<safe>"'`, using
the standard TTL. Re-validate the persisted key shape (`isSafePersistedStorageKey`) before
signing — never sign an arbitrary caller-supplied key.

## Errors, logging, tests

- Wrap each op in `runXStorageOperation(name, safeIdentifiers, op)` (same pattern as services):
  `<domain>_storage_{success|rejected}`, `≥500 → console.error` else `console.warn`. Never log
  bytes or full URLs.
- Throw a typed `XStorageServiceError(message, statusCode)`; map config problems (bad R2 env /
  upload policy) to `500` with a safe message.
- Deletes are **idempotent** (a missing object is success).
- In tests, inject `signer`/`getObject`/`deleteObject`/`r2Env` via deps — don't hit the network
  (see `writing-tests`).
