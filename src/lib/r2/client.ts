import { S3Client } from "@aws-sdk/client-s3"

import { getR2Env, type R2Env } from "@/lib/env"

let sharedClient: S3Client | undefined

/**
 * The S3-compatible client for Cloudflare R2 server-side operations. Without
 * settings it is one client per server process, so its connections are reused
 * across requests (a file list signs a URL per picture).
 *
 * @param r2Env - Optional prevalidated R2 settings, primarily for tests; these get a client of their own.
 * @returns Configured AWS SDK S3 client for the R2 endpoint.
 */
export function createR2Client(r2Env?: R2Env): S3Client {
  if (!r2Env) {
    sharedClient ??= buildR2Client(getR2Env())
    return sharedClient
  }

  return buildR2Client(r2Env)
}

function buildR2Client(r2Env: R2Env): S3Client {
  return new S3Client({
    endpoint: r2Env.CLOUDFLARE_R2_ENDPOINT,
    region: r2Env.CLOUDFLARE_R2_REGION,
    // R2's account endpoint expects the bucket in the URL path.
    forcePathStyle: true,
    // Keep presigned R2 PUT URLs free of optional SDK-generated CRC32 parameters.
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: r2Env.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: r2Env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
  })
}
