import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { renderGeneratedDocumentPdf } from "../src/services/document-pdf-service"
import { createSampleDocumentInput } from "../src/services/document-pdf/sample-document.test-support"

/**
 * Renders a multi-page generated document for visual PDF regression checks.
 *
 * The fixture is shared with `document-pdf-fingerprint.test.ts`, which asserts
 * the same render byte-for-byte in CI. This script exists for the times a human
 * wants to look at the result rather than compare a hash.
 *
 * @returns Resolves after writing the requested sample PDF.
 */
async function main(): Promise<void> {
  const requestedPath =
    process.argv[2] ?? "artifacts/verification/generated-document-sample.pdf"
  const outputPath = resolve(process.cwd(), requestedPath)
  const pdf = await renderGeneratedDocumentPdf(createSampleDocumentInput())

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, pdf)
  console.info("generated_document_visual_sample_written", {
    outputPath,
    byteSize: pdf.length
  })
}

void main().catch((error: unknown): void => {
  console.error("generated_document_visual_sample_failed", {
    reason: error instanceof Error ? error.message : "Unknown sample error"
  })
  process.exitCode = 1
})
