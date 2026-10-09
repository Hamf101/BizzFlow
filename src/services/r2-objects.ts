import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3"

type PresignOptions = { expiresIn: number; signableHeaders?: Set<string>; signingDate?: Date }

/**
 * Whether an R2 (S3 API) failure means the object is not there.
 *
 * @param error - Whatever the R2 call threw.
 * @returns True for a 404 or a not-found error code.
 */
export function isR2NotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }

  const candidate = error as {
    name?: unknown
    code?: unknown
    Code?: unknown
    $metadata?: { httpStatusCode?: unknown }
  }

  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    [candidate.name, candidate.code, candidate.Code].some(
      (code: unknown): boolean => code === "NotFound" || code === "NoSuchKey" || code === "NoSuchObject"
    )
  )
}

/**
 * Signs a create-only PUT: `IfNoneMatch: "*"` means the upload can never
 * replace an object already at the key. The caller caps the TTL.
 *
 * @param sign - The presigner (`getSignedUrl` unless a test injects one).
 * @param client - The R2 client.
 * @param object - Bucket, key, exact size and type, and TTL.
 * @returns The signed upload URL.
 */
export function signCreateOnlyPut(
  sign: (client: S3Client, command: PutObjectCommand, options: PresignOptions) => Promise<string>,
  client: S3Client,
  object: {
    bucket: string
    key: string
    byteSize: number
    contentType: string
    expiresIn: number
    signingDate?: Date
  }
): Promise<string> {
  return sign(
    client,
    new PutObjectCommand({
      Bucket: object.bucket,
      Key: object.key,
      ContentLength: object.byteSize,
      ContentType: object.contentType,
      IfNoneMatch: "*",
    }),
    {
      expiresIn: object.expiresIn,
      signableHeaders: new Set(["content-type"]),
      ...(object.signingDate ? { signingDate: object.signingDate } : {}),
    }
  )
}
