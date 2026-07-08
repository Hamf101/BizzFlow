import { S3Client } from "@aws-sdk/client-s3"

import { getR2Env, type R2Env } from "@/lib/env"

/**
 * Creates an S3-compatible client for Cloudflare R2 server-side operations.
 *
 * @param r2Env - Optional prevalidated R2 settings, primarily for tests.
 * @returns Configured AWS SDK S3 client for the R2 endpoint.
 */
export function createR2Client(r2Env: R2Env = getR2Env()): S3Client {
  return new S3Client({
    endpoint: r2Env.CLOUDFLARE_R2_ENDPOINT,
    region: r2Env.CLOUDFLARE_R2_REGION,
    credentials: {
      accessKeyId: r2Env.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: r2Env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
  })
}
