import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { BizFlowWordmark } from "@/components/brand/bizflow-mark"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getClientIp } from "@/lib/client-ip"
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit"
import { DocumentSigningServiceError, openSignedCopy } from "@/services/document-signing-service"

export const metadata: Metadata = {
  title: "Signed copy",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}

/**
 * Opens a completed document's signed copy from the emailed link, or a
 * signer's own signing link, by sending the browser to a short-lived download.
 *
 * @param props - The link's token.
 * @returns Why the copy cannot be opened; a working link redirects instead.
 */
export default async function SignedCopyPage({ params }: { params: Promise<{ token: string }> }): Promise<ReactElement> {
  const { token } = await params
  let downloadUrl: string | null = null
  let problem = "This link does not work. Ask the sender for the document."

  try {
    await checkRateLimit("public_signing", getClientIp(await headers()))
    downloadUrl = (await openSignedCopy({ token })).downloadUrl
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      problem = "Too many requests from your network. Wait a moment and reload."
    } else if (error instanceof DocumentSigningServiceError && error.statusCode < 500) {
      problem = error.message
    } else {
      problem = "The signed copy could not be opened. Try again in a moment."
    }
  }

  if (downloadUrl) {
    redirect(downloadUrl)
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:py-12">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div className="border-b pb-4">
          <BizFlowWordmark />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Signed copy unavailable</CardTitle>
            <CardDescription>{problem}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </main>
  )
}
