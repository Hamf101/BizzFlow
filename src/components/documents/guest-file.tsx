import { FileText } from "lucide-react"
import type { ReactElement } from "react"

import { DocumentDownloadButton } from "@/components/documents/document-download-button"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import type { GuestDocument } from "@/services/document-service"

/**
 * An uploaded file, as someone outside its workspace who was given it sees it:
 * open it in the browser, or save a copy.
 *
 * @param props - The file and what its guest may know about it.
 * @returns The full-screen file page.
 */
export function GuestFile({ documentId, guest }: { documentId: string; guest: GuestDocument }): ReactElement {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-4 sm:p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="grid-cols-[auto_1fr] items-center gap-x-3">
          <FileText aria-hidden className="row-span-2 size-8 text-muted-foreground" />
          <CardDescription>Shared with you by {guest.organizationName}</CardDescription>
          <CardTitle className="font-editorial text-xl break-words">{guest.title}</CardTitle>
        </CardHeader>
        <CardFooter className="flex flex-wrap gap-2">
          <DocumentDownloadButton documentId={documentId} organizationId={guest.organizationId} view />
          <DocumentDownloadButton documentId={documentId} organizationId={guest.organizationId} />
        </CardFooter>
      </Card>
    </div>
  )
}
